// chatSessions repo — dashboard AI chat history.
//
// Two read shapes:
//   listChatSessions()  → light rows (no messages blob) for the sidebar
//   getChatSession(id)  → single row with messages blob for the chat view

import { getAdapter } from "../driver.js";

export async function listChatSessions() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, title, model, messageCount, createdAt, updatedAt
     FROM chatSessions
     ORDER BY updatedAt DESC
     LIMIT 200`
  );
  return rows || [];
}

export async function getChatSession(id) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT id, title, model, messages, messageCount, createdAt, updatedAt
     FROM chatSessions WHERE id = ?`,
    [Number(id)]
  );
  return row || null;
}

export async function createChatSession({ model = null, title = "New chat" } = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO chatSessions(title, model, messages, messageCount, createdAt, updatedAt)
     VALUES(?, ?, '[]', 0, ?, ?)`,
    [title, model, now, now]
  );
  const id = result?.lastInsertRowid ?? result?.lastID ?? null;
  return { id: Number(id), title, model, messages: "[]", messageCount: 0, createdAt: now, updatedAt: now };
}

export async function updateChatSession(id, patch = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const fields = [];
  const params = [];
  if (typeof patch.title === "string") { fields.push("title = ?"); params.push(patch.title); }
  if (typeof patch.model === "string" || patch.model === null) { fields.push("model = ?"); params.push(patch.model); }
  if (typeof patch.messages === "string") { fields.push("messages = ?"); params.push(patch.messages); }
  if (typeof patch.messageCount === "number") { fields.push("messageCount = ?"); params.push(patch.messageCount); }
  if (fields.length === 0) return { updated: 0 };
  fields.push("updatedAt = ?"); params.push(now);
  params.push(Number(id));
  db.run(`UPDATE chatSessions SET ${fields.join(", ")} WHERE id = ?`, params);
  return { updated: 1 };
}

export async function deleteChatSession(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM chatSessions WHERE id = ?`, [Number(id)]);
  return { deleted: 1 };
}
