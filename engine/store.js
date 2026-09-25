import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  status TEXT NOT NULL,
  params TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS decisions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  approver TEXT NOT NULL,
  reason TEXT,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS controls (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

const parseStep = (row) => (row ? { ...row, output: row.output ? JSON.parse(row.output) : null } : null);
const parseRun = (row) => (row ? { ...row, params: JSON.parse(row.params) } : null);

export function openStore(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  return {
    close: () => db.close(),

    nextRunId(date = new Date()) {
      const pad = (n) => String(n).padStart(2, '0');
      const prefix = `RUN-${date.getFullYear()}-${pad(date.getMonth() + 1)}${pad(date.getDate())}-`;
      const last = db.prepare('SELECT id FROM runs WHERE id LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`);
      const n = last ? Number(last.id.slice(prefix.length)) + 1 : 1;
      if (n > 999) throw new Error(`Run limit for ${prefix.slice(0, -1)} reached`);
      return `${prefix}${String(n).padStart(3, '0')}`;
    },

    createRun({ id, workflow, params, steps }) {
      const ts = now();
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO runs (id, workflow, status, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          id, workflow, 'pending', JSON.stringify(params), ts, ts,
        );
        const insert = db.prepare('INSERT INTO steps (run_id, step_id, kind, status) VALUES (?, ?, ?, ?)');
        for (const step of steps) insert.run(id, step.id, step.kind, 'pending');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    getRun: (id) => parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id)),

    listRuns: (limit = 20) => db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit).map(parseRun),

    setRunStatus(id, status, error = null) {
      db.prepare('UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, now(), id);
    },

    addRunCost(id, cost) {
      db.prepare('UPDATE runs SET cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?').run(cost, now(), id);
    },

    getSteps: (runId) => db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY rowid').all(runId).map(parseStep),

    getStep: (runId, stepId) => parseStep(db.prepare('SELECT * FROM steps WHERE run_id = ? AND step_id = ?').get(runId, stepId)),

    startStep(runId, stepId) {
      db.prepare("UPDATE steps SET status = 'running', started_at = ?, error = NULL WHERE run_id = ? AND step_id = ?").run(now(), runId, stepId);
    },

    finishStep(runId, stepId, { status, output = null, error = null, costUsd = 0 }) {
      db.prepare('UPDATE steps SET status = ?, output = ?, error = ?, cost_usd = ?, ended_at = ? WHERE run_id = ? AND step_id = ?').run(
        status, output === null ? null : JSON.stringify(output), error, costUsd, now(), runId, stepId,
      );
    },

    setStepStatus(runId, stepId, status) {
      db.prepare('UPDATE steps SET status = ? WHERE run_id = ? AND step_id = ?').run(status, runId, stepId);
    },

    recordDecision({ runId, stepId, decision, approver, reason }) {
      db.prepare('INSERT INTO decisions (run_id, step_id, decision, approver, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        runId, stepId, decision, approver, reason ?? null, now(),
      );
    },

    getDecision: (runId, stepId) => db.prepare('SELECT * FROM decisions WHERE run_id = ? AND step_id = ?').get(runId, stepId) ?? null,

    getControl: (key) => db.prepare('SELECT value FROM controls WHERE key = ?').get(key)?.value ?? null,

    setControl(key, value) {
      db.prepare('INSERT INTO controls (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(
        key, value, now(),
      );
    },
  };
}
