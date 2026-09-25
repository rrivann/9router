/**
 * Shared content-filter helper for executors that support pattern/replacement
 * rewriting of outgoing message text.
 *
 * Usage inside an executor:
 *
 *   import {
 *     createContentFilterCache, applyFiltersToMessages,
 *   } from "../utils/contentFilters.js";
 *   const filters = createContentFilterCache("codebuddy");
 *
 *   async execute(params) {
 *     this._contentFilters = await filters.load();
 *     return super.execute(params);
 *   }
 *
 *   transformRequest(model, body) {
 *     const rules = this._contentFilters || [];
 *     if (rules.length && Array.isArray(body.messages)) {
 *       const { messages, applied } = applyFiltersToMessages(body.messages, rules);
 *       body.messages = messages;
 *       // stash `applied` somewhere the request-details writer can find it
 *       this._filtersApplied = applied;
 *     }
 *     return body;
 *   }
 *
 * Export `filters.invalidate` so the settings route can hot-reload rules:
 *   export const invalidateContentFiltersCache = filters.invalidate;
 */

import { getSettings } from "@/lib/localDb.js";

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
            return {
              regex: new RegExp(f.pattern, "g"),
              pattern: f.pattern,
              replacement: f.replacement ?? "",
            };
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
 * Apply the compiled filter set to a single string. Returns { text, applied[] }
 * where applied is a per-rule hit map. Non-matching rules are omitted.
 */
function applyFiltersToStringWithStats(text, filters, statsMap) {
  if (typeof text !== "string" || !text || !filters || filters.length === 0) return text;
  let result = text;
  for (const filter of filters) {
    let hits = 0;
    result = result.replace(filter.regex, () => {
      hits++;
      return filter.replacement;
    });
    if (hits > 0) {
      const key = filter.pattern;
      const existing = statsMap.get(key);
      if (existing) {
        existing.hits += hits;
      } else {
        statsMap.set(key, {
          pattern: filter.pattern,
          replacement: filter.replacement,
          hits,
        });
      }
    }
  }
  return result;
}

/**
 * Rewrite the text of every message in a chat/completions-style `messages`
 * array. Returns { messages, applied } where `applied` is an array of
 * { pattern, replacement, hits } for every rule that fired at least once.
 * Non-text parts (images, tool results) pass through untouched.
 */
export function applyFiltersToMessages(messages, filters) {
  if (!Array.isArray(messages) || !filters || filters.length === 0) {
    return { messages, applied: [] };
  }
  const stats = new Map();
  const next = messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    if (typeof msg.content === "string") {
      return { ...msg, content: applyFiltersToStringWithStats(msg.content, filters, stats) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (!part || typeof part !== "object") return part;
          if (typeof part.text === "string") {
            return { ...part, text: applyFiltersToStringWithStats(part.text, filters, stats) };
          }
          return part;
        }),
      };
    }
    return msg;
  });
  return { messages: next, applied: [...stats.values()] };
}

