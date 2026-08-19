/**
 * CodeBuddy Global (www.codebuddy.ai) usage handler.
 *
 * Ported from the official decolua/9router unified codebuddy handler: the same
 * refill-vs-bonus classification, the same Cycle and Capacity field split, and
 * the same recurring flag so the UI shows "Resets in" vs "Expires in".
 *
 * The previous implementation grouped accounts by hardcoded PackageCode and
 * read CapacityRemain* for the remaining value. Tencent's billing API does not
 * update CapacityRemain* in real-time for bonus/expired packs (it stays at the
 * original quota), so "Other Credits" showed remaining=100 even when the pack
 * was fully consumed. The official model never reads Remain fields — it only
 * uses used + total and derives remaining = total - used, which is always
 * correct regardless of which credit type the account represents.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy";

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

export async function getCodeBuddyUsage(accessToken, providerSpecificData = {}, proxyOptions = null, apiKey = null) {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy credential not available." };
  }

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
      return { message: "CodeBuddy credential invalid or expired." };
    }
    if (!response.ok) {
      return { message: `CodeBuddy quota API error (${response.status}).` };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return { message: `CodeBuddy quota error: ${json?.msg || "unknown"}` };
    }

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) {
      return { message: "CodeBuddy connected. No credit package found." };
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
    // Refill packs first: cadence-labelled, using the *Cycle* balance and
    // resetting at the next refresh.
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
        // Recurring allowance: the CycleEndTime is the next refresh, not the
        // final expiry. The UI must show "Resets in", not "Expires in".
        recurring: true,
      };
    });
    // Bonus packs: use the lifetime Capacity balance; resetAt is the expiry.
    // These are one-shot credits (CycleEndTime == DeductionEndTime), so they
    // never replenish — mark recurring:false so the UI shows "Expires in"
    // instead of implying a monthly refill.
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
    const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy";

    return { plan, quotas };
  } catch (error) {
    return { message: `CodeBuddy error: ${error.message}` };
  }
}
