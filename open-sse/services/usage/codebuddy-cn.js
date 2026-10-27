/**
 * CodeBuddy CN usage handler
 *
 * The Tencent billing endpoint is reachable with the same Bearer CLI credential
 * the chat path already uses, so no web-session cookie / browser fingerprint is
 * needed. Calls are kept deliberately rare: one request per connection per
 * TTL window, shared across every dashboard refresh. Stale data is preferred
 * over extra calls to a billing endpoint.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy-cn";

// Billing calls per connection are capped to one per window. Quota changes on a
// monthly/bonus cadence, so a long TTL costs no accuracy in practice.
const USAGE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // connectionId → { expiresAt, value }

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null, connectionId = null) {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy CN credential not available." };
  }

  const cacheKey = connectionId || token;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const response = await proxyAwareFetch(U(PROVIDER_ID).url, {
      method: "POST",
      headers: {
        ...(PROVIDERS[PROVIDER_ID]?.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy CN credential invalid or expired." };
    }
    if (!response.ok) {
      return { message: `CodeBuddy CN quota API error (${response.status}).` };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return { message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}` };
    }

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) {
      return { message: "CodeBuddy CN connected. No credit package found." };
    }

    const cycleEndMs = (acc) => {
      const r = parseResetTime(acc.CycleEndTime);
      return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
    };
    // Refill packs roll into a new cycle before the resource expires; bonus packs
    // end exactly at expiry. >2d gap between cycle end and validity end = refill.
    const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
    const isRefill = (acc) => {
      const ce = cycleEndMs(acc);
      const de = Number(acc.DeductionEndTime);
      return Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS;
    };
    const byExpiry = (a, b) => cycleEndMs(a) - cycleEndMs(b);

    const refills = accounts.filter(isRefill).sort(byExpiry);
    const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

    const quotas = {};
    const seenRefill = {};
    refills.forEach((acc) => {
      const base = refillCadence(acc);
      seenRefill[base] = (seenRefill[base] || 0) + 1;
      const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
      const used = num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed);
      const total = num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize);
      quotas[name] = {
        used,
        total,
        remaining: Math.max(0, total - used),
        resetAt: parseResetTime(acc.CycleEndTime),
        unlimited: false,
        // Recurring allowance: CycleEndTime is the next refresh, not the expiry.
        recurring: true,
      };
    });
    // Bonus packs are one-shot credits (CycleEndTime == DeductionEndTime), so
    // they never replenish — recurring:false makes the UI show "Expires in".
    bonuses.forEach((acc, i) => {
      const used = num(acc.CapacityUsedPrecise, acc.CapacityUsed);
      const total = num(acc.CapacitySizePrecise, acc.CapacitySize);
      quotas[`Bonus Pack ${i + 1}`] = {
        used,
        total,
        remaining: Math.max(0, total - used),
        resetAt: parseResetTime(acc.CycleEndTime),
        unlimited: false,
        recurring: false,
      };
    });

    const basePkg = refills[0] || accounts[0] || {};
    const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy CN";
    const value = { plan, quotas };

    cache.set(cacheKey, { expiresAt: Date.now() + USAGE_TTL_MS, value });
    return value;
  } catch (error) {
    return { message: `CodeBuddy CN error: ${error.message}` };
  }
}
