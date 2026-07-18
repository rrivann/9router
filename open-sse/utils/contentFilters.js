/**
 * Shared content-filter helper for executors that support pattern/replacement
 * rewriting of outgoing message text.
 *
 * Before this file existed the same ~65 LOC block was cloned across 4
 * executors (codebuddy, codebuddy-cn, qwencloud), plus a matching
 * fan-out of 4 `invalidateContentFiltersCache` re-exports that
 * `src/app/api/settings/route.js` had to wire individually.
 *
 * Usage inside an executor:
 *
 *   import { createContentFilterCache, applyFiltersToMessages } from "../utils/contentFilters.js";
 *   const filters = createContentFilterCache("qwencloud");
 *   ...
 *   async execute(params) {
 *     this._contentFilters = await filters.load();
 *     return super.execute(params);
 *   }
 *
 *   transformRequest(model, body) {
 *     const rules = this._contentFilters || [];
 *     if (rules.length &amp;&amp; Array.isArray(body.messages)) {
 *       body.messages = applyFiltersToMessages(body.messages, rules);
 *     }
 *     return body;
 *   }
 *
 * And export `filters.invalidate` so the settings route can hot-reload:
 *   export const invalidateContentFiltersCache = filters.invalidate;
 */

import { getSettings } from "@/lib/localDb.js";

/**
 * Create a lazy, per-settings-key cache of compiled regex filters. Cache is
 * populated on first `load()` and reset via `invalidate()`. Malformed regex
 * patterns are silently skipped so one bad rule doesn't disable the rest.
 */
export function createContentFilterCache(settingsKey) {
  let pending = null;

  async function load() {
    if (pending !== null) return pending;
    try {
      const settings = await getSettings();
      const raw = settings?.contentFilters?.[settingsKey];
      if (!Array.isArray(raw) || raw.length === 0) {
        pending = [];
        return pending;
      }
      pending = raw
        .filter((f) => f.enabled !== false && f.pattern)
        .map((f) => {
          try {
            return { regex: new RegExp(f.pattern, "g"), replacement: f.replacement ?? "" };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      pending = [];
    }
    return pending;
  }

  function invalidate() {
    pending = null;
  }

  return { load, invalidate };
}

/**
 * Apply the compiled filter set to a single string. Returns the string
 * unchanged when `text` isn't a non-empty string or no filters are active.
 */
export function applyFiltersToString(text, filters) {
  if (typeof text !== "string" || !text || !filters || filters.length === 0) return text;
  let result = text;
  for (const filter of filters) {
    result = result.replace(filter.regex, filter.replacement);
  }
  return result;
}

/**
 * Rewrite the text of every message in a chat/completions-style `messages`
 * array. Content may be a plain string or an array of parts with `.text`.
 * Non-text parts (images, tool results, etc.) pass through untouched.
 */
export function applyFiltersToMessages(messages, filters) {
  if (!Array.isArray(messages) || !filters || filters.length === 0) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    if (typeof msg.content === "string") {
      return { ...msg, content: applyFiltersToString(msg.content, filters) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (!part || typeof part !== "object") return part;
          if (typeof part.text === "string") {
            return { ...part, text: applyFiltersToString(part.text, filters) };
          }
          return part;
        }),
      };
    }
    return msg;
  });
}

/**
 * Rewrite the text of every item in a Responses API `input` array. Items are
 * message objects where `content` is a string or an array of parts (e.g.
 * `{ type: "input_text", text }`).
 */
export function applyFiltersToInput(input, filters) {
  if (!Array.isArray(input) || !filters || filters.length === 0) return input;
  return input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    if (typeof item.content === "string") {
      return { ...item, content: applyFiltersToString(item.content, filters) };
    }
    if (Array.isArray(item.content)) {
      return {
        ...item,
        content: item.content.map((part) => {
          if (!part || typeof part !== "object") return part;
          if (typeof part.text === "string") {
            return { ...part, text: applyFiltersToString(part.text, filters) };
          }
          return part;
        }),
      };
    }
    return item;
  });
}
