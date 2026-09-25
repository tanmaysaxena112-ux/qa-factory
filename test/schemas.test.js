import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePaths } from '../engine/config.js';
import { loadSchemas } from '../engine/schemas.js';

const schemas = loadSchemas(resolvePaths().schemas);
const sha = 'a'.repeat(64);

test('every contract schema compiles in strict mode', () => {
  assert.deepEqual(schemas.ids, [
    'qa.apitests.v1', 'qa.calibration.v1', 'qa.cases.v1', 'qa.critique.v1', 'qa.edgecases.v1', 'qa.finding.v1', 'qa.prd-draft.v1',
    'qa.prd.v1', 'qa.report.v1', 'qa.result.v1', 'qa.review.v1', 'qa.selftest.v1', 'qa.testplan.v1', 'qa.triage.v1', 'qa.webtests.v1', 'qa.workflow.v1',
  ]);
});

test('bundled schemas are self-contained for the model', () => {
  const bundled = schemas.bundle('qa.triage.v1');
  assert.equal(JSON.stringify(bundled).includes('"$ref":"qa.'), false);
  assert.ok(bundled.$defs.qa_finding_v1);
});

test('a PASS or FAIL result must cite an artefact', () => {
  const base = { schema: 'qa.result.v1', run_id: 'RUN-2026-0925-001', test_id: 'API-LOGIN-01', surface: 'api' };
  assert.equal(schemas.validate('qa.result.v1', { ...base, status: 'PASS', artefacts: [] }).ok, false);
  assert.equal(schemas.validate('qa.result.v1', { ...base, status: 'FAIL', artefacts: [] }).ok, false);
  assert.equal(schemas.validate('qa.result.v1', { ...base, status: 'PASS', artefacts: [{ path: 'a.xml', sha256: sha }] }).ok, true);
  assert.equal(schemas.validate('qa.result.v1', { ...base, status: 'NOT_RUN', artefacts: [] }).ok, true);
});

test('a BLOCKED result must say why', () => {
  const base = { schema: 'qa.result.v1', run_id: 'RUN-2026-0925-001', test_id: 'API-LOGIN-01', surface: 'api', status: 'BLOCKED', artefacts: [] };
  assert.equal(schemas.validate('qa.result.v1', base).ok, false);
  assert.equal(schemas.validate('qa.result.v1', { ...base, blocked_reason: 'UAT unreachable' }).ok, true);
});

test('findings accept UNKNOWN but never an unproven environment cause', () => {
  const base = {
    schema: 'qa.finding.v1',
    finding_id: 'F-01',
    run_id: 'RUN-2026-0925-001',
    title: 'Login returns 500',
    test_ids: ['API-LOGIN-01'],
    cause: 'UNKNOWN',
    severity: 'UNKNOWN',
    steps_to_reproduce: 'UNKNOWN',
    expected: '200',
    actual: '500',
    evidence: ['steps/run/stdout.txt'],
  };
  assert.equal(schemas.validate('qa.finding.v1', base).ok, true);
  assert.equal(schemas.validate('qa.finding.v1', { ...base, steps_to_reproduce: 'probably click login' }).ok, false);
  assert.equal(schemas.validate('qa.finding.v1', { ...base, cause: 'environment' }).ok, false);
  assert.equal(schemas.validate('qa.finding.v1', { ...base, cause: 'environment', cause_evidence: 'health check down at start' }).ok, true);
});

test('a high-risk requirement must name its risk reasons', () => {
  const req = { id: 'REQ-001', title: 'Pay', risk: 'high', acceptance_criteria: [{ id: 'AC-001.1', text: 'Charges once' }] };
  const prd = { schema: 'qa.prd.v1', prd_id: 'PRD-CHECKOUT', project: 'demo', title: 'Checkout', status: 'draft', requirements: [req] };
  assert.equal(schemas.validate('qa.prd.v1', prd).ok, false);
  assert.equal(schemas.validate('qa.prd.v1', { ...prd, requirements: [{ ...req, risk_reasons: ['money'] }] }).ok, true);
});

test('acceptance criteria IDs follow AC-###.n', () => {
  const prd = {
    schema: 'qa.prd.v1', prd_id: 'PRD-CHECKOUT', project: 'demo', title: 'Checkout', status: 'draft',
    requirements: [{ id: 'REQ-001', title: 'Pay', risk: 'low', acceptance_criteria: [{ id: 'AC1', text: 'x' }] }],
  };
  assert.equal(schemas.validate('qa.prd.v1', prd).ok, false);
});

test('review verdicts are limited to the six defined values', () => {
  const review = { schema: 'qa.review.v1', run_id: 'RUN-2026-0925-001', criteria: [], reexecuted: [], summary: 'ok' };
  assert.equal(schemas.validate('qa.review.v1', { ...review, verdict: 'APPROVED' }).ok, true);
  assert.equal(schemas.validate('qa.review.v1', { ...review, verdict: 'LOOKS_FINE' }).ok, false);
});
