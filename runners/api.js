import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { probeHealth, startLocalApp } from './app.js';
import { loadContract } from './contract.js';
import { listFiles, projectEnv } from './project.js';

// Loads the project's API test specs and enforces the automation gate: every
// test implements an approved case, on the API surface, with the same oracle.
export function loadApiTests(project, schemas) {
  const problems = [];
  const cases = new Map();
  for (const file of listFiles(join(project.dir, 'cases'), /\.cases\.yaml$/)) {
    for (const c of YAML.parse(readFileSync(file, 'utf8')).cases ?? []) cases.set(c.id, c);
  }
  const tests = [];
  for (const file of listFiles(join(project.dir, project.api?.tests ?? 'api/tests'), /\.json$/)) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const check = schemas.validate('qa.apitests.v1', doc);
    if (!check.ok) {
      problems.push(`${file}: ${check.errors.join('; ')}`);
      continue;
    }
    for (const t of doc.tests) {
      // Tests are literal data. Any placeholder syntax means the author guessed
      // at values instead of using the project's test data.
      if (JSON.stringify(t).includes('{{')) problems.push(`${t.test_id}: contains "{{" placeholder syntax; tests must use literal values`);
      if (t.steps.some((s) => s.request.body !== undefined && s.request.raw_body !== undefined)) problems.push(`${t.test_id}: a step sets both body and raw_body`);
      const c = cases.get(t.test_id);
      if (!c) problems.push(`${t.test_id}: no approved test case with this ID`);
      else if (c.surface !== 'api') problems.push(`${t.test_id}: case surface is ${c.surface}, not api`);
      else if (c.oracle.criterion !== t.oracle) problems.push(`${t.test_id}: oracle ${t.oracle} differs from the case's ${c.oracle.criterion}`);
      if (tests.some((x) => x.test_id === t.test_id)) problems.push(`${t.test_id}: defined twice`);
      tests.push(t);
    }
  }
  return { tests, problems, cases };
}

function readPath(body, path) {
  let value = body;
  for (const part of path.slice(1).match(/\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\]/g) ?? []) {
    if (value === null || value === undefined) return { found: false };
    const key = part.startsWith('.') ? part.slice(1) : Number(part.slice(1, -1));
    if (typeof value !== 'object' || !(key in value)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function runStep(baseUrl, step, contract) {
  const { method, path, body, raw_body: rawBody } = step.request;
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return { name: step.name, request: step.request, ok: false, blocked: true, failures: [`request failed: ${e.cause?.code ?? e.message}`] };
  }
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  let parsed;
  if (text && /application\/json/.test(contentType)) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  const failures = [];
  if (res.status !== step.expect.status) failures.push(`status ${res.status}, expected ${step.expect.status}`);
  if (step.expect.contract !== false) {
    const c = contract.check(method, path, res.status, contentType, text ? parsed ?? text : undefined);
    for (const e of c.errors) failures.push(`contract: ${e}`);
  }
  for (const a of step.expect.json ?? []) {
    const got = readPath(parsed, a.path);
    if ('exists' in a && got.found !== a.exists) failures.push(`${a.path} ${a.exists ? 'missing' : 'present but should be absent'}`);
    if ('equals' in a && (!got.found || !same(got.value, a.equals))) failures.push(`${a.path} = ${JSON.stringify(got.value)}, expected ${JSON.stringify(a.equals)}`);
    // "contains" matches an array element whose listed fields all equal the
    // expected values, wherever it sits; order-independent by design.
    if ('contains' in a) {
      const match = (el) => (a.contains && typeof a.contains === 'object' ? Object.entries(a.contains).every(([k, v]) => el && same(el[k], v)) : same(el, a.contains));
      if (!got.found || !Array.isArray(got.value) || !got.value.some(match)) failures.push(`${a.path} has no element matching ${JSON.stringify(a.contains)}`);
    }
    if ('length' in a && (!got.found || !Array.isArray(got.value) || got.value.length !== a.length)) {
      failures.push(`${a.path} length ${Array.isArray(got.value) ? got.value.length : 'n/a'}, expected ${a.length}`);
    }
  }
  return {
    name: step.name,
    request: step.request,
    response: { status: res.status, content_type: contentType, body: parsed ?? text },
    duration_ms: Date.now() - started,
    ok: failures.length === 0,
    failures,
  };
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Runs tests against a freshly started app. `sink.write(rel, content)` stores
// evidence and returns the stored text's path; results cite those files.
export async function runApiTests({ repoRoot, project, envName, tests, schemas, sink, runId, label, appEnv = {}, expectedBuild }) {
  const env = projectEnv(project, envName);
  const contract = loadContract(join(project.dir, project.api.openapi));
  const results = [];
  const now = () => new Date().toISOString();
  const blockAll = (reason, deps) =>
    tests.map((t) => ({
      schema: 'qa.result.v1', run_id: runId, test_id: t.test_id, surface: 'api', status: 'BLOCKED', blocked_reason: reason, artefacts: [], dependencies: deps,
    }));

  if (!env.local_app) throw new Error(`Environment ${envName} has no local_app; remote environments arrive with preflight in a later phase`);
  const app = await startLocalApp(repoRoot, env.local_app, appEnv);
  const unknownDeps = { start: [{ name: 'app', status: 'down' }], end: [{ name: 'app', status: 'down' }] };
  if (!app.ok) return finish(blockAll(`app unavailable: ${app.detail}`, unknownDeps));

  try {
    const want = expectedBuild ?? env.expected_build;
    const start = [{ name: 'app', status: await probeHealth(`${app.baseUrl}${env.local_app.health}`) }];
    if (want && app.build !== want) {
      return finish(blockAll(`build identity is "${app.build}", expected "${want}"`, { start, end: start }));
    }
    const raw = [];
    for (const test of tests) {
      if (env.local_app.reset) await fetch(`${app.baseUrl}${env.local_app.reset}`, { method: 'POST' }).catch(() => {});
      const startedAt = now();
      const steps = [];
      for (const step of test.steps) steps.push(await runStep(app.baseUrl, step, contract));
      raw.push({ test, steps, startedAt, endedAt: now() });
    }
    const end = [{ name: 'app', status: await probeHealth(`${app.baseUrl}${env.local_app.health}`) }];
    for (const { test, steps, startedAt, endedAt } of raw) {
      const detail = { test_id: test.test_id, oracle: test.oracle, title: test.title, build: app.build, steps };
      const text = `${JSON.stringify(detail, null, 2)}\n`;
      const rel = `api/${label}/${test.test_id}.json`;
      // Hash the stored file, not the input: redaction may have changed it.
      const stored = readFileSync(sink.write(rel, text));
      const blocked = steps.some((s) => s.blocked);
      results.push({
        schema: 'qa.result.v1',
        run_id: runId,
        test_id: test.test_id,
        surface: 'api',
        status: blocked ? 'BLOCKED' : steps.every((s) => s.ok) ? 'PASS' : 'FAIL',
        ...(blocked ? { blocked_reason: steps.find((s) => s.blocked).failures[0] } : {}),
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: Date.parse(endedAt) - Date.parse(startedAt),
        artefacts: blocked ? [] : [{ path: rel, sha256: sha256(stored) }],
        dependencies: { start, end },
      });
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
    sink.write(`api/${label}/results.json`, list);
    const count = (s) => list.filter((r) => r.status === s).length;
    return { label, total: list.length, pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED'), results: list };
  }
}
