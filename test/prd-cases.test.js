import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCases, mergeEdgeCases } from '../engine/cases.js';
import { resolvePaths } from '../engine/config.js';
import { parsePrd, validatePrdText } from '../engine/prd.js';
import { loadSchemas } from '../engine/schemas.js';

const schemas = loadSchemas(resolvePaths().schemas);

const prdText = (status = 'draft', extra = '') => `---
prd_id: PRD-CART
project: demo-shop
title: Cart
status: ${status}
---

# Cart

## Summary
Shoppers add products to a cart.

## Scope
In scope: adding items.

## Requirements

### REQ-001: Add an item
Risk: high (money)

Acceptance criteria:
- AC-001.1: Adding 2 of P-1 returns 201 with line_total 9.98.
- AC-001.2: Quantity 11 returns 400 invalid_quantity.

Edge cases:
- EC-001.1: Quantity 10 is accepted.
${extra}
### REQ-002: See the cart
Risk: low

Acceptance criteria:
- AC-002.1: GET /cart returns items, currency and total.

## Revision history
- 2026-09-25 draft
`;

test('a PRD parses into a schema-valid index', () => {
  const { index, problems } = validatePrdText(prdText(), schemas);
  assert.deepEqual(problems, []);
  assert.equal(index.requirements.length, 2);
  assert.deepEqual(index.requirements[0].risk_reasons, ['money']);
  assert.equal(index.requirements[0].edge_cases[0].id, 'EC-001.1');
});

test('an approved PRD may not carry open questions or placeholders', () => {
  const withQuestion = validatePrdText(prdText('approved', 'Open questions:\n- OQ-001.1: What about decimals?\n'), schemas);
  assert.match(withQuestion.problems.join(), /open questions: OQ-001.1/);
  const withTodo = validatePrdText(prdText('approved').replace('Shoppers add', 'TODO shoppers add'), schemas);
  assert.match(withTodo.problems.join(), /placeholder/);
  assert.deepEqual(validatePrdText(prdText('approved'), schemas).problems, []);
});

test('criterion numbers must match their requirement and risk must be stated', () => {
  const wrong = parsePrd(prdText().replace('- AC-002.1:', '- AC-005.1:'));
  assert.match(wrong.problems.join(), /AC-005.1 is listed under REQ-002/);
  const noRisk = parsePrd(prdText().replace('Risk: low\n', ''));
  assert.match(noRisk.problems.join(), /REQ-002 has no "Risk:" line/);
});

const prd = validatePrdText(prdText(), schemas).index;
const baseCase = {
  requirement: 'REQ-001', surface: 'api', technique: 'happy_path', steps: ['POST /cart/items'], source: 'test_designer',
};
const cases = (list) => ({ schema: 'qa.cases.v1', prd_id: 'PRD-CART', project: 'demo-shop', cases: list });

test('every acceptance criterion must be covered and every oracle must be a cited criterion', () => {
  const doc = cases([
    { ...baseCase, id: 'API-CART-01', title: 'add', criteria: ['AC-001.1'], oracle: { criterion: 'AC-001.1', expected: '201' } },
    { ...baseCase, id: 'API-CART-02', title: 'bad oracle', criteria: ['AC-001.1'], oracle: { criterion: 'AC-001.2', expected: '400' } },
  ]);
  const { problems, coverage } = checkCases(doc, prd, { surfaces: ['api'], schemas });
  assert.match(problems.join('\n'), /API-CART-02: oracle AC-001.2 is not one of its criteria/);
  assert.match(problems.join('\n'), /uncovered acceptance criteria: AC-001.2 \(api\), AC-002.1 \(api\)/);
  assert.match(problems.join('\n'), /REQ-001 is high risk but has only happy-path cases/);
  assert.equal(coverage.criteria_covered, 1);
});

test('a complete case set passes and edge case proposals merge in', () => {
  const doc = cases([
    { ...baseCase, id: 'API-CART-01', title: 'add', criteria: ['AC-001.1'], oracle: { criterion: 'AC-001.1', expected: '201' } },
    { ...baseCase, id: 'API-CART-02', title: 'limit', technique: 'boundary', criteria: ['AC-001.2'], oracle: { criterion: 'AC-001.2', expected: '400' } },
    { ...baseCase, id: 'API-CART-03', requirement: 'REQ-002', title: 'view', criteria: ['AC-002.1'], oracle: { criterion: 'AC-002.1', expected: 'total' } },
  ]);
  assert.deepEqual(checkCases(doc, prd, { surfaces: ['api'], schemas }).problems, []);
  const edge = {
    schema: 'qa.edgecases.v1',
    prd_id: 'PRD-CART',
    proposals: [
      { technique: 'boundary', requirement: 'REQ-001', scenario: 'quantity 10', outcome: 'new_case',
        case: { ...baseCase, id: 'API-CART-04', title: 'max', technique: 'boundary', criteria: ['EC-001.1'], oracle: { criterion: 'EC-001.1', expected: '201' }, source: 'test_designer' } },
      { technique: 'data_extreme', requirement: 'REQ-001', scenario: 'quantity 2.5', outcome: 'open_question', question: 'Is 2.5 rejected?' },
    ],
  };
  assert.equal(schemas.validate('qa.edgecases.v1', edge).ok, true);
  const merged = mergeEdgeCases(doc, edge);
  assert.equal(merged.doc.cases.length, 4);
  assert.equal(merged.doc.cases[3].source, 'edge_case_hunter');
  assert.equal(merged.questions[0].question, 'Is 2.5 rejected?');
  assert.deepEqual(checkCases(merged.doc, prd, { surfaces: ['api'], schemas }).problems, []);
});

test('a case may cite other requirements, but its oracle must be its own', () => {
  const doc = cases([
    { ...baseCase, id: 'API-CART-01', title: 'add', criteria: ['AC-001.1', 'AC-002.1'], oracle: { criterion: 'AC-001.1', expected: '201' } },
    { ...baseCase, id: 'API-CART-02', title: 'wrong owner', criteria: ['AC-002.1'], oracle: { criterion: 'AC-002.1', expected: 'total' } },
    { ...baseCase, id: 'API-CART-03', title: 'ghost', criteria: ['AC-009.1'], oracle: { criterion: 'AC-009.1', expected: 'x' } },
  ]);
  const text = checkCases(doc, prd, { surfaces: ['api'], schemas }).problems.join('\n');
  assert.doesNotMatch(text, /API-CART-01/);
  assert.match(text, /API-CART-02: oracle AC-002.1 does not belong to its requirement REQ-001/);
  assert.match(text, /API-CART-03: AC-009.1 is not a criterion of PRD-CART/);
});
