// CodeBuddy /v2/report emitter — telemetry batch sent after every chat.
//
// Real CLI 2.144.0 fires [plugin_status, chat_request_send,
// chat_message_send] to /v2/report immediately after /v2/chat/completions.
// Backend uses these events to mark the account "active"; without them,
// daily reward credits are NOT issued even when usage is tracked.
//
// Fire-and-forget. Gated by CODEBUDDY_EMIT_REPORT=1 env (default OFF).

import { createHash, randomUUID } from "crypto";
import { jwtSub } from "../utils/jwtSub.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveRealmConfig } from "../providers/realmResolver.js";

const REPORT_TIMEOUT_MS = 10_000;

// Common device fingerprint, realm-agnostic. Matches values on the wire for
// both CLI 2.144.0 and WorkBuddy 5.5.2 captures.
const DEVICE_STATIC = Object.freeze({
  timezone: "Asia/Jakarta",
  arch: "arm64",
  osVersion: "25.6.0",
  cpuModel: "Apple M2 Pro",
  cpuCores: 10,
  memorySize: 16,
  vcsType: "unknown",
  vcsRepo: "",
  vcsBranchName: "",
  vcsRevId: "",
});

// Realm-specific release fingerprint (commit + releaseDate come from each
// realm's own wire capture).
const REALM_RELEASE = Object.freeze({
  codebuddy: {
    releaseDate: 1788530857503,
    commit: "8d037fece0be1978272cf60f906f7bd144e32408",
    featureModule: "cli_local",
  },
  workbuddy: {
    releaseDate: 1788558445056,
    commit: "910352f030ae2d11d8a21c21929fa4d1b4eeedd7",
    featureModule: "wb_desktop",
  },
});

// Format a hex string into a UUID-shape (8-4-4-4-12) for machineId.
function toUuidShape(hex) {
  const h = hex.padEnd(32, "0").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Derive a stable machineId from connectionId. Real CLI = 1 device = 1 id;
// per-connection stable derivation mirrors that (avoids cross-account
// clustering while keeping consistent per-user fingerprint over time).
export function deriveMachineId(connectionId) {
  const seed = connectionId || "9router-anonymous";
  const md5 = createHash("md5").update(seed).digest("hex");
  return toUuidShape(md5).toUpperCase();
}

// Extract prompt text length from the transformed body's last user message.
// Report expects character count of the user's actual query.
function extractPromptLength(body) {
  if (!body || !Array.isArray(body.messages)) return 0;
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const msg = body.messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content.length;
    if (Array.isArray(msg.content)) {
      let total = 0;
      for (const part of msg.content) {
        if (part && part.type === "text" && typeof part.text === "string") {
          total += part.text.length;
        }
      }
      return total;
    }
    return 0;
  }
  return 0;
}

// Strip streaming-only chat headers that /v2/report doesn't want.
function reportHeaders(providerHeaders) {
  const h = { ...providerHeaders };
  // /v2/report is a plain JSON POST — Accept SSE from the chat request is
  // wrong here, and Content-Encoding would poison the retry.
  h["Accept"] = "application/json";
  h["Content-Type"] = "application/json";
  delete h["Content-Encoding"];
  return h;
}

/**
 * Fire the 3-event report batch. Never throws.
 *
 * @param {object} args
 * @param {object} args.providerHeaders  Headers actually sent to /v2/chat/completions
 * @param {object} args.credentials      Connection credentials (apiKey/accessToken, connectionId)
 * @param {object} args.transformedBody  Body sent to CB (used for prompt length)
 * @param {string} [args.baseUrl]        Optional realm base URL override; defaults to resolveRealmConfig(credentials).baseUrl
 * @param {object} [args.proxyOptions]   Per-connection proxy config
 * @param {object} [args.log]            Optional { line(tag, icon, ...args) } logger
 * @param {string} [args.reqTag]         Log tag for the parent chat request
 */
export function emitCodebuddyReport({
  providerHeaders,
  credentials,
  transformedBody,
  baseUrl,
  proxyOptions,
  log,
  reqTag,
}) {
  if (process.env.CODEBUDDY_EMIT_REPORT !== "1") return;
  if (!providerHeaders) return;

  const realm = resolveRealmConfig(credentials);
  const targetBase = baseUrl || realm.baseUrl;
  if (!targetBase) return;

  const token = credentials?.apiKey || credentials?.accessToken || "";
  const uid = jwtSub(token);
  const connectionId = credentials?.connectionId || credentials?._connection?.id || "";
  const machineId = deriveMachineId(connectionId);

  const conversationId = providerHeaders["X-Conversation-ID"] || randomUUID();
  const requestId = providerHeaders["X-Conversation-Request-ID"] || randomUUID().replace(/-/g, "");
  const messageId = providerHeaders["X-Conversation-Message-ID"] || randomUUID().replace(/-/g, "");
  const sessionId = randomUUID();

  const release = REALM_RELEASE[realm.id] || REALM_RELEASE.codebuddy;
  const common = {
    userId: uid,
    username: "",
    userNickname: "",
    product: "SaaS",
    sessionId,
    ideName: realm.ideName,
    ideType: realm.ideType,
    ideVersion: realm.ideVersion,
    extName: realm.extName,
    extVersion: realm.extVersion,
    machineId,
    ...DEVICE_STATIC,
    ...release,
  };

  const traceBase = {
    conversationId,
    requestId,
    requestModelId: "default-model",
    requestModelName: "Auto",
    traceId: requestId,
    rootRequestId: requestId,
    parentConversationId: conversationId,
    agentName: "cli",
    agentType: "main",
    vcsType: "unknown",
    vcsRepo: "",
    vcsBranchName: "",
    vcsRevId: "",
    "codebuddy.session_id": conversationId,
    "codebuddy.conversation_request_id": requestId,
  };

  const ts = Date.now();
  const inputLength = extractPromptLength(transformedBody);

  const events = [
    {
      eventCode: "plugin_status",
      timestamp: ts,
      reportDelay: 2000,
      presentAt: ts,
      ...common,
    },
    {
      eventCode: "chat_request_send",
      timestamp: ts + 10,
      reportDelay: 2000,
      mode: "unknown",
      inputLength,
      isPlan: false,
      isAutoExecuteTerminal: false,
      isAutoModify: false,
      codebaseEnable: false,
      maxToken: 0,
      maxSteps: 500,
      temperature: 0,
      maxRetries: 0,
      mentionContexts: [],
      knowledgeId: [],
      knowledgeName: [],
      codebaseId: "",
      mentionContextCount: 0,
      command: "",
      recommendId: "",
      skillId: "",
      skillCount: 0,
      totalCount: 0,
      presentAt: ts + 10,
      ...traceBase,
      ...common,
    },
    {
      eventCode: "chat_message_send",
      timestamp: ts + 30,
      reportDelay: 2001,
      messageId,
      historyCount: 1,
      isContextTruncated: false,
      currentStepCount: 1,
      presentAt: ts + 30,
      ...traceBase,
      ...common,
    },
  ];

  const url = `${targetBase.replace(/\/+$/, "")}/v2/report`;
  const headers = reportHeaders(providerHeaders);
  const body = JSON.stringify(events);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);

  proxyAwareFetch(
    url,
    { method: "POST", headers, body, signal: controller.signal },
    proxyOptions,
  )
    .then((resp) => {
      if (log?.line && reqTag) {
        const icon = resp.ok ? "📮" : "⚠️";
        log.line(reqTag, icon, `codebuddy report ${resp.status}`);
      }
    })
    .catch((err) => {
      if (log?.line && reqTag) {
        log.line(reqTag, "⚠️", "codebuddy report failed:", err?.message || err);
      }
    })
    .finally(() => clearTimeout(timer));
}
