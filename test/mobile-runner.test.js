import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, resolvePaths } from '../engine/config.js';
import { loadSchemas } from '../engine/schemas.js';
import { mobileStepProblems, runMobileTests, targetXPath, xpathLiteral } from '../runners/mobile.js';
import { loadProject } from '../runners/project.js';
import { tempDir } from './helpers.js';

const schemas = loadSchemas(resolvePaths().schemas);
const project = loadProject(REPO_ROOT, 'demo-shop');

const adb = join(process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk'), 'platform-tools', 'adb');
const deviceOnline = spawnSync(adb, ['devices'], { encoding: 'utf8' }).stdout?.split('\n').some((l) => /\tdevice$/.test(l.trim()) || /\sdevice$/.test(l)) ?? false;
const noDevice = deviceOnline || process.env.QA_ANDROID_AVD ? false : 'no Android device attached and QA_ANDROID_AVD not set';

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

test('XPath literals survive quotes of both kinds', () => {
  assert.equal(xpathLiteral('plain'), "'plain'");
  assert.equal(xpathLiteral("it's"), `"it's"`);
  assert.equal(xpathLiteral(`a'b"c`), `concat('a', "'", 'b"c')`);
  assert.ok(targetXPath({ role: 'button', name: "O'Brien's" }).includes(`"O'Brien's"`));
});

test('mobile steps must carry what their action needs and load a page', () => {
  const problems = mobileStepProblems({ test_id: 'MOB-SHOP-01', steps: [{ action: 'tap' }] });
  assert.ok(problems.some((p) => p.includes('needs "target"')));
  assert.ok(problems.some((p) => p.includes('goto')));
});

test('real Android Chrome: pass on the healthy build, catch mobile faults', { skip: noDevice, timeout: 600000 }, async (t) => {
  const tests = [
    {
      test_id: 'MOB-SHOP-01', oracle: 'AC-001.1', title: 'tap to add three notebooks',
      steps: [
        { action: 'goto', path: '/' },
        { action: 'fill', target: { label: 'Quantity for Notebook' }, value: '3' },
        { action: 'tap', target: { role: 'button', name: 'Add Notebook to cart' } },
        { action: 'expect_text', target: { text: 'Total: $14.97' }, value: 'Total: $14.97' },
        { action: 'expect_attribute', target: { label: 'Quantity for Notebook' }, attribute: 'inputmode', value: 'numeric' },
        { action: 'expect_min_size', target: { role: 'button', name: 'Add Notebook to cart' }, width: 44, height: 24 },
        { action: 'expect_stacked', target: { role: 'heading', name: 'Products' }, second: { role: 'heading', name: 'Cart' } },
      ],
    },
  ];
  const common = { repoRoot: REPO_ROOT, project, envName: 'dev', tests, schemas, runId: 'RUN-2026-0925-001' };
  const healthy = await runMobileTests({ ...common, sink: fileSink(t), label: 'main' });
  assert.equal(healthy.pass, 1, JSON.stringify(healthy.results));
  assert.equal(healthy.results[0].artefacts.length, 2, 'detail file and screenshot');

  for (const fault of ['ui-text-keypad', 'ui-tiny-targets']) {
    const run = await runMobileTests({ ...common, sink: fileSink(t), label: fault, appEnv: { DEMO_FAULT: fault } });
    assert.equal(run.fail, 1, `${fault} should be caught`);
  }
});
