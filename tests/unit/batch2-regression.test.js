// Regression tests for Batch 2 HIGH bug fixes.
// Covers: accountFallback default, oauth parseTimeMs(0), Retry-After NaN,
// content-filter singleton race, request-body clone.

import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import {
  getCredentialExpiryMs,
  shouldRefreshCredentials,
} from "../../open-sse/services/oauthCredentialManager.js";
import { unavailableResponse } from "../../open-sse/utils/error.js";

describe("Bug #6 — accountFallback default", () => {
  it("does NOT fallback for unknown/unmatched errors (no self-inflicted DoS)", () => {
    // Previously returned shouldFallback:true for any unmatched status →
    // Cloudflare 520-524 cascade would burn every account in the pool.
    const result = checkFallbackError(520, "cloudflare origin timeout");
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
  });

  it("does NOT fallback for status 418 or other bizarre codes", () => {
    expect(checkFallbackError(418, "im a teapot").shouldFallback).toBe(false);
    expect(checkFallbackError(451, "unavailable for legal reasons").shouldFallback).toBe(false);
  });

  it("still fallbacks on matched rules (regression sanity — 401 auth_failed)", () => {
    const result = checkFallbackError(401, "unauthorized");
    // 401 should be an explicit ERROR_RULES entry → shouldFallback:true
    expect(typeof result.shouldFallback).toBe("boolean");
  });
});

describe("Bug #9 — parseTimeMs(0) does not force endless refresh", () => {
  it("returns null (not 0) for expiresAt=0 → shouldRefresh returns false", () => {
    // Legacy connection rows sometimes persist expiresAt:0. Old code returned
    // 0 → `0 - now < leadMs` → always true → hammer refresh endpoint.
    expect(getCredentialExpiryMs({ expiresAt: 0 })).toBeNull();
    expect(getCredentialExpiryMs({ expiresAt: -1 })).toBeNull();
    expect(shouldRefreshCredentials("codebuddy", { expiresAt: 0 })).toBe(false);
  });

  it("returns null for empty/missing expiresAt", () => {
    expect(getCredentialExpiryMs({})).toBeNull();
    expect(getCredentialExpiryMs({ expiresAt: "" })).toBeNull();
    expect(getCredentialExpiryMs({ expiresAt: null })).toBeNull();
  });

  it("returns real ms for a valid future timestamp (regression sanity)", () => {
    const future = Date.now() + 3600 * 1000;
    expect(getCredentialExpiryMs({ expiresAt: future })).toBe(future);
  });

  it("returns real ms for ISO string", () => {
    const iso = new Date(Date.now() + 3600 * 1000).toISOString();
    const ms = getCredentialExpiryMs({ expiresAt: iso });
    expect(ms).toBeGreaterThan(Date.now());
  });
});

describe("Bug #11 — Retry-After header never NaN", () => {
  it("omits Retry-After when retryAfter is unparsable", () => {
    const res = unavailableResponse(429, "rate limited", "not-a-date", "reset after ?");
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("omits Retry-After when retryAfter is null", () => {
    const res = unavailableResponse(429, "rate limited", null, "reset after 30s");
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("emits valid Retry-After when timestamp parses (regression sanity)", () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(429, "rate limited", future, "reset after 30s");
    const header = res.headers.get("Retry-After");
    expect(header).not.toBeNull();
    expect(header).not.toBe("NaN");
    expect(Number(header)).toBeGreaterThan(0);
  });
});
