import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { minimalEnv, spawnCapture } from '../engine/exec.js';
import { redact } from '../engine/redact.js';
import { startLocalApp } from './app.js';
import { projectEnv } from './project.js';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function record({ runId, kind, target, checks, files, sink, blocked }) {
  const base = sink.dir('');
  const artefacts = files.map((file) => ({ path: relative(base, file).split(sep).join('/'), sha256: sha256(readFileSync(file)) }));
  // A scan fails if any check fails; it is blocked only when nothing could be
  // measured at all.
  const measurable = checks.filter((c) => c.status !== 'BLOCKED');
  const status = blocked ? 'BLOCKED' : !measurable.length ? 'BLOCKED' : measurable.every((c) => c.ok) ? 'PASS' : 'FAIL';
  const blockedReason = blocked ?? (!measurable.length ? checks.map((c) => c.detail).join('; ') : undefined);
  return { schema: 'qa.scan.v1', run_id: runId, kind, target, status, ...(blockedReason ? { blocked_reason: blockedReason } : {}), checks, artefacts };
}

async function withApp(repoRoot, project, envName, fn) {
  const env = projectEnv(project, envName);
  const app = await startLocalApp(repoRoot, env.local_app);
  if (!app.ok) return { blocked: `app unavailable: ${app.detail}` };
  try {
    return await fn(app.baseUrl);
  } finally {
    await app.stop();
  }
}

export async function performanceScan({ repoRoot, project, envName, sink, runId }) {
  const cfg = project.scans?.performance;
  if (!cfg) throw new Error('project.yml has no scans.performance budgets');
  const { chromium } = await import('@playwright/test');
  const lighthouse = (await import('lighthouse')).default;
  const chromeLauncher = await import('chrome-launcher');
  const outcome = await withApp(repoRoot, project, envName, async (baseUrl) => {
    const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-first-run'] });
    try {
      const checks = [];
      const files = [];
      for (const page of cfg.pages) {
        const result = await lighthouse(`${baseUrl}${page}`, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices'] });
        const lhr = result.lhr;
        files.push(sink.write(`scans/performance/lighthouse${page === '/' ? '-root' : page.replace(/\//g, '-')}.json`, result.report));
        const b = cfg.budgets;
        const add = (name, value, budget, ok) => checks.push({ name: `${page} ${name}`, value, budget, ok, status: ok ? 'PASS' : 'FAIL' });
        for (const cat of ['performance', 'accessibility', 'best-practices']) {
          const score = lhr.categories[cat]?.score ?? null;
          add(`${cat} score`, score, b[cat], score !== null && score >= b[cat]);
        }
        const lcp = lhr.audits['largest-contentful-paint'].numericValue;
        add('largest contentful paint ms', Math.round(lcp), b['largest-contentful-paint-ms'], lcp <= b['largest-contentful-paint-ms']);
        const tbt = lhr.audits['total-blocking-time'].numericValue;
        add('total blocking time ms', Math.round(tbt), b['total-blocking-time-ms'], tbt <= b['total-blocking-time-ms']);
        const cls = lhr.audits['cumulative-layout-shift'].numericValue;
        add('cumulative layout shift', Number(cls.toFixed(3)), b['cumulative-layout-shift'], cls <= b['cumulative-layout-shift']);
      }
      return { checks, files };
    } finally {
      chrome.kill();
    }
  });
  return record({ runId, kind: 'performance', target: cfg.pages.join(', '), sink, ...(outcome.blocked ? { checks: [], files: [], blocked: outcome.blocked } : outcome) });
}

export async function loadScan({ repoRoot, project, envName, sink, runId }) {
  const cfg = project.scans?.load;
  if (!cfg) throw new Error('project.yml has no scans.load settings');
  const k6 = await spawnCapture('k6', ['version'], { env: minimalEnv(), timeoutMs: 10000 });
  if (k6.code !== 0) return record({ runId, kind: 'load', target: 'api', checks: [], files: [], sink, blocked: 'k6 is not installed (brew install k6)' });
  // The script is generated from data; values enter it only as JSON literals.
  const script = [
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    `export const options = { vus: ${JSON.stringify(cfg.vus)}, duration: ${JSON.stringify(cfg.duration)}, thresholds: { http_req_duration: [${JSON.stringify(`p(95)<${cfg.thresholds['p95-ms']}`)}], http_req_failed: [${JSON.stringify(`rate<${cfg.thresholds['error-rate']}`)}] } };`,
    `const REQUESTS = ${JSON.stringify(cfg.requests)};`,
    'export default function () {',
    '  for (const r of REQUESTS) {',
    "    const res = http.request(r.method, __ENV.BASE + r.path, r.body ? JSON.stringify(r.body) : null, { headers: { 'content-type': 'application/json' } });",
    "    check(res, { 'status below 400': (x) => x.status < 400 });",
    '  }',
    '}',
    '',
  ].join('\n');
  const scriptFile = sink.write('scans/load/script.js', script);
  const summaryFile = join(sink.dir('scans/load'), 'summary.json');
  const outcome = await withApp(repoRoot, project, envName, async (baseUrl) => {
    const run = await spawnCapture('k6', ['run', '--quiet', '--summary-export', summaryFile, '--env', `BASE=${baseUrl}`, scriptFile], { env: minimalEnv(), timeoutMs: 10 * 60 * 1000 });
    const out = sink.write('scans/load/k6-output.txt', `${run.stdout}\n${run.stderr}`);
    if (!existsSync(summaryFile)) return { blocked: `k6 produced no summary (exit ${run.code})` };
    const m = JSON.parse(readFileSync(summaryFile, 'utf8')).metrics;
    const p95 = m.http_req_duration['p(95)'];
    const errorRate = m.http_req_failed.value ?? m.http_req_failed.rate ?? 0;
    const t = cfg.thresholds;
    return {
      checks: [
        { name: 'p95 response time ms', value: Number(p95.toFixed(1)), budget: t['p95-ms'], ok: p95 < t['p95-ms'], status: p95 < t['p95-ms'] ? 'PASS' : 'FAIL' },
        { name: 'error rate', value: errorRate, budget: t['error-rate'], ok: errorRate < t['error-rate'], status: errorRate < t['error-rate'] ? 'PASS' : 'FAIL' },
        { name: 'requests completed', value: m.http_reqs.count, ok: m.http_reqs.count > 0, status: m.http_reqs.count > 0 ? 'PASS' : 'FAIL' },
      ],
      files: [scriptFile, summaryFile, out],
    };
  });
  return record({ runId, kind: 'load', target: cfg.requests.map((r) => `${r.method} ${r.path}`).join(', '), sink, ...(outcome.blocked ? { checks: [], files: [scriptFile], blocked: outcome.blocked } : outcome) });
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (statSync(full).size < 2 * 1024 * 1024) out.push(full);
  }
  return out;
}

export async function securityScan({ repoRoot, project, envName, sink, runId }) {
  const cfg = project.scans?.security;
  if (!cfg) throw new Error('project.yml has no scans.security settings');
  const checks = [];
  const files = [];

  // Secrets committed into the project folder.
  const leaks = listFiles(project.dir).filter((f) => !f.endsWith('.png') && redact(readFileSync(f, 'utf8'), {}) !== readFileSync(f, 'utf8'));
  checks.push({ name: 'no secrets in project files', value: leaks.map((f) => relative(repoRoot, f)), ok: leaks.length === 0, status: leaks.length ? 'FAIL' : 'PASS' });

  const outcome = await withApp(repoRoot, project, envName, async (baseUrl) => {
    const seen = {};
    for (const path of cfg.paths) {
      const res = await fetch(`${baseUrl}${path}`);
      seen[path] = Object.fromEntries(res.headers.entries());
      for (const header of cfg.required_headers) {
        const present = res.headers.has(header);
        checks.push({ name: `${path} sends ${header}`, value: res.headers.get(header), ok: present, status: present ? 'PASS' : 'FAIL' });
      }
    }
    files.push(sink.write('scans/security/headers.json', seen));
    return {};
  });
  if (outcome.blocked) checks.push({ name: 'response headers', ok: false, status: 'BLOCKED', detail: outcome.blocked });

  // Active scanning needs ZAP, which runs in Docker. Its absence is reported,
  // never treated as a pass.
  const docker = await spawnCapture('docker', ['version'], { env: minimalEnv(), timeoutMs: 10000 });
  checks.push({
    name: 'ZAP baseline scan',
    ok: false,
    status: 'BLOCKED',
    detail: docker.code === 0 ? 'Docker is available but the ZAP step is not enabled for this project' : 'ZAP by Checkmarx runs in Docker, which is not installed',
  });
  return record({ runId, kind: 'security', target: cfg.paths.join(', '), checks, files, sink });
}
