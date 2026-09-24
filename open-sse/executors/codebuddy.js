import { randomUUID } from "crypto";
import { DefaultExecutor } from "./default.js";
import {
  createContentFilterCache,
  applyFiltersToMessages,
} from "../utils/contentFilters.js";
import { jwtSub } from "../utils/jwtSub.js";
import { resolveRealmConfig } from "../providers/realmResolver.js";

const ALLOWED_FIELDS = [
  "temperature", "top_p", "presence_penalty", "frequency_penalty", "stop",
  "tool_choice", "parallel_tool_calls", "response_format",
  // Cache-grouping keys: CodeBuddy pass-through to 0penAI upstream honors these
  // (prompt_cache_key primary, user/safety_identifier fallback). Without them,
  // cache hits rarely fire because requests can't be grouped to a stable key.
  "prompt_cache_key", "user", "safety_identifier",
];

// Models whose 0penAI-native upstream rejects reasoning_effort="max" (400
// unsupported_value) and times out with any effort > xhigh. Any request that
// arrives with "max" here (e.g. from providerThinking config default) is
// clamped down to "xhigh" for these models so the request still succeeds.
// Live-verified 2026-09-21: gpt-5.4 + gpt-5.5 reject max/minimal; low/med/high/xhigh all 200.
const NO_MAX_EFFORT_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.5",
]);

const filters = createContentFilterCache("codebuddy");
export const invalidateContentFiltersCache = filters.invalidate;

function hex32() {
  return randomUUID().replace(/-/g, "");
}

function hex16() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

function truncateMiddle(text, maxChars, label) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.max(0, maxChars - head - label.length - 12);
  return `${text.slice(0, head)}\n\n[${label}]\n\n${text.slice(-tail)}`;
}

function sanitizeSchema(schema, visited = new WeakSet()) {
  if (!schema || typeof schema !== "object") return schema;
  if (visited.has(schema)) return schema;
  visited.add(schema);
  if (Array.isArray(schema)) return schema.map((s) => sanitizeSchema(s, visited));
  const next = { ...schema };
  if (typeof next.description === "string") {
    next.description = truncateMiddle(next.description, 500, "schema description truncated");
  }
  for (const key of Object.keys(next)) {
    if (key !== "description" && next[key] && typeof next[key] === "object") next[key] = sanitizeSchema(next[key], visited);
  }
  return next;
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    if (tool.function && typeof tool.function === "object") {
      return { ...tool, function: {
        ...tool.function,
        description: truncateMiddle(tool.function.description || "", 1200, "tool description truncated"),
        parameters: sanitizeSchema(tool.function.parameters),
      } };
    }
    return {
      ...tool,
      description: truncateMiddle(tool.description || "", 1200, "tool description truncated"),
      input_schema: sanitizeSchema(tool.input_schema),
      parameters: sanitizeSchema(tool.parameters),
    };
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const result = messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    if (message.role === "user" && typeof message.content === "string") {
      return { ...message, content: [{ type: "text", text: message.content }] };
    }
    return { ...message };
  });
  // CodeBuddy upstream requires a system message (rejects with 11101 otherwise).
  // Some models (kimi-k3, kimi-k2.5) reject empty-string system content (11133),
  // so use a single space as a neutral, non-empty placeholder.
  if (!result.some((m) => m && m.role === "system")) {
    result.unshift({ role: "system", content: " " });
  }
  return result;
}

export class CodeBuddyGlobalExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy");
  }

  async execute(params) {
    this._contentFilters = await filters.load();
    this._filtersApplied = null; // reset per-request
    return super.execute(params);
  }

  transformRequest(model, body) {
    const source = super.transformRequest(model, body);
    let messages = normalizeMessages(source.messages);
    const rules = this._contentFilters || [];
    if (rules.length > 0) {
      const result = applyFiltersToMessages(messages, rules);
      messages = result.messages;
      if (result.applied.length > 0) this._filtersApplied = result.applied;
    }
    const transformed = { model, messages, stream: true };
    // Honor the client's reasoning_effort if the translator already set one
    // (via alias suffix, providerThinking override, or direct request field).
    // CodeBuddy accepts "minimal|low|medium|high|xhigh|max". Default to xhigh.
    const sourceEffort = source.reasoning_effort
      || (typeof source.reasoning === "object" ? source.reasoning?.effort : null);
    let effort = typeof sourceEffort === "string" && sourceEffort ? sourceEffort : "xhigh";
    // Clamp "max" → "xhigh" for models whose 0penAI upstream rejects "max"
    // (gpt-5.4/5.5 return 400 or hang for 60s+ when given effort="max").
    if (effort === "max" && NO_MAX_EFFORT_MODELS.has(model)) {
      effort = "xhigh";
    }
    transformed.reasoning_effort = effort;
    transformed.reasoning = { effort, summary: "auto" };
    for (const field of ALLOWED_FIELDS) {
      if (source[field] !== undefined) transformed[field] = source[field];
    }
    // CodeBuddy backend types tool_choice as string only — coerce object form to "required"
    if (transformed.tool_choice && typeof transformed.tool_choice === "object") {
      transformed.tool_choice = "required";
    }
    if (Array.isArray(source.tools)) transformed.tools = normalizeTools(source.tools);
    const maxTokens = Number(source.max_tokens ?? source.max_completion_tokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) transformed.max_tokens = Math.max(maxTokens, 16);
    return transformed;
  }

  // Override chat URL to point at the resolved realm (codebuddy.ai or
  // workbuddy.ai) instead of the static registry baseUrl.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const realm = resolveRealmConfig(credentials);
    return `${realm.baseUrl}/v2/chat/completions`;
  }

  // Header assembly mirrors CLI 2.144.0 cli_exact wire capture (verified via
  // Frida TLSWrap + mitm). Three hex32 pools:
  //   root  → X-Conversation-Request-ID = X-Root-Request-ID = X-Trace-ID =
  //           X-B3-TraceId = traceparent trace-part = b3 trace-part
  //   msg   → X-Conversation-Message-ID = X-Request-ID
  //   conv  → X-Conversation-ID (dashed uuid4 per capture)
  // Plus two hex16 for span/parent slots in traceparent/b3/X-B3-SpanId.
  buildHeaders(credentials) {
    const headers = super.buildHeaders(credentials, true);
    const realm = resolveRealmConfig(credentials);
    const root = hex32();
    const msgId = hex32();
    const conversationId = randomUUID();
    const span = hex16();
    const parent = hex16();

    // Realm-scoped identity — override registry static (codebuddy defaults)
    // when this connection is bound to WorkBuddy.
    headers["X-Domain"] = realm.domain;
    headers["User-Agent"] = realm.userAgent;
    headers["X-IDE-Name"] = realm.ideName;
    headers["X-IDE-Type"] = realm.ideType;
    headers["X-IDE-Version"] = realm.ideVersion;

    // Content-Type override — CLI capture sends charset marker.
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Accept"] = "application/json";
    headers["X-Agent-Intent"] = "craft";

    // Conversation identity
    headers["X-Conversation-ID"] = conversationId;
    headers["X-Conversation-Request-ID"] = root;
    headers["X-Conversation-Message-ID"] = msgId;
    headers["X-Request-ID"] = msgId;
    headers["X-Root-Request-ID"] = root;

    // Distributed trace family (B3 + W3C traceparent)
    headers["X-B3-TraceId"] = root;
    headers["X-B3-SpanId"] = span;
    headers["X-B3-ParentSpanId"] = parent;
    headers["X-B3-Sampled"] = "1";
    headers["X-Trace-ID"] = root;
    headers["traceparent"] = `00-${root}-${span}-01`;
    headers["b3"] = `${root}-${span}-1-${parent}`;

    // User identity — derive from JWT sub. API keys (ck_/pt_) return "".
    const token = credentials?.apiKey || credentials?.accessToken || "";
    const uid = jwtSub(token);
    if (uid) headers["X-User-Id"] = uid;

    // Legacy explicit domain override still honored (predates realm setting).
    if (credentials?.providerSpecificData?.domain) {
      headers["X-Domain"] = credentials.providerSpecificData.domain;
    }
    return headers;
  }
}

export default CodeBuddyGlobalExecutor;
