import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, resolvePaths } from '../engine/config.js';
import { loadSchemas } from '../engine/schemas.js';
import { loadProject } from '../runners/project.js';
import { compileSpec, runWebTests, webStepProblems } from '../runners/web.js';
import { tempDir } from './helpers.js';

const schemas = loadSchemas(resolvePaths().schemas);
const project = loadProject(REPO_ROOT, 'demo-shop');

function fileSink(t) {
  const base = tempDir(t);
  return {
    base,
    dir(rel) {
      const d = join(base, rel);
      mkdirSync(d, { recursive: true });
      return d;
    },
    write(rel, content) {
      const file = join(base, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), { flag: 'wx' });
      return file;
    },
  };
}

const addNotebooks = {
  test_id: 'WEB-SHOP-01',
  oracle: 'AC-001.1',
  title: 'adding three notebooks shows an exact dollar total',
  steps: [
    { action: 'goto', path: '/' },
    { action: 'fill', target: { label: 'Quantity for Notebook' }, value: '3' },
    { action: 'click', target: { role: 'button', name: 'Add Notebook to cart' } },
    { action: 'expect_text', target: { testid: 'cart-total' }, value: 'Total: $14.97' },
    { action: 'check_a11y' },
  ],
};

test('test data reaches the generated spec only as JSON literals', () => {
  const spec = compileSpec([{ ...addNotebooks, title: "evil'); process.exit(1); ('" }], '/__reset');
  assert.ok(spec.includes(JSON.stringify(`WEB-SHOP-01 evil'); process.exit(1); ('`)));
  assert.ok(!spec.includes("('evil')"));
});

test('web steps must carry what their action needs and start with a page load', () => {
  const problems = webStepProblems({ test_id: 'WEB-SHOP-02', steps: [{ action: 'click' }] });
  assert.ok(problems.some((p) => p.includes('needs "target"')));
  assert.ok(problems.some((p) => p.includes('must load the page with a goto step')));
});

test('a real browser run passes on the healthy build and fails on a UI fault', { timeout: 120000 }, async (t) => {
  const common = { repoRoot: REPO_ROOT, project, envName: 'dev', tests: [addNotebooks], schemas, runId: 'RUN-2026-0925-001', browsers: ['chromium'] };
  const healthy = await runWebTests({ ...common, sink: fileSink(t), label: 'main' });
  assert.equal(healthy.pass, 1, JSON.stringify(healthy.results));
  assert.ok(healthy.results[0].artefacts.length >= 2, 'detail file and screenshot are cited');

  const wrongCurrency = await runWebTests({ ...common, sink: fileSink(t), label: 'fault', appEnv: { DEMO_FAULT: 'ui-currency' } });
  assert.equal(wrongCurrency.fail, 1);

  const unlabeled = await runWebTests({ ...common, sink: fileSink(t), label: 'a11y', appEnv: { DEMO_FAULT: 'ui-no-label' } });
  assert.equal(unlabeled.fail, 1);
});

test('a visual check without an approved baseline is BLOCKED, never passed', { timeout: 120000 }, async (t) => {
  const visual = { test_id: 'WEB-SHOP-09', oracle: 'AC-001.1', title: 'layout', steps: [{ action: 'goto', path: '/' }, { action: 'screenshot', name: 'zz-unapproved-baseline' }] };
  const sink = fileSink(t);
  const run = await runWebTests({ repoRoot: REPO_ROOT, project, envName: 'dev', tests: [visual], schemas, sink, runId: 'RUN-2026-0925-001', label: 'main', browsers: ['chromium'] });
  assert.equal(run.blocked, 1, readFileSync(join(sink.base, 'web/main/playwright-stdout.txt'), 'utf8').slice(0, 500));
});

test('keyboard, viewport, layout and mid-test requests work in a real browser', { timeout: 120000 }, async (t) => {
  const tests = [
    {
      test_id: 'WEB-SHOP-03', oracle: 'AC-001.1', title: 'phone width stacks the sections',
      steps: [
        { action: 'set_viewport', width: 600, height: 900 },
        { action: 'goto', path: '/' },
        { action: 'expect_stacked', target: { role: 'heading', name: 'Products' }, second: { role: 'heading', name: 'Cart' } },
      ],
    },
    {
      test_id: 'WEB-SHOP-04', oracle: 'AC-001.1', title: 'desktop width places them side by side',
      steps: [
        { action: 'set_viewport', width: 1200, height: 900 },
        { action: 'goto', path: '/' },
        { action: 'expect_side_by_side', target: { role: 'heading', name: 'Products' }, second: { role: 'heading', name: 'Cart' } },
      ],
    },
    {
      test_id: 'WEB-SHOP-05', oracle: 'AC-001.1', title: 'keyboard reaches the first quantity field and a line removed elsewhere shows a message',
      steps: [
        { action: 'goto', path: '/' },
        { action: 'press', key: 'Tab' },
        { action: 'expect_focused', target: { label: 'Quantity for Notebook' } },
        { action: 'click', target: { role: 'button', name: 'Add Notebook to cart' } },
        { action: 'expect_visible', target: { role: 'button', name: 'Remove Notebook' } },
        { action: 'request', method: 'DELETE', path: '/cart/items/P-1' },
        { action: 'click', target: { role: 'button', name: 'Remove Notebook' } },
        { action: 'expect_text', target: { role: 'alert' }, value: 'That item is not in your cart.' },
      ],
    },
  ];
  const run = await runWebTests({ repoRoot: REPO_ROOT, project, envName: 'dev', tests, schemas, sink: fileSink(t), runId: 'RUN-2026-0925-001', label: 'main', browsers: ['chromium'] });
  assert.equal(run.pass, 3, JSON.stringify(run.results.map((r) => [r.test_id, r.status])));
});

test('field values are checked with toHaveValue, never text', () => {
  const spec = compileSpec([{ test_id: 'WEB-SHOP-06', oracle: 'AC-001.1', title: 'value', steps: [{ action: 'goto', path: '/' }, { action: 'expect_value', target: { label: 'Quantity for Notebook' }, value: '1' }] }], '/__reset');
  assert.ok(spec.includes('toHaveValue("1")'));
});

test('a test failing in one browser is FAIL even when it passes in the first', { timeout: 180000 }, async (t) => {
  // WebKit on macOS skips buttons on Tab; Chromium reaches them. Without a
  // declared skip, the WebKit failure must fail the whole test.
  const keyboard = {
    test_id: 'WEB-SHOP-07', oracle: 'AC-001.1', title: 'Tab reaches the add button',
    steps: [
      { action: 'goto', path: '/' },
      { action: 'click', target: { label: 'Quantity for Notebook' } },
      { action: 'press', key: 'Tab' },
      { action: 'expect_focused', target: { role: 'button', name: 'Add Notebook to cart' } },
    ],
  };
  const common = { repoRoot: REPO_ROOT, project, envName: 'dev', schemas, runId: 'RUN-2026-0925-001', label: 'main', browsers: ['chromium', 'webkit'] };
  const strict = await runWebTests({ ...common, tests: [keyboard], sink: fileSink(t) });
  assert.equal(strict.fail, 1);
  const declared = await runWebTests({ ...common, tests: [{ ...keyboard, skip_browsers: [{ browser: 'webkit', reason: 'macOS default: Tab skips buttons in WebKit' }] }], sink: fileSink(t) });
  assert.equal(declared.pass, 1);
});
