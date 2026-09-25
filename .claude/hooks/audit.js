#!/usr/bin/env node
// PostToolUse hook. Appends one line per tool call to logs/agent-calls.jsonl.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAudit } from '../../engine/audit.js';
import { REPO_ROOT } from '../../engine/config.js';

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const dataRoot = process.env.QA_DATA_ROOT || REPO_ROOT;
  appendAudit(join(dataRoot, 'logs'), {
    source: 'hook',
    phase: 'post',
    role: process.env.QA_AGENT_ROLE ?? 'interactive',
    run: process.env.QA_RUN_ID,
    step: process.env.QA_STEP_ID,
    session: input.session_id,
    tool: input.tool_name,
    input: JSON.stringify(input.tool_input ?? {}).slice(0, 2000),
    result_sha256: createHash('sha256').update(JSON.stringify(input.tool_response ?? null)).digest('hex'),
  });
} catch (e) {
  process.stderr.write(`QA Factory audit hook failed: ${e.message}\n`);
  process.exit(1);
}
