import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";


const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  dnsToolEnabled: {},
  rtkEnabled: true,
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

// Short-TTL cache for the merged settings object. Every chat request hits
// getSettings() 3× (chat.js dispatcher, auth.js getProviderCredentials, and
// again for providerThinking/rtkEnabled/etc). Each call was a SQLite read +
// JSON parse + defaults iteration; caching for 5s absorbs ~99% of that.
// Cache is invalidated on updateSettings() and exported for external
// invalidation (e.g. content-filter cache wiring).
const SETTINGS_CACHE_TTL_MS = 5_000;
let _settingsCache = { value: null, expiresAt: 0 };

export function invalidateSettingsCache() {
  _settingsCache = { value: null, expiresAt: 0 };
}

export async function getSettings() {
  const now = Date.now();
  if (_settingsCache.value && _settingsCache.expiresAt > now) {
    return _settingsCache.value;
  }
  const raw = await readRaw();
  const merged = mergeWithDefaults(raw);
  _settingsCache = { value: merged, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return merged;
}

// Nested maps that UI often PATCHes as a whole object after GET — deep-merge
// per-key so concurrent tabs don't clobber each other's provider entries.
const DEEP_MERGE_SETTING_KEYS = new Set([
  "providerStrategies",
  "providerThinking",
  "contentFilters",
  "comboStrategies",
]);

function deepMergeSettings(current, updates) {
  const next = { ...current, ...updates };
  for (const key of DEEP_MERGE_SETTING_KEYS) {
    if (
      updates[key] &&
      typeof updates[key] === "object" &&
      !Array.isArray(updates[key])
    ) {
      const base =
        current[key] && typeof current[key] === "object" && !Array.isArray(current[key])
          ? current[key]
          : {};
      // Per-provider key: null/undefined in update means "delete override".
      // contentFilters also treats [] as clear (no filters for that provider).
      const merged = { ...base };
      for (const [k, v] of Object.entries(updates[key])) {
        if (v === null || v === undefined) {
          delete merged[k];
        } else if (key === "contentFilters" && Array.isArray(v) && v.length === 0) {
          delete merged[k];
        } else if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
          merged[k] = { ...base[k], ...v };
        } else {
          merged[k] = v;
        }
      }
      next[key] = merged;
    }
  }
  return next;
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = deepMergeSettings(current, updates);
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  invalidateSettingsCache();
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
