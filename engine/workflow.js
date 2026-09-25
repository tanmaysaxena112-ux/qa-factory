import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { loadAgent } from './agents.js';
import { references } from './template.js';

export const stepKind = (step) => (step.run ? 'run' : step.agent ? 'agent' : 'gate');

function layers(steps, source) {
  const done = new Set();
  const result = [];
  let remaining = [...steps];
  while (remaining.length) {
    const ready = remaining.filter((s) => (s.needs ?? []).every((n) => done.has(n)));
    if (!ready.length) throw new Error(`${source}: dependency cycle among ${remaining.map((s) => s.id).join(', ')}`);
    result.push(ready.map((s) => s.id));
    for (const s of ready) done.add(s.id);
    remaining = remaining.filter((s) => !done.has(s.id));
  }
  return result;
}

function ancestors(stepId, byId, seen = new Set()) {
  for (const need of byId.get(stepId).needs ?? []) {
    if (!seen.has(need)) {
      seen.add(need);
      ancestors(need, byId, seen);
    }
  }
  return seen;
}

export function parseWorkflow(text, { schemas, agentsDir, source = 'workflow' }) {
  const doc = YAML.parse(text);
  const check = schemas.validate('qa.workflow.v1', doc);
  if (!check.ok) throw new Error(`${source}: ${check.errors.join('; ')}`);

  const byId = new Map();
  for (const step of doc.steps) {
    if (byId.has(step.id)) throw new Error(`${source}: duplicate step id "${step.id}"`);
    byId.set(step.id, step);
  }
  for (const step of doc.steps) {
    for (const need of step.needs ?? []) {
      if (!byId.has(need)) throw new Error(`${source}: step "${step.id}" needs unknown step "${need}"`);
    }
  }
  const order = layers(doc.steps, source);
  const params = doc.params ?? {};

  for (const step of doc.steps) {
    const kind = stepKind(step);
    if (step.output && !schemas.has(step.output)) throw new Error(`${source}: step "${step.id}" uses unknown schema "${step.output}"`);
    if (kind === 'agent') loadAgent(agentsDir, step.agent);
    if (kind !== 'run' && step.env) throw new Error(`${source}: step "${step.id}": only run steps may declare env`);
    if (kind !== 'agent' && step.cwd) throw new Error(`${source}: step "${step.id}": only agent steps may set cwd`);
    if (kind !== 'agent' && step.app) throw new Error(`${source}: step "${step.id}": only agent steps may run with an app`);
    const reachable = ancestors(step.id, byId);
    for (const text of [step.run, step.prompt, step.cwd, step.message, step.app?.project, step.app?.env].filter(Boolean)) {
      for (const ref of references(text)) {
        const [root, name] = ref.split('.');
        if (root === 'params' && !(name in params)) throw new Error(`${source}: step "${step.id}" uses undeclared param "${name}"`);
        if (root === 'steps' && !reachable.has(name)) {
          throw new Error(`${source}: step "${step.id}" reads step "${name}", which is not one of its dependencies`);
        }
        if (root === 'app' && !step.app) throw new Error(`${source}: step "${step.id}" uses \${app...} without an app`);
        if (!['params', 'steps', 'run', 'app'].includes(root)) throw new Error(`${source}: step "${step.id}" has unknown reference \${${ref}}`);
      }
    }
  }
  return { ...doc, params, layers: order };
}

export function loadWorkflow(name, { workflowsDir, schemas, agentsDir }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid workflow name "${name}"`);
  const file = join(workflowsDir, `${name}.yaml`);
  if (!existsSync(file)) throw new Error(`Unknown workflow "${name}"`);
  const workflow = parseWorkflow(readFileSync(file, 'utf8'), { schemas, agentsDir, source: `workflows/${name}.yaml` });
  if (workflow.name !== name) throw new Error(`workflows/${name}.yaml: name must be "${name}"`);
  return workflow;
}

export function listWorkflows(workflowsDir) {
  return readdirSync(workflowsDir).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();
}
