/**
 * Provider connection test utility.
 *
 * Two families:
 *  - CodeBuddy (Global + CN): same 0penAI-compatible `/v2/chat/completions`
 *    endpoint plus a billing endpoint at `/v2/billing/meter/get-user-resource`
 *    (POST, Bearer auth). We POST an empty body there to probe the credential —
 *    cheap (no chat completion charge) and works with both API keys and OAuth
 *    access tokens.
 *  - Custom compatible nodes (`openai-compatible-*` / `anthropic-compatible-*`):
 *    upstream is whatever the user configured, so probe its own baseUrl.
 */

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { PROVIDERS } from "open-sse/config/providers.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

const SUPPORTED_PROVIDERS = new Set(["codebuddy", "codebuddy-cn"]);

// Custom nodes expose an arbitrary upstream; probe it directly instead of the
// CodeBuddy billing endpoint.
const COMPATIBLE_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPATIBLE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pingCompatible(connection) {
  const baseUrl = String(connection.providerSpecificData?.baseUrl || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    return { valid: false, error: "Missing base URL for this compatible provider" };
  }

  const token = connection.apiKey || connection.accessToken;
  if (!token) {
    return { valid: false, error: "Missing credential (apiKey or accessToken)" };
  }

  const isAnthropic = isAnthropicCompatibleProvider(connection.provider);
  const headers = isAnthropic
    ? { "x-api-key": token, "anthropic-version": "2023-06-01", Authorization: `Bearer ${token}` }
    : { Authorization: `Bearer ${token}` };

  try {
    // /models is the cheapest probe: no tokens are generated.
    const res = await fetchWithTimeout(`${baseUrl}/models`, { headers });
    if (res.ok) return { valid: true, statusCode: res.status };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, statusCode: res.status, error: "API key unauthorized" };
    }

    // Some gateways omit /models. Fall back to a 1-token completion when the
    // connection knows a model; otherwise surface an actionable message.
    const model = connection.defaultModel || connection.providerSpecificData?.modelId;
    if (model) {
      const chatRes = await fetchWithTimeout(
        isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        }
      );
      if (chatRes.ok) return { valid: true, statusCode: chatRes.status, method: "chat" };
      if (chatRes.status === 401 || chatRes.status === 403) {
        return { valid: false, statusCode: chatRes.status, error: "API key unauthorized" };
      }
      return {
        valid: false,
        statusCode: chatRes.status,
        error: `Chat request failed (${chatRes.status})`,
        method: "chat",
      };
    }

    return {
      valid: false,
      statusCode: res.status,
      error: res.status === 404
        ? "/models endpoint not found — set a default model for this connection or use Check in Edit with a model ID"
        : `Validation failed (${res.status})`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.name === "AbortError"
        ? `Request timeout (>${COMPATIBLE_TIMEOUT_MS / 1000}s)`
        : `Network error: ${error.message}`,
    };
  }
}

// Billing endpoints (same as PROVIDERS[id].usage.url in the registry).
const BILLING_URLS = {
  codebuddy: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
  "codebuddy-cn": "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
};

export function classifyOAuthProbeResult(res, _config, bodyText = "") {
  if (res.ok) {
    return { valid: true, statusCode: res.status };
  }
  const message = bodyText && bodyText.length < 500 ? bodyText : `HTTP ${res.status}`;
  return {
    valid: false,
    statusCode: res.status,
    error: `Probe failed: ${message}`,
  };
}

async function pingCodeBuddy(connection) {
  const url = BILLING_URLS[connection.provider];
  if (!url) {
    return { valid: false, error: `Missing billing URL for ${connection.provider}` };
  }

  const token = connection.apiKey || connection.accessToken;
  if (!token) {
    return { valid: false, error: "Missing credential (apiKey or accessToken)" };
  }

  const providerCfg = PROVIDERS[connection.provider];
  const headers = {
    ...(providerCfg?.headers || {}),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: "{}",
    });
    const bodyText = await res.text().catch(() => "");

    if (!res.ok) {
      return classifyOAuthProbeResult(res, providerCfg, bodyText);
    }

    // CodeBuddy returns { code: 0, msg: "..." } on success; anything else is a
    // reachable-endpoint-but-bad-credential response and should count as a fail.
    try {
      const json = JSON.parse(bodyText);
      if (json?.code === 0) {
        return { valid: true, statusCode: res.status };
      }
      return {
        valid: false,
        statusCode: res.status,
        error: `CodeBuddy rejected credential: ${json?.msg || "unknown error"}`,
      };
    } catch {
      // Body wasn't JSON but HTTP was OK — treat as valid (endpoint reachable + auth accepted)
      return { valid: true, statusCode: res.status };
    }
  } catch (error) {
    return { valid: false, error: `Network error: ${error.message}` };
  }
}

export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  if (!connection) {
    return { valid: false, error: "Connection not found" };
  }

  // Custom OpenAI/Anthropic-compatible nodes are not in the registry — probe
  // their own baseUrl rather than rejecting them as unsupported.
  if (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider)) {
    const result = await pingCompatible(connection);
    await updateProviderConnection(id, {
      testStatus: result.valid ? "active" : "failed",
      lastError: result.valid ? null : result.error || "Test failed",
      lastErrorAt: result.valid ? null : new Date().toISOString(),
    });
    return result;
  }

  if (!SUPPORTED_PROVIDERS.has(connection.provider)) {
    const result = {
      valid: false,
      error: `Provider ${connection.provider} not supported in this build`,
    };
    await updateProviderConnection(id, {
      testStatus: "failed",
      lastError: result.error,
      lastErrorAt: new Date().toISOString(),
    });
    return result;
  }

  const result = await pingCodeBuddy(connection);
  await updateProviderConnection(id, {
    testStatus: result.valid ? "active" : "failed",
    lastError: result.valid ? null : result.error || "Test failed",
    lastErrorAt: result.valid ? null : new Date().toISOString(),
  });
  return result;
}
