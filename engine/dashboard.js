import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flakiness } from './history.js';
import { coverageMap, drift } from './insights.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (x) => (x === null || x === undefined ? 'UNKNOWN' : `${(x * 100).toFixed(1)}%`);

function latestCalibrations(evidenceRoot) {
  const latest = {};
  if (!existsSync(evidenceRoot)) return latest;
  for (const run of readdirSync(evidenceRoot).sort()) {
    for (const surface of ['api', 'web', 'mobile']) {
      const file = join(evidenceRoot, run, `calibration-${surface}.json`);
      if (existsSync(file)) latest[surface] = { run, ...JSON.parse(readFileSync(file, 'utf8')) };
    }
  }
  return latest;
}

// Reviewer agreement: how often the blind reviewer's verdict matched the QA
// Lead's decision at the release gate.
function reviewerAgreement(store) {
  let compared = 0;
  let agreed = 0;
  for (const run of store.query('runs').filter((r) => /regression$/.test(r.workflow))) {
    const review = store.getStep(run.id, 'review')?.output?.value;
    const decision = store.getDecision(run.id, 'qa-lead');
    if (!review || !decision) continue;
    compared += 1;
    const reviewerSaysGo = ['APPROVED', 'APPROVED_WITH_RISKS'].includes(review.verdict);
    if (reviewerSaysGo === (decision.decision === 'approve')) agreed += 1;
  }
  return { compared, rate: compared ? agreed / compared : null };
}

// Escape rate: defects found after release divided by all defects found. QA's
// finds are the product defects triage recorded; escapes are the analysed
// reports in the project's escapes folder.
function escapeRate(store, project) {
  const dir = join(project.dir, 'escapes');
  const escapes = existsSync(dir) ? readdirSync(dir).filter((f) => /^ESC-\d{3}\.md$/.test(f)).length : 0;
  let found = 0;
  for (const run of store.query('runs').filter((r) => /regression$/.test(r.workflow))) {
    const triage = store.getStep(run.id, 'triage')?.output?.value;
    found += (triage?.findings ?? []).filter((f) => f.cause === 'product_defect').length;
  }
  return { escapes, found, rate: escapes + found ? escapes / (escapes + found) : null };
}

export function buildDashboard({ store, repoRoot, project, schemas, evidenceRoot }) {
  const history = store.query('history', { project: project.name });
  const flakes = flakiness(history, store.query('reruns'));
  const coverage = coverageMap({ repoRoot, project, schemas, history });
  const drifted = drift({ repoRoot, project });
  const calibrations = latestCalibrations(evidenceRoot);
  const agreement = reviewerAgreement(store);
  const escapes = escapeRate(store, project);
  const audit = store.auditSummary();
  audit.agreed = audit.agreed ?? 0;
  const runs = store.query('runs');
  const passing = coverage.filter((c) => c.latest === 'PASS').length;
  const faults = Object.values(calibrations).reduce((acc, c) => ({ caught: acc.caught + c.faults.filter((f) => f.detected).length, total: acc.total + c.faults.length }), { caught: 0, total: 0 });
  const spend = runs.reduce((s, r) => s + r.cost_usd, 0);

  const targets = [
    { name: 'Requirement coverage', value: coverage.length ? passing / coverage.length : null, goal: '100%', detail: `${passing} of ${coverage.length} acceptance criteria pass their latest automated run` },
    { name: 'Fault detection rate', value: faults.total ? faults.caught / faults.total : null, goal: '99% or more', detail: `${faults.caught} of ${faults.total} seeded faults caught in the latest calibration of each surface` },
    { name: 'Verdict accuracy', value: audit.decided ? audit.agreed / audit.decided : null, goal: '99% or more', detail: audit.decided ? `${audit.agreed} of ${audit.decided} audited passes confirmed by the QA Lead` : 'UNKNOWN: run qa audit sample weekly and record each check' },
    { name: 'Defect escape rate', value: escapes.rate, goal: 'under 1%', detail: escapes.rate === null ? 'UNKNOWN: no defects recorded yet' : `${escapes.escapes} escaped after release, ${escapes.found} found by QA before release` },
  ];
  const health = [
    { name: 'Flake rate', value: pct(flakes.rate), detail: `${flakes.flaky.length} of ${flakes.tests} tests` },
    { name: 'Reviewer agreement', value: pct(agreement.rate), detail: `${agreement.compared} release decisions compared` },
    { name: 'Spend', value: `$${spend.toFixed(2)}`, detail: `${runs.length} runs, $${(spend / Math.max(runs.length, 1)).toFixed(3)} per run` },
    { name: 'Drift', value: String(drifted.length), detail: drifted.length ? 'PRDs changed after their cases or tests' : 'none' },
  ];
  // Escape rate is better when lower; every other target is better when higher.
  const tone = (v, lowerIsBetter = false) => (v === null ? 'unknown' : lowerIsBetter ? (v < 0.01 ? 'good' : v < 0.05 ? 'warn' : 'bad') : v >= 0.99 ? 'good' : v >= 0.9 ? 'warn' : 'bad');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Factory Dashboard</title>
<style>
:root{--bg:#f4f6f5;--card:#fff;--ink:#1a232c;--muted:#5a6570;--line:#d6dcd8;--good:#1b7a5e;--warn:#9a6412;--bad:#a8322a;--unknown:#5a6570;--font:-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--card:#18212a;--ink:#e3e8ec;--muted:#98a4ae;--line:#2c3742;--good:#5cc9a8;--warn:#e7b25a;--bad:#ee8a7e;--unknown:#98a4ae}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 var(--font);padding:24px 16px}
main{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
h1{margin:0;font-size:26px}h2{margin:0 0 10px;font-size:17px}p{margin:0;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:480px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:4px}
.v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.unknown{color:var(--unknown)}
.tbl{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
td.n{font-variant-numeric:tabular-nums}
</style></head><body><main>
<header><h1>QA Factory Dashboard</h1><p>Project ${esc(project.name)} · generated from run history, calibration records and the PRDs. Nothing on this page is estimated.</p></header>
<section><h2>Quality targets</h2><div class="grid">
${targets.map((t) => `<div class="card"><span>${esc(t.name)}</span><span class="v ${tone(t.value, t.name === 'Defect escape rate')}">${pct(t.value)}</span><p>Goal ${esc(t.goal)}. ${esc(t.detail)}</p></div>`).join('')}
</div></section>
<section><h2>Pipeline health</h2><div class="grid">
${health.map((h) => `<div class="card"><span>${esc(h.name)}</span><span class="v">${esc(h.value)}</span><p>${esc(h.detail)}</p></div>`).join('')}
</div></section>
<section><h2>Latest calibration per surface</h2><div class="tbl"><table><thead><tr><th>Surface</th><th>Run</th><th>Healthy build</th><th>Faults caught</th><th>Wrong build blocks</th><th>Certified</th></tr></thead><tbody>
${Object.entries(calibrations).map(([s, c]) => `<tr><td>${s}</td><td>${esc(c.run)}</td><td class="n">${c.baseline.passed}/${c.baseline.total}</td><td class="n">${c.faults.filter((f) => f.detected).length}/${c.faults.length}</td><td>${c.identity_check.ok ? 'yes' : 'no'}</td><td class="${c.ok ? 'good' : 'bad'}">${c.ok ? 'yes' : 'no'}</td></tr>`).join('')}
</tbody></table></div></section>
<section><h2>Coverage</h2><div class="tbl"><table><thead><tr><th>PRD</th><th>Criterion</th><th>Risk</th><th>Cases</th><th>Automated</th><th>Manual</th><th>Latest</th></tr></thead><tbody>
${coverage.map((c) => `<tr><td>${esc(c.prd_id)}</td><td>${esc(c.criterion)}</td><td>${esc(c.risk)}</td><td class="n">${c.cases}</td><td class="n">${c.automated}</td><td class="n">${c.manual}</td><td class="${c.latest === 'PASS' ? 'good' : c.latest === 'FAIL' ? 'bad' : 'warn'}">${esc(c.latest)}</td></tr>`).join('')}
</tbody></table></div></section>
<section><h2>Recent runs</h2><div class="tbl"><table><thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Cost</th></tr></thead><tbody>
${runs.slice(-20).reverse().map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.workflow)}</td><td>${esc(r.status)}</td><td class="n">$${r.cost_usd.toFixed(4)}</td></tr>`).join('')}
</tbody></table></div></section>
</main></body></html>
`;
}
