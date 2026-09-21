// videoJobs repo — CodeBuddy async video generation.
//
// Video submit returns a taskId immediately (status:queued); the render
// finishes minutes later. The poller service walks pending rows until each
// resolves to completed/failed.

import { getAdapter } from "../driver.js";

export async function listVideoJobs({ limit = 100, status } = {}) {
  const db = await getAdapter();
  const where = status ? "WHERE status = ?" : "";
  const params = status ? [status, limit] : [limit];
  const rows = db.all(
    `SELECT * FROM videoJobs ${where} ORDER BY createdAt DESC LIMIT ?`,
    params,
  );
  return rows || [];
}

export async function getVideoJob(id) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM videoJobs WHERE id = ?`, [Number(id)]) || null;
}

export async function getVideoJobByTaskId(taskId) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM videoJobs WHERE taskId = ?`, [taskId]) || null;
}

export async function createVideoJob({
  taskId,
  provider,
  connectionId = null,
  model,
  prompt,
  status = "queued",
  seconds = null,
}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO videoJobs(taskId, provider, connectionId, model, prompt, status, seconds, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, provider, connectionId, model, prompt, status, seconds, now, now],
  );
  const id = result?.lastInsertRowid ?? result?.lastID ?? null;
  return { id: Number(id), taskId, provider, connectionId, model, prompt, status, seconds, createdAt: now, updatedAt: now };
}

export async function updateVideoJob(id, patch = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const fields = [];
  const params = [];
  for (const k of ["status", "url", "resolution", "credit", "outputTokens", "errorMessage"]) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (fields.length === 0) return { updated: 0 };
  fields.push("updatedAt = ?");
  params.push(now);
  params.push(Number(id));
  db.run(`UPDATE videoJobs SET ${fields.join(", ")} WHERE id = ?`, params);
  return { updated: 1 };
}

export async function deleteVideoJob(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM videoJobs WHERE id = ?`, [Number(id)]);
  return { deleted: 1 };
}

export async function listPendingVideoJobs() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM videoJobs WHERE status IN ('queued', 'in_progress') ORDER BY createdAt ASC LIMIT 50`,
  );
  return rows || [];
}
