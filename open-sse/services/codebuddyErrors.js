// CodeBuddy / WorkBuddy upstream error classifier.
//
// The realm returns 429/403 for four semantically different conditions and
// each demands a different action (retry vs skip connection vs rotate pool
// vs give up). See codebuddyai.txt § "Error codes" and workbuddyai.txt § 1
// for the wire spec.
//
//   429 14018  "Credits exhausted"           → mark connection exhausted; rotate to next in pool.
//   403 11140  "request illegal"             → mark connection banned; remove from pool + auto-purge.
//   429 14003  "too many requests"           → global backoff (5s → 60s cap) then retry same conn.
//   429 14017  "trial version not activated" → skip connection this window; farm side has to fix.
//
// Body may arrive as raw string or already-parsed object. Both shapes handled.

export const CB_ERROR = Object.freeze({
  CREDITS_EXHAUSTED: "credits_exhausted",
  BANNED: "banned",
  RATE_LIMITED: "rate_limited",
  TRIAL_NOT_ACTIVATED: "trial_not_activated",
  OTHER: "other",
});

// Match strategy: check numeric `code` field first (most reliable), then
// substring on message text as fallback for cases where body is a raw string
// or the code isn't parsed out.
function readBodyCode(body) {
  if (body == null) return { code: null, message: "" };
  if (typeof body === "object") {
    const code = typeof body.code === "number" ? body.code : Number(body.code);
    const message = typeof body.message === "string" ? body.message : "";
    return { code: Number.isFinite(code) ? code : null, message };
  }
  const text = String(body);
  const parsed = tryParseJson(text);
  if (parsed && typeof parsed === "object") return readBodyCode(parsed);
  return { code: null, message: text };
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function isCreditsExhausted(status, body) {
  if (status !== 429) return false;
  const { code, message } = readBodyCode(body);
  if (code === 14018) return true;
  return /credits\s+exhausted/i.test(message);
}

export function isBanned(status, body) {
  if (status !== 403) return false;
  const { code, message } = readBodyCode(body);
  if (code === 11140) return true;
  return /request\s+illegal/i.test(message);
}

export function isTrialNotActivated(status, body) {
  if (status !== 429) return false;
  const { code, message } = readBodyCode(body);
  if (code === 14017) return true;
  return /trial.*not.*activated/i.test(message);
}

export function isRateLimited(status, body) {
  if (status !== 429) return false;
  // Guard against 14018/14017 which are also 429 — they're NOT rate limits,
  // so classify them first and treat rate-limit as fallback for other 429s.
  if (isCreditsExhausted(status, body)) return false;
  if (isTrialNotActivated(status, body)) return false;
  const { code, message } = readBodyCode(body);
  if (code === 14003) return true;
  return /too\s+many\s+requests/i.test(message);
}

/**
 * Return one of the CB_ERROR enums for the given (status, body) pair, or
 * CB_ERROR.OTHER if no CB-specific code matches.
 */
export function classifyCodebuddyError(status, body) {
  if (isCreditsExhausted(status, body)) return CB_ERROR.CREDITS_EXHAUSTED;
  if (isBanned(status, body)) return CB_ERROR.BANNED;
  if (isRateLimited(status, body)) return CB_ERROR.RATE_LIMITED;
  if (isTrialNotActivated(status, body)) return CB_ERROR.TRIAL_NOT_ACTIVATED;
  return CB_ERROR.OTHER;
}

/**
 * Policy hint per classification — consumed by the executor / connection
 * pool to decide what to do next.
 *
 * @returns { retry: boolean, rotate: boolean, disable: boolean,
 *            disableWindowMs: number | null }
 */
export function errorPolicy(kind) {
  switch (kind) {
    case CB_ERROR.CREDITS_EXHAUSTED:
      // Credits reset ~ every 5h on CB. Mark connection exhausted for that
      // window; caller may still rotate to another connection immediately.
      return { retry: false, rotate: true, disable: true, disableWindowMs: 5 * 60 * 60 * 1000 };
    case CB_ERROR.BANNED:
      // No recovery path — connection is dead, mark permanently disabled.
      return { retry: false, rotate: true, disable: true, disableWindowMs: null };
    case CB_ERROR.TRIAL_NOT_ACTIVATED:
      // Farm-side issue: user must complete signup. Skip this connection
      // for a while, but don't purge — trial may activate later.
      return { retry: false, rotate: true, disable: true, disableWindowMs: 60 * 60 * 1000 };
    case CB_ERROR.RATE_LIMITED:
      // Per-IP rate limit — same connection may succeed after cooldown.
      // Caller applies global backoff, retries same connection.
      return { retry: true, rotate: false, disable: false, disableWindowMs: null };
    default:
      return { retry: false, rotate: false, disable: false, disableWindowMs: null };
  }
}
