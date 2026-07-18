import { getAdapter } from "@/lib/db/driver.js";

const FREE_TOKEN_QUOTA_PER_ACCOUNT = 1000000;
const QWENCLOUD_MODELS = ["glm-5.2", "deepseek-v4-pro", "qwen3.7-max"];

export async function getQwenCloudUsage(apiKey, providerSpecificData = {}, proxyOptions = null, connectionId = null) {
  let accountCount = null;   // null = DB query failed; distinguish from "0 accounts"
  let usedPerModel = {};
  let dbError = null;
  try {
    const db = await getAdapter();
    const countRow = db.get(`SELECT COUNT(*) as cnt FROM providerConnections WHERE provider = 'qwencloud' AND isActive = 1`);
    // Fall back to full-table count if isActive query returns 0 (some rows may
    // predate the isActive column default). If both fail, leave accountCount null.
    if (typeof countRow?.cnt === "number") {
      accountCount = countRow.cnt;
    }
    const rows = db.all(
      `SELECT model, SUM(promptTokens + completionTokens) as used
       FROM usageHistory
       WHERE provider = 'qwencloud'
       GROUP BY model`
    );
    for (const row of rows) {
      if (row.model && row.used) usedPerModel[row.model] = row.used;
    }
  } catch (e) {
    dbError = e?.message || String(e);
  }

  // If DB was unreachable we can't compute a real quota — surface that instead
  // of returning a misleading "Free (1 accounts) / 1M tokens" number.
  if (accountCount === null) {
    return {
      plan: "Free (unknown — DB unavailable)",
      message: dbError ? `Quota unavailable: ${dbError}` : "Quota unavailable: local DB unreachable.",
      quotas: {},
      authMode: "apikey",
    };
  }

  const totalQuota = accountCount * FREE_TOKEN_QUOTA_PER_ACCOUNT;

  const quotas = {};
  for (const modelId of QWENCLOUD_MODELS) {
    const used = usedPerModel[modelId] || 0;
    const remaining = Math.max(0, totalQuota - used);
    quotas[modelId] = {
      used,
      total: totalQuota,
      remaining,
      resetAt: null,
      unit: "tokens",
      unlimited: false,
      remainingPercentage: totalQuota > 0 ? Math.round((remaining / totalQuota) * 100) : 0,
    };
  }

  return {
    plan: `Free (${accountCount} account${accountCount === 1 ? "" : "s"})`,
    quotas,
    authMode: "apikey",
  };
}
