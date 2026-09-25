import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { minimalEnv, spawnCapture } from '../engine/exec.js';
import { loadSurfaceTests } from './api.js';
import { probeHealth, startLocalApp } from './app.js';
import { projectEnv } from './project.js';

const NEEDS = {
  goto: ['path'],
  tap: ['target'],
  fill: ['target', 'value'],
  rotate: ['orientation'],
  request: ['method', 'path'],
  expect_text: ['target', 'value'],
  expect_contains: ['target', 'value'],
  expect_visible: ['target'],
  expect_hidden: ['target'],
  expect_value: ['target', 'value'],
  expect_enabled: ['target'],
  expect_disabled: ['target'],
  expect_attribute: ['target', 'attribute', 'value'],
  expect_min_size: ['target', 'width', 'height'],
  expect_stacked: ['target', 'second'],
  expect_side_by_side: ['target', 'second'],
  expect_no_horizontal_scroll: [],
};

export function mobileStepProblems(test) {
  const problems = [];
  test.steps.forEach((s, i) => {
    for (const field of NEEDS[s.action]) if (s[field] === undefined) problems.push(`${test.test_id} step ${i + 1} (${s.action}) needs "${field}"`);
  });
  if (!test.steps.some((s) => s.action === 'goto')) problems.push(`${test.test_id} must load the page with a goto step`);
  return problems;
}

export function loadMobileTests(project, schemas) {
  const resetPaths = new Set(Object.values(project.envs ?? {}).map((e) => e.local_app?.reset).filter(Boolean));
  // The runner resets state before every test; a test that calls the reset
  // endpoint itself is exercising test infrastructure, not the product.
  const extraProblems = (t) => [
    ...mobileStepProblems(t),
    ...t.steps.filter((s) => s.action === 'request' && resetPaths.has(s.path)).map(() => `${t.test_id} calls the runner's reset endpoint; the runner already resets before every test`),
  ];
  return loadSurfaceTests(project, schemas, { surface: 'mobile', schemaId: 'qa.mobiletests.v1', dir: project.mobile?.tests ?? 'mobile/tests', extraProblems });
}

// XPath string literal that is safe for any value, including quotes.
export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "'", `)})`;
}

// Targets name what a shopper perceives; the runner turns them into XPath
// over the page, so tests never depend on classes or IDs.
export function targetXPath(t) {
  if (t.label) {
    const v = xpathLiteral(t.label);
    return `//input[@id=//label[normalize-space(.)=${v}]/@for or @aria-label=${v}]`;
  }
  if (t.role === 'button') return `//*[(self::button or @role='button') and normalize-space(.)=${xpathLiteral(t.name)}]`;
  if (t.role === 'heading') return `//*[(self::h1 or self::h2 or self::h3 or @role='heading') and normalize-space(.)=${xpathLiteral(t.name)}]`;
  if (t.role === 'alert') return "//*[@role='alert']";
  if (t.role === 'region') return `//section[@aria-labelledby=//*[normalize-space(.)=${xpathLiteral(t.name)}]/@id]`;
  return `//*[normalize-space(text())=${xpathLiteral(t.text)}]`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const ANDROID_SDK = process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk');
const adb = (args, timeoutMs = 20000) => spawnCapture(join(ANDROID_SDK, 'platform-tools', 'adb'), args, { env: minimalEnv(), timeoutMs });

async function onlineDevice() {
  const out = await adb(['devices']);
  return out.stdout.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p.length === 2 && p[1] === 'device')?.[0] ?? null;
}

// Uses an attached device or running emulator; otherwise boots the configured
// emulator read-only, so the virtual device itself is never modified.
async function ensureDevice(android) {
  const existing = await onlineDevice();
  if (existing) return { ok: true, serial: existing, started: false };
  const avd = process.env[android.avd_env ?? 'QA_ANDROID_AVD'];
  if (!avd) return { ok: false, detail: `no Android device is attached and ${android.avd_env ?? 'QA_ANDROID_AVD'} names no emulator to boot` };
  const child = spawn(join(ANDROID_SDK, 'emulator', 'emulator'), ['-avd', avd, '-read-only', '-no-snapshot-save', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect'], {
    env: minimalEnv({ ANDROID_HOME: ANDROID_SDK }),
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const serial = await onlineDevice();
    if (serial && (await adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])).stdout.trim() === '1') return { ok: true, serial, started: true };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, detail: `emulator ${avd} did not finish booting within 4 minutes` };
}

function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const out = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : undefined;
}

async function startAppium(repoRoot) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules', 'appium', 'index.js'), 'server', '--address', '127.0.0.1', '--port', String(port), '--allow-insecure', 'uiautomator2:chromedriver_autodownload', '--log-level', 'error'], {
    env: minimalEnv({ APPIUM_HOME: join(repoRoot, '.qa-cache', 'appium'), ANDROID_HOME: ANDROID_SDK, ...(javaHome() ? { JAVA_HOME: javaHome() } : {}) }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok && (await res.json()).value?.ready) return { ok: true, url, stop };
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  return { ok: false, detail: `Appium did not start: ${stderr.slice(0, 300)}`, stop };
}

// A minimal W3C WebDriver client: the handful of commands the mobile format
// needs, over fetch, with no extra dependencies.
function webdriver(base) {
  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.value?.message?.split('\n')[0] ?? `WebDriver ${method} ${path} failed with ${res.status}`);
    return json.value;
  }
  return {
    async newSession(capabilities) {
      const value = await call('POST', '/session', { capabilities: { alwaysMatch: capabilities } });
      const id = value.sessionId;
      const s = (m, p, b) => call(m, `/session/${id}${p}`, b);
      const elementId = (v) => Object.values(v)[0];
      return {
        id,
        navigate: (url) => s('POST', '/url', { url }),
        findAll: async (xpath) => (await s('POST', '/elements', { using: 'xpath', value: xpath })).map(elementId),
        click: (el) => s('POST', `/element/${el}/click`, {}),
        clear: (el) => s('POST', `/element/${el}/clear`, {}),
        type: (el, text) => s('POST', `/element/${el}/value`, { text }),
        text: (el) => s('GET', `/element/${el}/text`),
        property: (el, name) => s('GET', `/element/${el}/property/${name}`),
        attribute: (el, name) => s('GET', `/element/${el}/attribute/${name}`),
        displayed: (el) => s('GET', `/element/${el}/displayed`),
        enabled: (el) => s('GET', `/element/${el}/enabled`),
        rect: (el) => s('GET', `/element/${el}/rect`),
        rotate: (orientation) => s('POST', '/orientation', { orientation: orientation.toUpperCase() }),
        hideKeyboard: () => s('POST', '/appium/device/hide_keyboard', {}),
        execute: (script, args = []) => s('POST', '/execute/sync', { script, args }),
        screenshot: async () => Buffer.from(await s('GET', '/screenshot'), 'base64'),
        close: () => s('DELETE', ''),
      };
    },
  };
}

const EXPECT_TIMEOUT_MS = 5000;

// Assertions retry until they hold or the timeout passes, because the page
// updates asynchronously after every tap.
async function eventually(check, observe) {
  const deadline = Date.now() + EXPECT_TIMEOUT_MS;
  let last = 'condition not met';
  while (Date.now() < deadline) {
    try {
      const outcome = await check();
      if (outcome === true) return observe ? observe() : undefined;
      last = outcome;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(last);
}

async function one(session, target) {
  let found = [];
  await eventually(async () => {
    found = await session.findAll(targetXPath(target));
    return found.length > 0 || `no element matches ${JSON.stringify(target)}`;
  });
  return found[0];
}

async function runStep(session, step, ctx) {
  const t = step.target;
  switch (step.action) {
    case 'goto': return session.navigate(`${ctx.deviceBase}${step.path}`);
    case 'tap': return session.click(await one(session, t));
    case 'fill': {
      const el = await one(session, t);
      await session.clear(el);
      await session.type(el, step.value);
      // A person closes the keyboard before tapping elsewhere. In landscape the
      // keyboard can cover the page and swallow the next tap.
      await session.hideKeyboard().catch(() => {});
      return undefined;
    }
    case 'rotate': {
      // The emulator sometimes refuses a rotation briefly; this is a device
      // command retry, never a test retry.
      let last;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await session.rotate(step.orientation);
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      throw last;
    }
    case 'request': {
      const res = await fetch(`${ctx.hostBase}${step.path}`, {
        method: step.method,
        headers: step.body === undefined ? {} : { 'content-type': 'application/json' },
        body: step.body === undefined ? undefined : JSON.stringify(step.body),
      });
      if (!res.ok) throw new Error(`${step.method} ${step.path} returned ${res.status}`);
      return undefined;
    }
    case 'expect_text': {
      let got;
      return eventually(async () => {
        got = (await session.text(await one(session, t))).trim();
        return got === step.value || `text is ${JSON.stringify(got)}, expected ${JSON.stringify(step.value)}`;
      }, () => ({ text: got }));
    }
    case 'expect_contains': {
      let got;
      return eventually(async () => {
        got = await session.text(await one(session, t));
        return got.includes(step.value) || `text does not contain ${JSON.stringify(step.value)}`;
      }, () => ({ text: got.slice(0, 500) }));
    }
    case 'expect_visible':
      return eventually(async () => (await session.displayed(await one(session, t))) || `${JSON.stringify(t)} is not visible`);
    case 'expect_hidden':
      return eventually(async () => {
        const found = await session.findAll(targetXPath(t));
        for (const el of found) if (await session.displayed(el)) return `${JSON.stringify(t)} is still visible`;
        return true;
      });
    case 'expect_value': {
      let got;
      return eventually(async () => {
        got = await session.property(await one(session, t), 'value');
        return got === step.value || `value is ${JSON.stringify(got)}, expected ${JSON.stringify(step.value)}`;
      }, () => ({ value: got }));
    }
    case 'expect_enabled':
      return eventually(async () => (await session.enabled(await one(session, t))) || `${JSON.stringify(t)} is disabled`);
    case 'expect_disabled':
      return eventually(async () => !(await session.enabled(await one(session, t))) || `${JSON.stringify(t)} is enabled`);
    case 'expect_attribute': {
      let got;
      return eventually(async () => {
        got = await session.attribute(await one(session, t), step.attribute);
        return got === step.value || `${step.attribute} is ${JSON.stringify(got)}, expected ${JSON.stringify(step.value)}`;
      }, () => ({ [step.attribute]: got }));
    }
    case 'expect_min_size': {
      let r;
      return eventually(async () => {
        r = await session.rect(await one(session, t));
        return (r.width >= step.width && r.height >= step.height) || `size is ${r.width}x${r.height} CSS px, expected at least ${step.width}x${step.height}`;
      }, () => ({ width: r.width, height: r.height }));
    }
    case 'expect_stacked':
      return eventually(async () => {
        const a = await session.rect(await one(session, t));
        const b = await session.rect(await one(session, step.second));
        return b.y >= a.y + a.height - 1 || 'second element is not below the first';
      });
    case 'expect_side_by_side':
      return eventually(async () => {
        const a = await session.rect(await one(session, t));
        const b = await session.rect(await one(session, step.second));
        return (b.x >= a.x + a.width - 1 && b.y < a.y + a.height) || 'second element is not beside the first';
      });
    case 'expect_no_horizontal_scroll': {
      // The page is no wider than the screen, so it cannot scroll sideways.
      let m;
      return eventually(async () => {
        m = await session.execute('return { scroll: document.documentElement.scrollWidth, view: window.innerWidth };');
        return m.scroll <= m.view || `page is ${m.scroll} CSS px wide on a ${m.view} CSS px screen`;
      }, () => ({ page_width: m.scroll, screen_width: m.view }));
    }
    default: throw new Error(`Unknown action ${step.action}`);
  }
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export async function runMobileTests({ repoRoot, project, envName, tests, schemas, sink, runId, label, appEnv = {}, expectedBuild, stopAfterFirstFailure = false }) {
  const env = projectEnv(project, envName);
  if (!env.local_app || !env.android) throw new Error(`Environment ${envName} needs local_app and android settings for mobile tests`);
  const blockAll = (reason) =>
    tests.map((t) => ({ schema: 'qa.result.v1', run_id: runId, test_id: t.test_id, surface: 'mobile', status: 'BLOCKED', blocked_reason: reason, artefacts: [] }));
  const cleanups = [];
  try {
    const app = await startLocalApp(repoRoot, env.local_app, appEnv);
    cleanups.push(app.stop);
    if (!app.ok) return finish(blockAll(`app unavailable: ${app.detail}`));
    const want = expectedBuild ?? env.expected_build;
    if (want && app.build !== want) return finish(blockAll(`build identity is "${app.build}", expected "${want}"`));

    const device = await ensureDevice(env.android);
    if (!device.ok) return finish(blockAll(device.detail));
    if (device.started) cleanups.push(() => adb(['-s', device.serial, 'emu', 'kill']));
    const appium = await startAppium(repoRoot);
    cleanups.push(appium.stop);
    if (!appium.ok) return finish(blockAll(appium.detail));

    const port = new URL(app.baseUrl).port;
    const ctx = { deviceBase: `http://${env.android.host_address}:${port}`, hostBase: app.baseUrl };
    const session = await webdriver(appium.url).newSession({
      platformName: 'Android',
      browserName: 'Chrome',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': device.serial,
      'appium:chromedriverAutodownload': true,
      'appium:newCommandTimeout': 180,
      'appium:chromeOptions': { args: ['--disable-fre', '--no-first-run', '--no-default-browser-check'] },
    });
    cleanups.push(() => session.close());
    const deps = async () => [{ name: 'app', status: await probeHealth(`${app.baseUrl}${env.local_app.health}`) }, { name: 'android-device', status: 'up' }];
    const start = await deps();

    const evidenceBase = sink.dir('');
    const results = [];
    let stopped = false;
    for (const test of tests) {
      if (stopped) {
        results.push({ schema: 'qa.result.v1', run_id: runId, test_id: test.test_id, surface: 'mobile', status: 'NOT_RUN', artefacts: [] });
        continue;
      }
      await fetch(`${app.baseUrl}${env.local_app.reset}`, { method: 'POST' }).catch(() => {});
      await session.rotate('portrait').catch(() => {});
      const startedAt = new Date().toISOString();
      const steps = [];
      let failure = null;
      for (const [i, step] of test.steps.entries()) {
        const began = Date.now();
        try {
          const observed = await runStep(session, step, ctx);
          steps.push({ n: i + 1, action: step.action, target: step.target, ...(step.target ? { locator: targetXPath(step.target) } : {}), ok: true, ...(observed && typeof observed === 'object' ? { observed } : {}), ms: Date.now() - began });
        } catch (e) {
          failure = e.message;
          steps.push({ n: i + 1, action: step.action, target: step.target, ...(step.target ? { locator: targetXPath(step.target) } : {}), ok: false, error: e.message, ms: Date.now() - began });
          break;
        }
      }
      const shotFile = join(sink.dir(`mobile/${label}/screens`), `${test.test_id}.png`);
      writeFileSync(shotFile, await session.screenshot(), { flag: 'wx' });
      const detailFile = sink.write(`mobile/${label}/${test.test_id}.json`, {
        test_id: test.test_id, oracle: test.oracle, title: test.title, build: app.build, device: device.serial, steps,
        screenshot: relative(evidenceBase, shotFile).split(sep).join('/'),
      });
      const artefacts = [detailFile, shotFile].map((file) => ({ path: relative(evidenceBase, file).split(sep).join('/'), sha256: sha256(readFileSync(file)) }));
      results.push({
        schema: 'qa.result.v1', run_id: runId, test_id: test.test_id, surface: 'mobile', status: failure ? 'FAIL' : 'PASS',
        started_at: startedAt, ended_at: new Date().toISOString(), artefacts, dependencies: { start, end: await deps() },
      });
      if (failure && stopAfterFirstFailure) stopped = true;
    }
    return finish(results);
  } finally {
    for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => {});
  }

  function finish(list) {
    for (const r of list) {
      const check = schemas.validate('qa.result.v1', r);
      if (!check.ok) throw new Error(`Result for ${r.test_id} breaks qa.result.v1: ${check.errors.join('; ')}`);
    }
    sink.write(`mobile/${label}/results.json`, list);
    const count = (s) => list.filter((r) => r.status === s).length;
    return { label, total: list.length, pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED'), results: list };
  }
}
