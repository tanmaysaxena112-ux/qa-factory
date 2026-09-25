import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli, selftestAnswer, stubAnswers, stubEnv, tempDir } from './helpers.js';

test('exit codes tell CI whether a run waits, completes or fails', (t) => {
  const env = stubEnv(stubAnswers(t, { 'selftest-reader': selftestAnswer }), { QA_DATA_ROOT: tempDir(t), QA_APPROVER: 'lead@test' });

  const started = runCli(['run', 'selftest', '--json'], env);
  assert.equal(started.code, 10, started.stderr);
  const run = JSON.parse(started.stdout);
  assert.equal(run.status, 'paused');

  const approved = runCli(['approve', run.id, '--reason', 'looks right'], env);
  assert.equal(approved.code, 0, approved.stderr);
  assert.match(approved.stdout, /COMPLETED/);

  assert.equal(runCli(['evidence', 'verify', run.id], env).code, 0);
  assert.equal(runCli(['run', 'no-such-workflow'], env).code, 2);
  assert.equal(runCli(['approve', run.id], env).code, 2);
});

test('the gate refuses decisions from inside an agent', (t) => {
  const env = stubEnv(stubAnswers(t, { 'selftest-reader': selftestAnswer }), { QA_DATA_ROOT: tempDir(t) });
  const run = JSON.parse(runCli(['run', 'selftest', '--json'], env).stdout);
  const result = runCli(['approve', run.id], { ...env, QA_AGENT_ROLE: 'blind-reviewer' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /only be made by a person/);
});
