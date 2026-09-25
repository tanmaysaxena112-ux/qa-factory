import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgent } from '../engine/agents.js';
import { resolvePaths } from '../engine/config.js';
import { loadSchemas } from '../engine/schemas.js';
import { loadWorkflow, parseWorkflow } from '../engine/workflow.js';

const paths = resolvePaths();
const schemas = loadSchemas(paths.schemas);
const parse = (yaml) => parseWorkflow(yaml, { schemas, agentsDir: paths.agents, source: 'test' });

test('the self-test workflow loads with three sequential layers', () => {
  const wf = loadWorkflow('selftest', { workflowsDir: paths.workflows, schemas, agentsDir: paths.agents });
  assert.deepEqual(wf.layers, [['list-schemas'], ['summarise'], ['qa-lead']]);
});

test('independent steps share a layer so they run in parallel', () => {
  const wf = parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, run: qa schemas }
  - { id: b, run: qa schemas }
  - { id: c, needs: [a, b], gate: qa-lead }
`);
  assert.deepEqual(wf.layers, [['a', 'b'], ['c']]);
});

test('unknown keys fail loudly instead of being ignored', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, run: qa schemas, retires: 3 }
`), /additional properties/);
});

test('a step must be exactly one kind', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, run: qa schemas, gate: qa-lead }
`), /oneOf/);
});

test('dependency cycles are rejected', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, needs: [b], run: qa schemas }
  - { id: b, needs: [a], run: qa schemas }
`), /cycle/);
});

test('a step may only read outputs of its own dependencies', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, run: qa schemas }
  - { id: b, run: "qa status \${steps.a.stdout_file}" }
`), /not one of its dependencies/);
});

test('params must be declared before use', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, run: "qa run \${params.env}" }
`), /undeclared param/);
});

test('agent steps need a known agent and a declared output contract', () => {
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, agent: nobody, prompt: hi, output: qa.selftest.v1 }
`), /Unknown agent/);
  assert.throws(() => parse(`schema: qa.workflow.v1
name: t
steps:
  - { id: a, agent: selftest-reader, prompt: hi }
`), /oneOf/);
});

test('agents may never be granted a shell or web tools', () => {
  const agent = (tools) => `---
name: x
description: d
tools: ${JSON.stringify(tools)}
mcp: []
model: haiku
max_cost_usd: 0.1
---
Do the thing.`;
  assert.throws(() => parseAgent(agent(['Read', 'Bash']), 't'), /Bash/);
  assert.throws(() => parseAgent(agent(['WebFetch']), 't'), /WebFetch/);
  assert.equal(parseAgent(agent(['Read']), 't').name, 'x');
});
