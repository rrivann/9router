// Regression tests for Batch 3 perf caches (settings + combos).
// Ensures TTL cache serves stale value within window and invalidates
// after write / manual call.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock adapter — count SQL calls to prove caching works.
let sqlGetCount = 0;
let sqlAllCount = 0;
let currentSettingsRow = { data: JSON.stringify({ rtkEnabled: true, foo: "v1" }) };
let currentCombosRows = [
  { id: "c1", name: "combo-a", kind: null, models: '["a/1","b/2"]', createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: (sql /*, params */) => {
      sqlGetCount++;
      if (sql.includes("FROM settings")) return currentSettingsRow;
      if (sql.includes("FROM combos WHERE id")) return currentCombosRows[0];
      return null;
    },
    all: (sql) => {
      sqlAllCount++;
      if (sql.includes("FROM combos")) return currentCombosRows;
      return [];
    },
    run: () => ({ changes: 1 }),
    transaction: (fn) => fn(),
  }),
}));

const { getSettings, updateSettings, invalidateSettingsCache } = await import(
  "../../src/lib/db/repos/settingsRepo.js"
);
const { getCombos, getComboByName, invalidateCombosCache, createCombo, deleteCombo } = await import(
  "../../src/lib/db/repos/combosRepo.js"
);

beforeEach(() => {
  sqlGetCount = 0;
  sqlAllCount = 0;
  invalidateSettingsCache();
  invalidateCombosCache();
});

describe("Perf #1 — settings cache", () => {
  it("hits SQLite only once for repeated getSettings within TTL", async () => {
    const a = await getSettings();
    const b = await getSettings();
    const c = await getSettings();
    expect(sqlGetCount).toBe(1); // one SELECT total, not three
    expect(a).toBe(b);
    expect(b).toBe(c); // reference equality — same cached object
  });

  it("returns merged shape including defaults on first call", async () => {
    const s = await getSettings();
    expect(s.rtkEnabled).toBe(true);
    expect(s.foo).toBe("v1");
    expect(s.stickyRoundRobinLimit).toBeDefined(); // default filled in
  });

  it("invalidateSettingsCache forces re-read", async () => {
    await getSettings();
    invalidateSettingsCache();
    await getSettings();
    expect(sqlGetCount).toBe(2);
  });

  it("updateSettings invalidates cache automatically", async () => {
    await getSettings();
    // Simulate write path — updateSettings runs its own SELECT inside the txn
    // plus this test's mock counts that. We only assert getSettings after
    // update DOES re-fetch (proving cache is dirty).
    currentSettingsRow = { data: JSON.stringify({ rtkEnabled: false, foo: "v2" }) };
    await updateSettings({ foo: "v2" });
    const after = await getSettings();
    expect(after.foo).toBe("v2");
  });
});

describe("Perf #2 — combos cache", () => {
  it("hits SQLite only once for repeated getComboByName within TTL", async () => {
    await getComboByName("combo-a");
    await getComboByName("combo-a");
    await getComboByName("combo-a");
    expect(sqlAllCount).toBe(1); // Map lookup after first fetch
  });

  it("getCombos + getComboByName share the same cache load", async () => {
    await getCombos();
    await getComboByName("combo-a");
    expect(sqlAllCount).toBe(1);
  });

  it("returns null for unknown combo name (no crash on Map miss)", async () => {
    const c = await getComboByName("does-not-exist");
    expect(c).toBeNull();
  });

  it("createCombo invalidates cache", async () => {
    await getCombos();
    await createCombo({ name: "combo-b", models: [] });
    // Next fetch re-hits SQLite
    await getCombos();
    expect(sqlAllCount).toBe(2);
  });

  it("deleteCombo invalidates cache", async () => {
    await getCombos();
    await deleteCombo("c1");
    await getCombos();
    expect(sqlAllCount).toBe(2);
  });
});
