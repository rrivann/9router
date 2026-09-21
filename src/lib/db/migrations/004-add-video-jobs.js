// v4 — add videoJobs table (async CodeBuddy video generation tracking).
// Additive: syncSchemaFromTables also creates it via TABLES, kept here for
// explicit migration provenance.

export default {
  version: 4,
  name: "add-video-jobs",
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS videoJobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT NOT NULL,
        provider TEXT NOT NULL,
        connectionId TEXT,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        url TEXT,
        resolution TEXT,
        seconds INTEGER,
        credit REAL,
        outputTokens INTEGER,
        errorMessage TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_vj_created ON videoJobs(createdAt DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_vj_status ON videoJobs(status)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vj_taskId ON videoJobs(taskId)`);
  },
};
