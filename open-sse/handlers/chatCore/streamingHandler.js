import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { emitCodebuddyReport } from "../../services/codebuddyReport.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";

// Responses-API providers emit Responses SSE → which client format to translate INTO, by request sourceFormat.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, filtersApplied, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId, reqTag, log }) {
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  // Streaming path expects SSE. If upstream returns anything else — HTML from
  // a Cloudflare error page, plain JSON error body, text/plain misconfigure —
  // piping it through the SSE transform chokes the client. Treat non-SSE as
  // a blocked pipe and return a clean JSON error.
  //
  // Prior logic exempted `application/json` from this guard on the assumption
  // that JSON might be a streaming NDJSON variant, but the codebase's transforms
  // all expect `text/event-stream`. A provider returning `application/json` for
  // a stream=true request is an error body, so treat it the same as HTML.
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  const isSSE = upstreamContentType.includes('text/event-stream');
  if (upstreamContentType && !isSSE) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    let shortMsg = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (!shortMsg && upstreamContentType.includes('application/json')) {
      // Try to surface upstream's JSON error message so the caller sees "why".
      try {
        const parsed = JSON.parse(bodyText);
        shortMsg = (parsed?.error?.message || parsed?.message || parsed?.error || '').toString().trim().slice(0, 200);
      } catch { /* fall through */ }
    }
    if (!shortMsg) {
      shortMsg = bodyText.length < 200
        ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160)
        : `Upstream returned non-SSE response (${upstreamContentType})`;
    }
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  // Previously wrote a "[Streaming in progress...]" placeholder row here to
  // give the dashboard early visibility, then overwrote it in onStreamComplete
  // when the stream finished. The two writes are fire-and-forget against
  // SQLite, so under sql.js (100ms debounce) or under load the placeholder's
  // INSERT sometimes landed AFTER the final UPDATE, leaving users staring at
  // "[Streaming in progress...]" as the persisted response. The completion
  // path already writes the real row; a missing in-flight row is preferable
  // to a race-corrupted one.

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, filtersApplied, clientRawRequest, reqTag, log, credentials, providerHeaders, providerUrl, proxyOptions }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    // Claude→0penAI translate leaves usage in Claude-shape (input_tokens /
    // output_tokens). Dashboard rows read completion_tokens, so canonicalize
    // to 0penAI-shape before persisting or the Output column reads 0.
    const canonicalUsage = canonicalizeUsage(usage) || { prompt_tokens: 0, completion_tokens: 0 };

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: canonicalUsage,
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      status: "success",
      filtersApplied
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));

    // CodeBuddy /v2/report telemetry — mirror real CLI 2.144.0 post-chat
    // signal so the account is marked "active" (required for daily reward
    // credits to issue). Gated by the dashboard toggle
    // (settings.providerReport.codebuddy) or env CODEBUDDY_EMIT_REPORT=1.
    if (provider === "codebuddy") {
      const baseUrl = providerUrl ? new URL(providerUrl).origin : null;
      emitCodebuddyReport({
        providerHeaders,
        credentials,
        transformedBody: finalBody || translatedBody,
        enabled: credentials?.__reportEnabled === true,
        baseUrl,
        proxyOptions,
        log,
        reqTag,
      });
    }
  };

  return { onStreamComplete, streamDetailId };
}
