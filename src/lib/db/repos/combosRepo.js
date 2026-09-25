import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// 5s TTL cache. Chat dispatchers call getComboByName twice per aliased-model
// request (once in handleChat, once in getModelInfo fallback). Combos list is
// tiny (usually <10 rows) and mutated rarely (via UI), so cache both the full
// list and a lookup Map for O(1) name resolution.
const COMBOS_CACHE_TTL_MS = 5_000;
let _combosCache = { list: null, byName: null, expiresAt: 0 };

export function invalidateCombosCache() {
  _combosCache = { list: null, byName: null, expiresAt: 0 };
}

async function loadCombosCache() {
  const now = Date.now();
  if (_combosCache.list && _combosCache.expiresAt > now) return _combosCache;
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  const list = rows.map(rowToCombo);
  const byName = new Map();
  for (const c of list) if (c?.name) byName.set(c.name, c);
  _combosCache = { list, byName, expiresAt: now + COMBOS_CACHE_TTL_MS };
  return _combosCache;
}

export async function getCombos() {
  const { list } = await loadCombosCache();
  return list;
}

export async function getComboById(id) {
  const { list } = await loadCombosCache();
  return list.find((c) => c.id === id) || null;
}

export async function getComboByName(name) {
  const { byName } = await loadCombosCache();
  return byName.get(name) || null;
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  invalidateCombosCache();
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  invalidateCombosCache();
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  invalidateCombosCache();
  return (res?.changes ?? 0) > 0;
}
