import { describe, it, expect } from "vitest";
import {
  CB_ERROR,
  isCreditsExhausted,
  isBanned,
  isRateLimited,
  isTrialNotActivated,
  isFrequencyLimited,
  parseFrequencyResetMs,
  classifyCodebuddyError,
  errorPolicy,
} from "../../open-sse/services/codebuddyErrors.js";

// Wire-exact 6004 body (field is `msg`, not `message`; reset time carries a UTC offset).
const FREQ_BODY = {
  code: 6004,
  msg: "usage exceeds frequency limit, but don't worry, your usage will reset at 2026-10-10 12:57:38 UTC+8, alternatively, you can switch to the other models to continue using it.",
  requestId: "339f360416724c0784838be163ffafc1",
};

describe("isCreditsExhausted", () => {
  it("matches 429 with code 14018", () => {
    expect(isCreditsExhausted(429, { code: 14018, message: "Credits exhausted" })).toBe(true);
  });

  it("matches 429 with message substring (fallback)", () => {
    expect(isCreditsExhausted(429, { message: "Credits Exhausted for user" })).toBe(true);
  });

  it("matches 429 when body is a raw JSON string", () => {
    expect(isCreditsExhausted(429, '{"code":14018,"message":"Credits exhausted"}')).toBe(true);
  });

  it("does NOT match 429 without code or message hint", () => {
    expect(isCreditsExhausted(429, { code: 14003 })).toBe(false);
  });

  it("does NOT match non-429 statuses", () => {
    expect(isCreditsExhausted(200, { code: 14018 })).toBe(false);
    expect(isCreditsExhausted(500, { code: 14018 })).toBe(false);
  });
});

describe("isBanned", () => {
  it("matches 403 with code 11140", () => {
    expect(isBanned(403, { code: 11140, message: "request illegal" })).toBe(true);
  });

  it("matches 403 with 'request illegal' message", () => {
    expect(isBanned(403, { message: "Request Illegal (policy violation)" })).toBe(true);
  });

  it("does NOT match 403 without CB signal", () => {
    expect(isBanned(403, { code: 9999, message: "forbidden" })).toBe(false);
  });

  it("does NOT match non-403 statuses", () => {
    expect(isBanned(401, { code: 11140 })).toBe(false);
  });
});

describe("isTrialNotActivated", () => {
  it("matches 429 with code 14017", () => {
    expect(isTrialNotActivated(429, { code: 14017 })).toBe(true);
  });

  it("matches 429 with 'trial ... not activated' message", () => {
    expect(isTrialNotActivated(429, { message: "The trial version is not yet activated" })).toBe(true);
  });
});

describe("isRateLimited", () => {
  it("matches 429 with code 14003", () => {
    expect(isRateLimited(429, { code: 14003, message: "too many requests" })).toBe(true);
  });

  it("matches 429 with 'too many requests' message", () => {
    expect(isRateLimited(429, { message: "Too Many Requests" })).toBe(true);
  });

  it("does NOT match 429 that is actually credits-exhausted (14018)", () => {
    expect(isRateLimited(429, { code: 14018, message: "Credits exhausted" })).toBe(false);
  });

  it("does NOT match 429 that is actually trial-not-activated (14017)", () => {
    expect(isRateLimited(429, { code: 14017, message: "trial not yet activated" })).toBe(false);
  });

  it("does NOT match 429 that is actually frequency-limited (6004)", () => {
    expect(isRateLimited(429, FREQ_BODY)).toBe(false);
  });
});

describe("isFrequencyLimited", () => {
  it("matches 429 with code 6004 (msg field)", () => {
    expect(isFrequencyLimited(429, FREQ_BODY)).toBe(true);
  });

  it("matches 429 when body is a raw JSON string", () => {
    expect(isFrequencyLimited(429, JSON.stringify(FREQ_BODY))).toBe(true);
  });

  it("matches 429 by message substring when the code is missing", () => {
    expect(isFrequencyLimited(429, { msg: "usage exceeds frequency limit" })).toBe(true);
  });

  it("does NOT match other CB 429 codes", () => {
    expect(isFrequencyLimited(429, { code: 14018 })).toBe(false);
    expect(isFrequencyLimited(429, { code: 14003 })).toBe(false);
  });

  it("does NOT match non-429 statuses", () => {
    expect(isFrequencyLimited(200, FREQ_BODY)).toBe(false);
    expect(isFrequencyLimited(500, FREQ_BODY)).toBe(false);
  });
});

describe("parseFrequencyResetMs", () => {
  it("parses 'UTC+8' into a future epoch", () => {
    const ms = parseFrequencyResetMs(FREQ_BODY);
    expect(typeof ms).toBe("number");
    // 2026-10-10 12:57:38 UTC+8 → 2026-10-10T04:57:38Z
    expect(new Date(ms).toISOString()).toBe("2026-10-10T04:57:38.000Z");
  });

  it("parses a negative offset (UTC-5)", () => {
    const ms = parseFrequencyResetMs({ code: 6004, msg: "reset at 2026-10-10 12:00:00 UTC-5" });
    expect(new Date(ms).toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });

  it("returns null when the reset time has already passed", () => {
    expect(parseFrequencyResetMs({ code: 6004, msg: "reset at 2000-01-01 00:00:00 UTC+0" })).toBeNull();
  });

  it("returns null when no reset time is present", () => {
    expect(parseFrequencyResetMs({ code: 6004, msg: "usage exceeds frequency limit" })).toBeNull();
    expect(parseFrequencyResetMs(null)).toBeNull();
  });
});

describe("classifyCodebuddyError — enum output", () => {
  it("classifies credits exhausted", () => {
    expect(classifyCodebuddyError(429, { code: 14018 })).toBe(CB_ERROR.CREDITS_EXHAUSTED);
  });

  it("classifies banned", () => {
    expect(classifyCodebuddyError(403, { code: 11140 })).toBe(CB_ERROR.BANNED);
  });

  it("classifies rate limited", () => {
    expect(classifyCodebuddyError(429, { code: 14003 })).toBe(CB_ERROR.RATE_LIMITED);
  });

  it("classifies trial not activated", () => {
    expect(classifyCodebuddyError(429, { code: 14017 })).toBe(CB_ERROR.TRIAL_NOT_ACTIVATED);
  });

  it("classifies frequency limited (6004)", () => {
    expect(classifyCodebuddyError(429, FREQ_BODY)).toBe(CB_ERROR.FREQUENCY_LIMITED);
  });

  it("returns OTHER for unrecognized error", () => {
    expect(classifyCodebuddyError(500, { message: "internal server error" })).toBe(CB_ERROR.OTHER);
    expect(classifyCodebuddyError(429, { code: 99999 })).toBe(CB_ERROR.OTHER);
    expect(classifyCodebuddyError(200, {})).toBe(CB_ERROR.OTHER);
  });

  it("handles null / undefined / empty body", () => {
    expect(classifyCodebuddyError(429, null)).toBe(CB_ERROR.OTHER);
    expect(classifyCodebuddyError(429, undefined)).toBe(CB_ERROR.OTHER);
    expect(classifyCodebuddyError(429, "")).toBe(CB_ERROR.OTHER);
  });

  it("handles malformed JSON body (falls back to string match)", () => {
    expect(classifyCodebuddyError(429, "Credits exhausted for account")).toBe(CB_ERROR.CREDITS_EXHAUSTED);
    expect(classifyCodebuddyError(403, "request illegal / banned")).toBe(CB_ERROR.BANNED);
  });
});

describe("errorPolicy — hint per classification", () => {
  it("credits_exhausted → rotate + disable 5h", () => {
    const p = errorPolicy(CB_ERROR.CREDITS_EXHAUSTED);
    expect(p.rotate).toBe(true);
    expect(p.disable).toBe(true);
    expect(p.disableWindowMs).toBe(5 * 60 * 60 * 1000);
    expect(p.retry).toBe(false);
  });

  it("banned → rotate + disable permanently", () => {
    const p = errorPolicy(CB_ERROR.BANNED);
    expect(p.rotate).toBe(true);
    expect(p.disable).toBe(true);
    expect(p.disableWindowMs).toBeNull();
  });

  it("rate_limited → retry same conn, no rotate/disable", () => {
    const p = errorPolicy(CB_ERROR.RATE_LIMITED);
    expect(p.retry).toBe(true);
    expect(p.rotate).toBe(false);
    expect(p.disable).toBe(false);
  });

  it("trial_not_activated → rotate + disable 1h", () => {
    const p = errorPolicy(CB_ERROR.TRIAL_NOT_ACTIVATED);
    expect(p.rotate).toBe(true);
    expect(p.disable).toBe(true);
    expect(p.disableWindowMs).toBe(60 * 60 * 1000);
  });

  it("frequency_limited → rotate + disable (caller decides window)", () => {
    const p = errorPolicy(CB_ERROR.FREQUENCY_LIMITED);
    expect(p.rotate).toBe(true);
    expect(p.disable).toBe(true);
    expect(p.disableWindowMs).toBeNull();
    expect(p.retry).toBe(false);
  });

  it("other → no-op policy", () => {
    const p = errorPolicy(CB_ERROR.OTHER);
    expect(p.retry).toBe(false);
    expect(p.rotate).toBe(false);
    expect(p.disable).toBe(false);
  });
});
