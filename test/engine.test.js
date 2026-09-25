import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, resolvePaths } from '../engine/config.js';
import { createEvidence } from '../engine/evidence.js';
import { createEngine } from '../engine/engine.js';
import { loadSchemas } from '../engine/schemas.js';
import { runStep } from '../engine/steps.js';
import { selftestAnswer, stubAnswers, stubEnv, tempDir } from './helpers.js';

function engineFor(t, answers = { 'selftest-reader': selftestAnswer }, extraEnv = {}) {
  const dataRoot = tempDir(t);
  const engine = createEngine({ dataRoot, env: stubEnv(stubAnswers(t, answers), extraEnv) });
  t.after(() => engine.close());
  return engine;
}

const byId = (run) => Object.fromEntries(run.steps.map((s) => [s.step_id, s]));

test('self-test runs to the gate, then completes on approval with sealed evidence', async (t) => {
  const engine = engineFor(t);
  const paused = await engine.start('selftest');
  assert.equal(paused.status, 'paused');
  const steps = byId(paused);
  assert.equal(steps['list-schemas'].status, 'completed');
  assert.equal(steps.summarise.status, 'completed');
  assert.equal(steps.summarise.output.value.schema_count, 7);
  assert.equal(steps['qa-lead'].status, 'waiting');

  const done = await engine.approve(paused.id, { approver: 'lead@test', reason: 'matches' });
  assert.equal(done.status, 'completed');
  assert.equal(byId(done)['qa-lead'].output.value.approver, 'lead@test');
  assert.equal(engine.evidence.verify(paused.id).ok, true);

  const summary = JSON.parse(readFileSync(join(done.evidence, 'run-summary.json'), 'utf8'));
  assert.equal(summary.decisions[0].approver, 'lead@test');
  assert.equal(summary.cost_usd, 0.01);
});

test('agents are started contained: restricted mode, strict MCP, no shell, confined to evidence', async (t) => {
  const engine = engineFor(t);
  const run = await engine.start('selftest');
  const invocation = JSON.parse(readFileSync(join(run.evidence, 'steps', 'summarise', 'invocation.json'), 'utf8'));
  const { args } = invocation;
  for (const flag of ['--restricted', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(!args.join(' ').includes('Bash'));
  assert.equal(invocation.cwd, run.evidence);
  const prompt = args[args.indexOf('-p') + 1];
  assert.match(prompt, /<data source="steps\.list-schemas\.stdout_file">/);
  const mcp = JSON.parse(readFileSync(join(run.evidence, 'steps', 'summarise', 'mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers, {});
});

test('output that breaks its contract fails the run and nothing after it runs', async (t) => {
  const engine = engineFor(t, { 'selftest-reader': { output: { schema: 'qa.selftest.v1', summary: 'no count' } } });
  const run = await engine.start('selftest');
  assert.equal(run.status, 'failed');
  const steps = byId(run);
  assert.match(steps.summarise.error, /does not match qa\.selftest\.v1/);
  assert.equal(steps['qa-lead'].status, 'skipped');
  assert.equal(engine.evidence.verify(run.id).ok, true);
});

test('an agent that overspends its cap fails', async (t) => {
  const engine = engineFor(t, { 'selftest-reader': { ...selftestAnswer, cost_usd: 1 } });
  const run = await engine.start('selftest');
  assert.equal(run.status, 'failed');
  assert.match(byId(run).summarise.error, /exceeded the cap/);
});

test('rejection needs a reason and ends the run', async (t) => {
  const engine = engineFor(t);
  const run = await engine.start('selftest');
  await assert.rejects(engine.reject(run.id, { approver: 'lead@test' }), /reason is required/);
  const rejected = await engine.reject(run.id, { approver: 'lead@test', reason: 'count looks wrong' });
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.error, /count looks wrong/);
});

test('an agent can never approve a gate', async (t) => {
  const engine = engineFor(t, undefined, { QA_AGENT_ROLE: 'blind-reviewer' });
  const run = await engine.start('selftest');
  await assert.rejects(engine.approve(run.id, { approver: 'agent' }), /only be made by a person/);
});

test('the halt switch blocks new runs', async (t) => {
  const engine = engineFor(t);
  engine.halt();
  await assert.rejects(engine.start('selftest'), /halted/);
  engine.unhalt();
  assert.equal((await engine.start('selftest')).status, 'paused');
});

test('run IDs follow RUN-YYYY-MMDD-NNN and increment', async (t) => {
  const engine = engineFor(t);
  const first = await engine.start('selftest');
  const second = await engine.start('selftest');
  assert.match(first.id, /^RUN-\d{4}-\d{4}-001$/);
  assert.match(second.id, /^RUN-\d{4}-\d{4}-002$/);
});

test('runner steps refuse commands outside the allowlist', async (t) => {
  const paths = resolvePaths({ dataRoot: tempDir(t) });
  const evidence = createEvidence(paths.evidence);
  evidence.init('RUN-T');
  const args = { ctx: { params: {}, run: {}, steps: {} }, runId: 'RUN-T', config: loadConfig(), paths, evidence, schemas: loadSchemas(paths.schemas) };
  await assert.rejects(runStep({ ...args, step: { id: 'x', run: 'curl https://example.com' } }), /not on the runner allowlist/);
  await assert.rejects(runStep({ ...args, step: { id: 'y', run: 'node -e 1' } }), /not on the runner allowlist/);
});
