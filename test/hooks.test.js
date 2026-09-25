import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runHook, tempDir } from './helpers.js';

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('secret files are blocked for everyone', () => {
  assert.equal(runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/x/.env' } }).code, 2);
  assert.equal(runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/x/.env.uat' } }).code, 2);
  assert.equal(runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/home/me/.ssh/id_ed25519' } }).code, 2);
  assert.equal(runHook('guard.js', bash('cat .env')).code, 2);
  assert.equal(runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/x/.env.example' } }).code, 0);
  assert.equal(runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/x/README.md' } }).code, 0);
});

test('destructive commands are blocked for everyone', () => {
  for (const command of ['rm -rf evidence', 'git push --force', 'git push origin --delete x', 'git reset --hard', 'git clean -fd', 'gh pr merge 3', 'sudo ls']) {
    const result = runHook('guard.js', bash(command));
    assert.equal(result.code, 2, command);
    assert.match(result.stderr, /Blocked by QA Factory guard/);
  }
  assert.equal(runHook('guard.js', bash('npm test')).code, 0);
  assert.equal(runHook('guard.js', bash('git status')).code, 0);
});

test('agents are held to the command allowlist and cannot decide gates', (t) => {
  const env = { QA_AGENT_ROLE: 'tester', QA_DATA_ROOT: tempDir(t), QA_RUN_ID: 'RUN-X', QA_STEP_ID: 's' };
  assert.equal(runHook('guard.js', bash('curl https://example.com'), env).code, 2);
  assert.equal(runHook('guard.js', bash('qa run selftest; ls'), env).code, 2);
  assert.equal(runHook('guard.js', bash('qa approve RUN-X'), env).code, 2);
  assert.equal(runHook('guard.js', bash('qa run selftest'), env).code, 0);
  assert.equal(runHook('guard.js', bash('npx playwright test'), env).code, 0);
  assert.equal(runHook('guard.js', bash('npx cowsay hi'), env).code, 2);
});

test('agents cannot edit the rules they are judged by', (t) => {
  const env = { QA_AGENT_ROLE: 'tester', QA_DATA_ROOT: tempDir(t) };
  for (const file of ['/repo/CLAUDE.md', '/repo/schemas/qa.review.v1.json', '/repo/.claude/settings.json', '/repo/workflows/x.yaml']) {
    assert.equal(runHook('guard.js', { tool_name: 'Edit', tool_input: { file_path: file } }, env).code, 2, file);
  }
  assert.equal(runHook('guard.js', { tool_name: 'Write', tool_input: { file_path: '/repo/evidence/RUN-X/notes.md' } }, env).code, 0);
});

test('agent tool calls are audited before and after they run', (t) => {
  const dataRoot = tempDir(t);
  const env = { QA_AGENT_ROLE: 'tester', QA_DATA_ROOT: dataRoot, QA_RUN_ID: 'RUN-X', QA_STEP_ID: 's' };
  runHook('guard.js', { tool_name: 'Read', tool_input: { file_path: '/repo/a.txt' } }, env);
  runHook('audit.js', { tool_name: 'Read', tool_input: { file_path: '/repo/a.txt' }, tool_response: 'contents' }, env);
  const lines = readFileSync(join(dataRoot, 'logs', 'agent-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.phase), ['pre', 'post']);
  assert.equal(lines[1].role, 'tester');
  assert.equal(lines[1].run, 'RUN-X');
  assert.match(lines[1].result_sha256, /^[a-f0-9]{64}$/);
});
