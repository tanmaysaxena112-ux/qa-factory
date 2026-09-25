import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.js';

export const AUDIT_FILE = 'agent-calls.jsonl';

// Synchronous and throwing on purpose: an action that cannot be audited must
// not proceed.
export function appendAudit(logsDir, entry) {
  mkdirSync(logsDir, { recursive: true });
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  appendFileSync(join(logsDir, AUDIT_FILE), `${line}\n`);
}
