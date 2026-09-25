import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export const casesFile = (repoRoot, project, prdId) => join(repoRoot, 'projects', project, 'cases', `${prdId}.cases.yaml`);

export function loadCases(file) {
  return existsSync(file) ? YAML.parse(readFileSync(file, 'utf8')) : null;
}

// Checks the case set against its PRD: every case cites real criteria and takes
// its expected result from one of them, every acceptance criterion is covered on
// every surface the project tests, and high-risk requirements go beyond the
// happy path.
export function checkCases(doc, prd, { surfaces, schemas }) {
  const problems = [];
  const schema = schemas.validate('qa.cases.v1', doc);
  if (!schema.ok) return { problems: schema.errors.map((e) => `schema: ${e}`), coverage: null };
  if (doc.prd_id !== prd.prd_id) problems.push(`cases are for ${doc.prd_id}, PRD is ${prd.prd_id}`);

  const reqs = new Map(prd.requirements.map((r) => [r.id, r]));
  const allCriteria = new Set(prd.requirements.flatMap((r) => [...r.acceptance_criteria, ...(r.edge_cases ?? [])].map((x) => x.id)));
  const seen = new Set();
  for (const c of doc.cases) {
    if (seen.has(c.id)) problems.push(`duplicate case ID ${c.id}`);
    seen.add(c.id);
    const req = reqs.get(c.requirement);
    if (!req) {
      problems.push(`${c.id}: unknown requirement ${c.requirement}`);
      continue;
    }
    if (req.superseded_by) problems.push(`${c.id}: ${c.requirement} is superseded by ${req.superseded_by}`);
    // A case may exercise criteria of several requirements (an add that shows
    // an error message), but its expected result comes from its own requirement.
    const own = new Set([...req.acceptance_criteria, ...(req.edge_cases ?? [])].map((x) => x.id));
    for (const cr of c.criteria) if (!allCriteria.has(cr)) problems.push(`${c.id}: ${cr} is not a criterion of ${doc.prd_id}`);
    if (!c.criteria.includes(c.oracle.criterion)) problems.push(`${c.id}: oracle ${c.oracle.criterion} is not one of its criteria`);
    else if (!own.has(c.oracle.criterion)) problems.push(`${c.id}: oracle ${c.oracle.criterion} does not belong to its requirement ${c.requirement}`);
    if (!surfaces.includes(c.surface)) problems.push(`${c.id}: surface ${c.surface} is not tested in this project`);
  }

  const uncovered = [];
  let total = 0;
  for (const req of prd.requirements.filter((r) => !r.superseded_by)) {
    for (const ac of req.acceptance_criteria) {
      for (const surface of surfaces) {
        total += 1;
        if (!doc.cases.some((c) => c.surface === surface && c.criteria.includes(ac.id))) uncovered.push(`${ac.id} (${surface})`);
      }
    }
    if (req.risk === 'high' && !doc.cases.some((c) => c.requirement === req.id && c.technique !== 'happy_path')) {
      problems.push(`${req.id} is high risk but has only happy-path cases`);
    }
  }
  if (uncovered.length) problems.push(`uncovered acceptance criteria: ${uncovered.join(', ')}`);
  return { problems, coverage: { criteria_total: total, criteria_covered: total - uncovered.length, uncovered } };
}

// Merges accepted Edge Case Hunter proposals into a case set. Only proposals that
// cite an existing criterion become cases; open questions are returned for the PRD.
export function mergeEdgeCases(doc, edge) {
  const cases = [...doc.cases];
  const ids = new Set(cases.map((c) => c.id));
  const questions = [];
  for (const p of edge.proposals) {
    if (p.outcome === 'new_case' && p.case && !ids.has(p.case.id)) {
      cases.push({ ...p.case, source: 'edge_case_hunter' });
      ids.add(p.case.id);
    }
    if (p.outcome === 'open_question') questions.push({ requirement: p.requirement, technique: p.technique, scenario: p.scenario, question: p.question });
  }
  return { doc: { ...doc, cases }, questions };
}
