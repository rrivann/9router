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
//   429 6004   "usage exceeds frequency limit" → per-model quota window; disable the connection
//              until the reset time in the message, revive when the whole pool is locked out.
//
// Body may arrive as raw string or already-parsed object. Both shapes handled.

export const CB_ERROR = Object.freeze({
  CREDITS_EXHAUSTED: "credits_exhausted",
  BANNED: "banned",
  RATE_LIMITED: "rate_limited",
  TRIAL_NOT_ACTIVATED: "trial_not_activated",
  FREQUENCY_LIMITED: "frequency_limited",
  OTHER: "other",
});

// Match strategy: check numeric `code` field first (most reliable), then
// substring on message text as fallback for cases where body is a raw string
// or the code isn't parsed out.
function readBodyCode(body) {
  if (body == null) return { code: null, message: "" };
  if (typeof body === "object") {
    const code = typeof body.code === "number" ? body.code : Number(body.code);
    // Some realms (6004 frequency limit) return the text in `msg`, not `message`.
    const rawMessage = typeof body.message === "string" ? body.message
      : typeof body.msg === "string" ? body.msg
      : "";
    return { code: Number.isFinite(code) ? code : null, message: rawMessage };
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

export function isFrequencyLimited(status, body) {
  if (status !== 429) return false;
  const { code, message } = readBodyCode(body);
  if (code === 6004) return true;
  return /frequency\s+limit/i.test(message);
}

// Reset time embedded in the 6004 message, e.g. "reset at 2026-10-10 12:57:38 UTC+8".
// Returns epoch ms, or null when absent/unparseable.
const FREQUENCY_RESET_RE = /reset\s+at\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*UTC([+-])(\d{1,2})(?::?(\d{2}))?/i;

export function parseFrequencyResetMs(body) {
  const { message } = readBodyCode(body);
  const m = FREQUENCY_RESET_RE.exec(message || "");
  if (!m) return null;
  const [, date, time, sign, hh, mm] = m;
  const offsetMin = (Number(hh) * 60 + Number(mm || 0)) * (sign === "-" ? -1 : 1);
  const utcMs = Date.parse(`${date}T${time}Z`);
  if (!Number.isFinite(utcMs)) return null;
  const resetMs = utcMs - offsetMin * 60_000;
  return resetMs > Date.now() ? resetMs : null;
}

export function isRateLimited(status, body) {
  if (status !== 429) return false;
  // Guard against 14018/14017/6004 which are also 429 — they're NOT rate limits,
  // so classify them first and treat rate-limit as fallback for other 429s.
  if (isCreditsExhausted(status, body)) return false;
  if (isTrialNotActivated(status, body)) return false;
  if (isFrequencyLimited(status, body)) return false;
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
  if (isFrequencyLimited(status, body)) return CB_ERROR.FREQUENCY_LIMITED;
  if (isTrialNotActivated(status, body)) return CB_ERROR.TRIAL_NOT_ACTIVATED;
  if (isRateLimited(status, body)) return CB_ERROR.RATE_LIMITED;
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
    case CB_ERROR.FREQUENCY_LIMITED:
      // Per-model quota window (message carries the reset time). Rotate to
      // another connection; the caller may disable until reset or revive the
      // whole pool once every connection is locked out.
      return { retry: false, rotate: true, disable: true, disableWindowMs: null };
    case CB_ERROR.RATE_LIMITED:
      // Per-IP rate limit — same connection may succeed after cooldown.
      // Caller applies global backoff, retries same connection.
      return { retry: true, rotate: false, disable: false, disableWindowMs: null };
    default:
      return { retry: false, rotate: false, disable: false, disableWindowMs: null };
  }
}
