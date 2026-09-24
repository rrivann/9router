import { describe, it, expect } from "vitest";
import {
  CB_ERROR,
  isCreditsExhausted,
  isBanned,
  isRateLimited,
  isTrialNotActivated,
  classifyCodebuddyError,
  errorPolicy,
} from "../../open-sse/services/codebuddyErrors.js";

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

  it("other → no-op policy", () => {
    const p = errorPolicy(CB_ERROR.OTHER);
    expect(p.retry).toBe(false);
    expect(p.rotate).toBe(false);
    expect(p.disable).toBe(false);
  });
});
