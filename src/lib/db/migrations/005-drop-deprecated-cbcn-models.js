// v5 — drop DB rows referencing cbcn models that were deprecated upstream.
// Synced 2026-09-21 with inferhub.dev/pricing published catalog. Removed:
//   glm-4.7, glm-5.0, glm-5.0-turbo, glm-5.1, glm-5v-turbo, hy3-preview,
//   kimi-k2.5, kimi-k3-1 (renamed to kimi-k3), deepseek-v3-2-volc
//
// Also cleans:
//   - combos whose model list references a dropped id
//   - kv rows in scope='customModels' / 'disabledModels' keyed on those ids
//
// The connection table doesn't hold the model in a column (they're chosen per
// request), so no providerConnections row needs to be dropped.

const DROPPED_CBCN = new Set([
  "glm-4.7",
  "glm-5.0",
  "glm-5.0-turbo",
  "glm-5.1",
  "glm-5v-turbo",
  "hy3-preview",
  "kimi-k2.5",
  "kimi-k3-1",
  "deepseek-v3-2-volc",
]);

function pruneCombosReferencingDroppedModels(db) {
  const rows = db.all(`SELECT id, models FROM combos`);
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (const row of rows) {
    let models;
    try {
      models = JSON.parse(row.models);
    } catch {
      continue;
    }
    if (!Array.isArray(models)) continue;

    let changed = false;
    const kept = [];
    for (const m of models) {
      const id = typeof m === "string" ? m : m?.id || "";
      // id shape "cbcn/glm-4.7" — check prefix + suffix
      if (id.startsWith("cbcn/")) {
        const suffix = id.slice("cbcn/".length);
        if (DROPPED_CBCN.has(suffix)) {
          changed = true;
          continue;
        }
      }
      kept.push(m);
    }
    if (!changed) continue;
    if (kept.length === 0) {
      db.run(`DELETE FROM combos WHERE id = ?`, [row.id]);
    } else {
      db.run(`UPDATE combos SET models = ? WHERE id = ?`, [JSON.stringify(kept), row.id]);
    }
  }
}

export default {
  version: 5,
  name: "drop-deprecated-cbcn-models",
  up(db) {
    pruneCombosReferencingDroppedModels(db);
    // customModels + disabledModels keyed by full "provider/model" string in
    // kv rows: match the exact dropped ids.
    // NOTE: fork stores them keyed by provider alias only (cb, cbcn) with the
    // model list in the value blob. Wipe the whole cbcn scope so it rebuilds
    // fresh from the registry — safer than editing the JSON in place.
    db.run(`
      DELETE FROM kv
      WHERE scope IN ('customModels', 'disabledModels')
        AND key IN ('cbcn', 'codebuddy-cn')
    `);
  },
};
