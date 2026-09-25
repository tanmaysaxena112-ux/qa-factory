import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { minimalEnv, spawnCapture } from '../engine/exec.js';
import { startLocalApp } from './app.js';
import { loadSurfaceTests } from './api.js';
import { projectEnv } from './project.js';

export const BROWSERS = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
  mobile: 'Pixel 7',
};

export function loadWebTests(project, schemas) {
  return loadSurfaceTests(project, schemas, { surface: 'web', schemaId: 'qa.webtests.v1', dir: project.web?.tests ?? 'web/tests', extraProblems: webStepProblems });
}

const NEEDS = {
  goto: ['path'],
  click: ['target'],
  fill: ['target', 'value'],
  expect_text: ['target', 'value'],
  expect_contains: ['target', 'value'],
  expect_visible: ['target'],
  expect_hidden: ['target'],
  expect_enabled: ['target'],
  expect_disabled: ['target'],
  expect_count: ['target', 'count'],
  check_a11y: [],
  screenshot: ['name'],
  press: ['key'],
  expect_focused: ['target'],
  expect_value: ['target', 'value'],
  set_viewport: ['width', 'height'],
  expect_stacked: ['target', 'second'],
  expect_side_by_side: ['target', 'second'],
  request: ['method', 'path'],
};

export function webStepProblems(test) {
  const problems = [];
  test.steps.forEach((s, i) => {
    for (const field of NEEDS[s.action]) if (s[field] === undefined) problems.push(`${test.test_id} step ${i + 1} (${s.action}) needs "${field}"`);
  });
  if (!['goto', 'request', 'set_viewport'].includes(test.steps[0]?.action) || !test.steps.some((s) => s.action === 'goto')) {
    problems.push(`${test.test_id} must load the page with a goto step, after any setup requests or viewport change`);
  }
  return problems;
}

const J = JSON.stringify;

function locator(t) {
  if (t.role) return `page.getByRole(${J(t.role)}${t.name !== undefined ? `, { name: ${J(t.name)}, exact: true }` : ''})`;
  if (t.label) return `page.getByLabel(${J(t.label)}, { exact: true })`;
  if (t.testid) return `page.getByTestId(${J(t.testid)})`;
  return `page.getByText(${J(t.text)}, { exact: true })`;
}

function stepCode(s) {
  const loc = s.target ? locator(s.target) : '';
  switch (s.action) {
    case 'goto': return `await page.goto(${J(s.path)});`;
    case 'click': return `await ${loc}.click();`;
    case 'fill': return `await ${loc}.fill(${J(s.value)});`;
    case 'expect_text': return `await expect(${loc}).toHaveText(${J(s.value)});`;
    case 'expect_contains': return `await expect(${loc}).toContainText(${J(s.value)});`;
    case 'expect_visible': return `await expect(${loc}).toBeVisible();`;
    case 'expect_hidden': return `await expect(${loc}).toBeHidden();`;
    case 'expect_enabled': return `await expect(${loc}).toBeEnabled();`;
    case 'expect_disabled': return `await expect(${loc}).toBeDisabled();`;
    case 'expect_count': return `await expect(${loc}).toHaveCount(${J(s.count)});`;
    case 'check_a11y':
      return [
        "const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();",
        "await testInfo.attach('axe-violations', { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });",
        'expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);',
      ].join('\n      ');
    case 'screenshot': return `await expect(page).toHaveScreenshot(${J(`${s.name}.png`)}, { fullPage: true, animations: 'disabled' });`;
    case 'press': return `await page.keyboard.press(${J(s.key === 'Space' ? ' ' : s.key)});`;
    case 'expect_focused': return `await expect(${loc}).toBeFocused();`;
    case 'expect_value': return `await expect(${loc}).toHaveValue(${J(s.value)});`;
    case 'set_viewport': return `await page.setViewportSize({ width: ${J(s.width)}, height: ${J(s.height)} });`;
    case 'expect_stacked':
      // The second element sits below the first, not beside it.
      return `{ const a = await ${loc}.boundingBox(); const b = await ${locator(s.second)}.boundingBox(); expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1); }`;
    case 'expect_side_by_side':
      return `{ const a = await ${loc}.boundingBox(); const b = await ${locator(s.second)}.boundingBox(); expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1); expect(b.y).toBeLessThan(a.y + a.height); }`;
    case 'request':
      // Changes server state mid-test, as another tab or shopper would.
      return `{ const r = await page.request.fetch(${J(s.path)}, { method: ${J(s.method)}${s.body !== undefined ? `, data: ${J(s.body)}` : ''} }); expect(r.ok(), ${J(`${s.method} ${s.path}`)}).toBeTruthy(); }`;
    default: throw new Error(`Unknown action ${s.action}`);
  }
}

// Test data enters the generated code only through JSON.stringify, so a value
// can never become code.
export function compileSpec(tests, resetPath) {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "import AxeBuilder from '@axe-core/playwright';",
    '',
    `test.beforeEach(async ({ request }) => { await request.post(${J(resetPath)}); });`,
    '',
  ];
  for (const t of tests) {
    lines.push(`test(${J(`${t.test_id} ${t.title}`)}, async ({ page }, testInfo) => {`);
    for (const skip of t.skip_browsers ?? []) lines.push(`  test.skip(testInfo.project.name === ${J(skip.browser)}, ${J(skip.reason)});`);
    t.steps.forEach((s, i) => {
      lines.push(`  await test.step(${J(`${i + 1}. ${s.action}${s.target ? ` ${J(s.target)}` : ''}`)}, async () => {`);
      lines.push(`      ${stepCode(s)}`);
      lines.push('  });');
    });
    lines.push('});', '');
  }
  return lines.join('\n');
}

function compileConfig({ specDir, outputDir, reportFile, baselineDir, baseURL, browsers, maxFailures = 0 }) {
  return [
    "import { devices } from '@playwright/test';",
    'export default {',
    `  testDir: ${J(specDir)},`,
    `  outputDir: ${J(outputDir)},`,
    '  workers: 1,',
    '  fullyParallel: false,',
    '  retries: 0,',
    '  timeout: 20000,',
    `  maxFailures: ${J(maxFailures)},`,
    `  reporter: [['json', { outputFile: ${J(reportFile)} }]],`,
    `  snapshotPathTemplate: ${J(`${baselineDir}/{arg}-{projectName}-{platform}{ext}`)},`,
    '  expect: { timeout: 5000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },',
    `  use: { baseURL: ${J(baseURL)}, screenshot: 'on', trace: 'retain-on-failure', actionTimeout: 5000, navigationTimeout: 10000 },`,
    `  projects: [${browsers.map((b) => `{ name: ${J(b)}, use: { ...devices[${J(BROWSERS[b])}] } }`).join(', ')}],`,
    '};',
    '',
  ].join('\n');
}

const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

function collectSpecs(suite, out = []) {
  for (const spec of suite.specs ?? []) out.push(spec);
  for (const child of suite.suites ?? []) collectSpecs(child, out);
  return out;
}

const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// Combines one test's Playwright entries (one per project) into a status. A
// test passes only when every requested browser passed or was skipped by a
// declared exception.
export function aggregateBrowsers(perBrowser, browsers, declaredSkips = new Set()) {
  const noBaseline = perBrowser.some((b) => b.errors.some((e) => /snapshot doesn't exist/i.test(e)));
  const failed = perBrowser.some((b) => ['failed', 'timedOut', 'interrupted'].includes(b.status));
  const allPassed =
    perBrowser.length === browsers.length &&
    perBrowser.every((b) => b.status === 'passed' || (b.status === 'skipped' && declaredSkips.has(b.browser))) &&
    perBrowser.some((b) => b.status === 'passed');
  return noBaseline ? 'BLOCKED' : failed ? 'FAIL' : allPassed ? 'PASS' : 'NOT_RUN';
}

// Runs web tests against a freshly started app in every requested browser. A
// test passes only when it passes in all of them.
export async function runWebTests({ repoRoot, project, envName, tests, sink, runId, label, appEnv = {}, expectedBuild, browsers = Object.keys(BROWSERS), updateSnapshots = 'none', schemas, stopAfterFirstFailure = false }) {
  const env = projectEnv(project, envName);
  if (!env.local_app) throw new Error(`Environment ${envName} has no local_app`);
  const baselineDir = join(project.dir, 'web', 'baselines');
  const blockAll = (reason) =>
    tests.map((t) => ({ schema: 'qa.result.v1', run_id: runId, test_id: t.test_id, surface: 'web', status: 'BLOCKED', blocked_reason: reason, artefacts: [] }));

  const app = await startLocalApp(repoRoot, env.local_app, appEnv);
  if (!app.ok) return finish(blockAll(`app unavailable: ${app.detail}`));
  try {
    const want = expectedBuild ?? env.expected_build;
    if (want && app.build !== want) return finish(blockAll(`build identity is "${app.build}", expected "${want}"`));

    // Playwright resolves @playwright/test from the spec's location, so the
    // generated files live in an ignored folder inside the repository; copies
    // go into the evidence.
    const work = join(repoRoot, '.qa-cache', 'web', `${runId}-${label.replace(/[^a-z0-9-]/gi, '_')}-${Date.now()}`);
    const specDir = join(work, 'spec');
    mkdirSync(specDir, { recursive: true });
    const spec = compileSpec(tests, env.local_app.reset);
    const outputDir = sink.dir(`web/${label}/output`);
    const reportFile = join(sink.dir(`web/${label}`), 'report.json');
    const config = compileConfig({ specDir, outputDir, reportFile, baselineDir, baseURL: app.baseUrl, browsers, maxFailures: stopAfterFirstFailure ? 1 : 0 });
    writeFileSync(join(specDir, 'generated.spec.js'), spec);
    writeFileSync(join(work, 'playwright.config.js'), config);
    sink.write(`web/${label}/generated.spec.js`, spec);
    sink.write(`web/${label}/playwright.config.js`, config);

    const cli = join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
    const proc = await spawnCapture(process.execPath, [cli, 'test', '--config', join(work, 'playwright.config.js'), `--update-snapshots=${updateSnapshots}`], {
      cwd: repoRoot,
      env: minimalEnv({ CI: '1', PWTEST_SKIP_TEST_OUTPUT: '1' }),
      timeoutMs: 20 * 60 * 1000,
    });
    sink.write(`web/${label}/playwright-stdout.txt`, proc.stdout);
    sink.write(`web/${label}/playwright-stderr.txt`, proc.stderr);
    if (!existsSync(reportFile)) return finish(blockAll(`Playwright produced no report (exit ${proc.code}): ${stripAnsi(proc.stderr).slice(0, 300)}`));

    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    const specs = collectSpecs({ suites: report.suites });
    const evidenceBase = sink.dir('');
    const results = [];
    let unexpectedSeen = 0;
    for (const t of tests) {
      // Playwright reports one spec entry per project (engine or viewport), so a
      // test's result is spread over several entries; all of them count.
      const matched = specs.filter((s) => s.title.startsWith(`${t.test_id} `));
      if (!matched.length) {
        results.push({ schema: 'qa.result.v1', run_id: runId, test_id: t.test_id, surface: 'web', status: 'NOT_RUN', artefacts: [] });
        continue;
      }
      const perBrowser = matched.flatMap((s) => s.tests).map((run) => {
        const r = run.results.at(-1) ?? {};
        return {
          browser: run.projectName,
          status: r.status ?? 'skipped',
          errors: (r.errors ?? []).map((e) => stripAnsi(e.message).split('\n').slice(0, 12).join('\n')),
          attachments: (r.attachments ?? []).filter((a) => a.path && existsSync(a.path)).map((a) => ({ name: a.name, path: a.path })),
          duration_ms: r.duration ?? 0,
        };
      });
      unexpectedSeen += perBrowser.filter((b) => ['failed', 'timedOut', 'interrupted'].includes(b.status)).length;
      // A browser may be skipped only where the test declares it, with a reason.
      const declaredSkips = new Set((t.skip_browsers ?? []).map((s) => s.browser));
      const status = aggregateBrowsers(perBrowser, browsers, declaredSkips);
      const detailFile = sink.write(`web/${label}/${t.test_id}.json`, { test_id: t.test_id, oracle: t.oracle, title: t.title, build: app.build, skip_browsers: t.skip_browsers ?? [], browsers: perBrowser.map(({ attachments, ...rest }) => ({ ...rest, attachments: attachments.map((a) => ({ name: a.name, path: relative(evidenceBase, a.path).split(sep).join('/') })) })) });
      const artefacts = [detailFile, ...perBrowser.flatMap((b) => b.attachments.map((a) => a.path))].map((file) => ({
        path: relative(evidenceBase, file).split(sep).join('/'),
        sha256: sha256File(file),
      }));
      results.push({
        schema: 'qa.result.v1',
        run_id: runId,
        test_id: t.test_id,
        surface: 'web',
        status,
        ...(status === 'BLOCKED' ? { blocked_reason: 'no approved visual baseline; run qa web baseline and have the QA Lead approve it' } : {}),
        duration_ms: perBrowser.reduce((sum, b) => sum + b.duration_ms, 0),
        artefacts: status === 'BLOCKED' || status === 'NOT_RUN' ? [] : artefacts,
      });
    }
    // Integrity check: every run Playwright counted as unexpected must show up
    // as a failed test here. A mismatch means the results cannot be trusted.
    if ((report.stats?.unexpected ?? 0) !== unexpectedSeen) {
      throw new Error(`Result aggregation mismatch: Playwright reports ${report.stats?.unexpected} failed runs, the results account for ${unexpectedSeen}`);
    }
    return finish(results);
  } finally {
    await app.stop();
  }

  function finish(list) {
    for (const r of list) {
      const check = schemas.validate('qa.result.v1', r);
      if (!check.ok) throw new Error(`Result for ${r.test_id} breaks qa.result.v1: ${check.errors.join('; ')}`);
    }
    sink.write(`web/${label}/results.json`, list);
    const count = (s) => list.filter((r) => r.status === s).length;
    return { label, total: list.length, pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED'), results: list };
  }
}
