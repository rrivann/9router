/**
 * Session Manager
 *
 * Resolve a stable session id per connection for prompt caching. Falls back
 * to a client-provided id from headers/body when available, otherwise
 * generates one per connection (kept in-memory for the process lifetime).
 */

import crypto from "crypto";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

// Runtime storage: Key = connectionId, Value = { sessionId, lastUsed }
const runtimeSessionStore = new Map();

// Periodically evict entries that haven't been used within TTL
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of runtimeSessionStore) {
        if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
            runtimeSessionStore.delete(key);
        }
    }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanupInterval.unref) cleanupInterval.unref();

const MAX_SESSIONS = 1000;

function generateBinaryStyleId() {
    return crypto.randomUUID() + Date.now().toString();
}

function deriveSessionId(connectionId) {
    if (!connectionId) return generateBinaryStyleId();

    const existing = runtimeSessionStore.get(connectionId);
    if (existing) {
        existing.lastUsed = Date.now();
        return existing.sessionId;
    }

    if (runtimeSessionStore.size >= MAX_SESSIONS) {
        runtimeSessionStore.delete(runtimeSessionStore.keys().next().value);
    }

    const sessionId = generateBinaryStyleId();
    runtimeSessionStore.set(connectionId, { sessionId, lastUsed: Date.now() });
    return sessionId;
}

// Client headers/body fields that carry an upstream session id (priority order)
const SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id"];
const CLAUDE_CODE_SESSION_RE = /_session_([a-f0-9-]+)$/;

function normalizeSessionId(value) {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (!v || v.length > 256) return null;
    return v;
}

function extractClaudeCodeSession(userId) {
    if (typeof userId !== "string" || !userId) return null;
    const m = userId.match(CLAUDE_CODE_SESSION_RE);
    if (m) return m[1];
    if (userId[0] === "{") {
        try { return normalizeSessionId(JSON.parse(userId)?.session_id); } catch { /* noop */ }
    }
    return null;
}

function headerValue(headers, key) {
    if (!headers || typeof headers !== "object") return null;
    return normalizeSessionId(headers[key] ?? headers[key.toLowerCase()]);
}

function extractClientSessionId(headers, body) {
    const claude = extractClaudeCodeSession(body?.metadata?.user_id);
    if (claude) return `claude:${claude}`;
    for (const key of SESSION_HEADER_KEYS) {
        const v = headerValue(headers, key);
        if (v) return v;
    }
    const requestId = headerValue(headers, "x-client-request-id");
    if (requestId) return requestId;
    return normalizeSessionId(body?.prompt_cache_key)
        || normalizeSessionId(body?.session_id)
        || normalizeSessionId(body?.conversation_id)
        || normalizeSessionId(body?.metadata?.user_id)
        || null;
}

export function resolveSessionId({ headers, body, connectionId } = {}) {
    const client = extractClientSessionId(headers, body);
    if (client) return client;
    return deriveSessionId(connectionId);
}
