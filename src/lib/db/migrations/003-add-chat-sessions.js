// v3 — add chatSessions table (dashboard AI chat history). Additive migration:
// syncSchemaFromTables in migrate.js also creates the table via TABLES declaration,
// but keeping the explicit CREATE + index makes the intent visible in git history.

export default {
  version: 3,
  name: "add-chat-sessions",
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS chatSessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        model TEXT,
        messages TEXT NOT NULL DEFAULT '[]',
        messageCount INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_cs_updated ON chatSessions(updatedAt DESC)`);
  },
};
