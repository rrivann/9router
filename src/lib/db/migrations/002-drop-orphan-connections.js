// v2 — CodeBuddy-only fork: drop connections/usage rows for any provider
// that no longer exists in the pruned registry (only codebuddy + codebuddy-cn
// survive). Combos whose model list references removed providers are also
// pruned so the /combos page never lists a broken alias.
//
// DESTRUCTIVE + irreversible. Backup taken before Phase 2 lands as
// ~/.9router/db/data.sqlite.pre-prune-*.backup.

const ALLOWED = ["codebuddy", "codebuddy-cn"];

// Placeholder-safe: builds "('codebuddy','codebuddy-cn')" without string
// concatenation from user input.
const ALLOWED_LIST = `(${ALLOWED.map((p) => `'${p}'`).join(", ")})`;

function pruneCombosReferencingRemovedProviders(db) {
  const rows = db.all(`SELECT id, models FROM combos`);
  if (!Array.isArray(rows) || rows.length === 0) return;

  const toDelete = [];
  for (const row of rows) {
    try {
      const models = JSON.parse(row.models);
      if (!Array.isArray(models)) continue;
      // Model id shape: "cb/claude-opus-5", "cbcn/glm-5.2", "codex/gpt-5", ...
      // Any model whose alias/prefix does NOT belong to an allowed provider
      // makes the combo unusable in this fork; drop the row.
      // Empty combo is dead weight — drop it too.
      if (models.length === 0) {
        toDelete.push(row.id);
        continue;
      }
      const hasForbidden = models.some((m) => {
        const modelId = typeof m === "string" ? m : m?.id || "";
        const slash = modelId.indexOf("/");
        if (slash === -1) return false;
        const prefix = modelId.slice(0, slash);
        return !(prefix === "cb" || prefix === "cbcn" || ALLOWED.includes(prefix));
      });
      if (hasForbidden) toDelete.push(row.id);
    } catch {
      // Malformed JSON → drop the row (it wasn't going to route correctly anyway).
      toDelete.push(row.id);
    }
  }

  for (const id of toDelete) {
    db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  }
}

export default {
  version: 2,
  name: "drop-orphan-connections",
  up(db) {
    db.run(`DELETE FROM providerConnections WHERE provider NOT IN ${ALLOWED_LIST}`);
    db.run(`DELETE FROM usageHistory WHERE provider NOT IN ${ALLOWED_LIST}`);
    db.run(`DELETE FROM requestDetails WHERE provider NOT IN ${ALLOWED_LIST}`);
    // usageDaily is (dateKey, data JSON) — no provider column to filter; skip.

    // customModels live in kv (scope='customModels'). Key encodes provider —
    // "cb", "cbcn" for allowed providers, anything else (qwencloud, openai-*,
    // openai-compatible-chat-*) is removed here.
    db.run(`
      DELETE FROM kv
      WHERE scope = 'customModels'
        AND key NOT IN ('cb', 'cbcn', 'codebuddy', 'codebuddy-cn')
    `);

    // disabledModels also key by provider alias.
    db.run(`
      DELETE FROM kv
      WHERE scope = 'disabledModels'
        AND key NOT IN ('cb', 'cbcn', 'codebuddy', 'codebuddy-cn')
    `);

    // Prune combos whose model list references removed providers OR is empty.
    pruneCombosReferencingRemovedProviders(db);
  },
};
