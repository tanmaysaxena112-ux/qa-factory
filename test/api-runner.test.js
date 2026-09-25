import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, resolvePaths } from '../engine/config.js';
import { loadSchemas } from '../engine/schemas.js';
import { runApiTests } from '../runners/api.js';
import { calibrate } from '../runners/calibrate.js';
import { loadContract } from '../runners/contract.js';
import { loadProject } from '../runners/project.js';
import { tempDir } from './helpers.js';

const schemas = loadSchemas(resolvePaths().schemas);
const project = loadProject(REPO_ROOT, 'demo-shop');

function fileSink(t) {
  const base = tempDir(t);
  return {
    base,
    write(rel, content) {
      const file = join(base, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), { flag: 'wx' });
      return file;
    },
  };
}

const add = (product, quantity, status, json = []) => ({
  name: `add ${quantity} of ${product}`,
  request: { method: 'POST', path: '/cart/items', body: { product_id: product, quantity } },
  expect: { status, json },
});
const cart = (json) => ({ name: 'read cart', request: { method: 'GET', path: '/cart' }, expect: { status: 200, json } });

// A suite written to catch each seeded fault, used to prove calibration works.
const strongSuite = [
  { test_id: 'API-CART-01', oracle: 'AC-001.1', title: 'add returns 201 and exact line total', steps: [add('P-1', 3, 201, [{ path: '$.line_total', equals: 14.97 }]), cart([{ path: '$.total', equals: 14.97 }, { path: '$.items[0].line_total', equals: 14.97 }])] },
  { test_id: 'API-CART-02', oracle: 'AC-001.2', title: 'quantity 11 rejected', steps: [add('P-2', 11, 400)] },
  { test_id: 'API-CART-03', oracle: 'AC-001.3', title: 'unknown product', steps: [add('P-404', 1, 404)] },
  { test_id: 'API-CART-04', oracle: 'AC-001.4', title: 'stock limit', steps: [add('P-3', 4, 409)] },
  { test_id: 'API-CART-05', oracle: 'AC-002.1', title: 'remove line', steps: [add('P-1', 1, 201), { name: 'remove', request: { method: 'DELETE', path: '/cart/items/P-1' }, expect: { status: 204 } }, cart([{ path: '$.items', length: 0 }])] },
];

test('the contract checker catches undocumented statuses and body mismatches', () => {
  const contract = loadContract(join(project.dir, project.api.openapi));
  assert.equal(contract.check('GET', '/cart', 200, 'application/json', { items: [], currency: 'USD', total: 0 }).ok, true);
  assert.match(contract.check('GET', '/cart', 200, 'application/json', { items: [], currency: 'USD' }).errors.join(), /total/);
  assert.match(contract.check('POST', '/cart/items', 200, 'application/json', {}).errors.join(), /status 200 is not documented/);
  assert.equal(contract.check('DELETE', '/cart/items/P-1', 204, '', undefined).ok, true);
});

test('tests pass against a healthy build and write one result per test with a hashed artefact', async (t) => {
  const sink = fileSink(t);
  const run = await runApiTests({ repoRoot: REPO_ROOT, project, envName: 'dev', tests: strongSuite, schemas, sink, runId: 'RUN-2026-0925-001', label: 'main' });
  assert.equal(run.pass, strongSuite.length, JSON.stringify(run.results.filter((r) => r.status !== 'PASS')));
  const result = run.results[0];
  assert.equal(result.artefacts.length, 1);
  assert.ok(readFileSync(join(sink.base, result.artefacts[0].path), 'utf8').includes('"line_total": 14.97'));
  assert.equal(result.dependencies.start[0].status, 'up');
});

test('a wrong build identity blocks every test instead of producing results', async (t) => {
  const run = await runApiTests({ repoRoot: REPO_ROOT, project, envName: 'dev', tests: strongSuite, schemas, sink: fileSink(t), runId: 'RUN-2026-0925-001', label: 'main', expectedBuild: 'someone-elses-build' });
  assert.equal(run.blocked, strongSuite.length);
  assert.match(run.results[0].blocked_reason, /build identity/);
});

test('a contract break fails a test even when no assertion names the field', async (t) => {
  const tests = [{ test_id: 'API-CART-06', oracle: 'AC-002.1', title: 'view cart', steps: [cart([])] }];
  const run = await runApiTests({ repoRoot: REPO_ROOT, project, envName: 'dev', tests, schemas, sink: fileSink(t), runId: 'RUN-2026-0925-001', label: 'x', appEnv: { DEMO_FAULT: 'missing-total' } });
  assert.equal(run.fail, 1);
});

test('calibration passes a strong suite and fails a weak one', async (t) => {
  const strong = await calibrate({ repoRoot: REPO_ROOT, project, envName: 'dev', tests: strongSuite, schemas, sink: fileSink(t), runId: 'RUN-2026-0925-001' });
  assert.equal(strong.baseline.ok, true);
  assert.deepEqual(strong.faults.filter((f) => !f.detected).map((f) => f.id), []);
  assert.equal(strong.identity_check.ok, true);
  assert.equal(strong.ok, true);

  const weak = await calibrate({ repoRoot: REPO_ROOT, project, envName: 'dev', tests: strongSuite.slice(1, 2), schemas, sink: fileSink(t), runId: 'RUN-2026-0925-001' });
  assert.equal(weak.ok, false);
  assert.ok(weak.fault_detection_rate < 0.5);
});
