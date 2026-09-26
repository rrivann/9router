import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

// TTL cache: validateApiKey runs on every /v1/chat/completions request; the
// underlying SELECT is O(1) on the `key` unique index but the roundtrip still
// adds a few ms and holds a DB connection during high-QPS bursts.
const CACHE_TTL_MS = 30_000;
let cachedList = null;
let cachedAt = 0;

function invalidateApiKeysCache() {
  cachedList = null;
  cachedAt = 0;
}

async function getAllKeysCached() {
  if (cachedList && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedList;
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  cachedList = rows.map(rowToKey);
  cachedAt = Date.now();
  return cachedList;
}

export { invalidateApiKeysCache };

export async function getApiKeys() {
  return [...(await getAllKeysCached())];
}

export async function getApiKeyById(id) {
  const list = await getAllKeysCached();
  return list.find((k) => k.id === id) || null;
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
  );
  invalidateApiKeysCache();
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  invalidateApiKeysCache();
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  invalidateApiKeysCache();
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const list = await getAllKeysCached();
  const hit = list.find((k) => k.key === key);
  return !!(hit && hit.isActive);
}
