import { randomUUID } from "crypto";
import { gzipSync } from "zlib";
import { DefaultExecutor } from "./default.js";
import {
  createContentFilterCache,
  applyFiltersToMessages,
} from "../utils/contentFilters.js";

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

function requestId() {
  return randomUUID().replace(/-/g, "");
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

  buildHeaders(credentials) {
    const headers = super.buildHeaders(credentials, true);
    const reqId = requestId();
    const conversationId = requestId();
    Object.assign(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Request-ID": reqId,
      "X-Conversation-ID": conversationId,
      "X-Conversation-Request-ID": conversationId,
      "X-Conversation-Message-ID": reqId,
      "X-Agent-Intent": "craft",
      "X-Private-Data": "false",
    });
    if (credentials.providerSpecificData?.domain) headers["X-Domain"] = credentials.providerSpecificData.domain;
    return headers;
  }

  prepareRequestBody(transformedBody, headers) {
    headers["Content-Encoding"] = "gzip";
    return gzipSync(JSON.stringify(transformedBody));
  }
}

export default CodeBuddyGlobalExecutor;
