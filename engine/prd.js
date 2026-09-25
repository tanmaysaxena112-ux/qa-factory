import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const REQUIRED_SECTIONS = ['Summary', 'Scope', 'Requirements', 'Revision history'];
const PLACEHOLDER = /\b(TODO|TBD|TBC|FIXME|XXX|lorem ipsum)\b|\?\?\?/i;
const ITEM = /^-\s+((AC|EC|OQ)-(\d{3})\.(\d+)):\s+(.+)$/;

// Parses the Markdown PRD into its qa.prd.v1 index. The index is always
// generated, never edited, so the Markdown stays the single source of truth.
export function parsePrd(text) {
  const problems = [];
  const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!fm) return { index: null, problems: ['missing front matter'] };
  const meta = YAML.parse(fm[1]) ?? {};
  const body = fm[2];

  const sections = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  for (const s of REQUIRED_SECTIONS) if (!sections.includes(s)) problems.push(`missing section "## ${s}"`);

  const requirements = [];
  const blocks = body.split(/^### /m).slice(1);
  for (const block of blocks) {
    const [heading, ...lines] = block.split('\n');
    const head = /^(REQ-(\d{3})):\s+(.+)$/.exec(heading.trim());
    if (!head) continue;
    const [, id, num, title] = head;
    const req = { id, title: title.trim(), acceptance_criteria: [], edge_cases: [], open_questions: [] };
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('## ')) break;
      const risk = /^Risk:\s+(high|medium|low)(?:\s+\(([^)]*)\))?$/i.exec(line);
      if (risk) {
        req.risk = risk[1].toLowerCase();
        if (risk[2]) req.risk_reasons = risk[2].split(',').map((r) => r.trim().replace(/\s+/g, '_').toLowerCase());
        continue;
      }
      const sup = /^Superseded by:\s+(REQ-\d{3})$/.exec(line);
      if (sup) {
        req.superseded_by = sup[1];
        continue;
      }
      const item = ITEM.exec(line);
      if (!item) continue;
      const [, itemId, kind, parent, , itemText] = item;
      if (parent !== num) problems.push(`${itemId} is listed under ${id}; its number must match the requirement`);
      const list = { AC: req.acceptance_criteria, EC: req.edge_cases, OQ: req.open_questions }[kind];
      list.push({ id: itemId, text: itemText.trim() });
    }
    if (!req.risk) problems.push(`${id} has no "Risk:" line`);
    if (!req.edge_cases.length) delete req.edge_cases;
    if (!req.open_questions.length) delete req.open_questions;
    requirements.push(req);
  }

  const ids = requirements.map((r) => r.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`duplicate requirement IDs: ${[...new Set(dupes)].join(', ')}`);
  const itemIds = requirements.flatMap((r) => [...r.acceptance_criteria, ...(r.edge_cases ?? []), ...(r.open_questions ?? [])].map((x) => x.id));
  const itemDupes = itemIds.filter((id, i) => itemIds.indexOf(id) !== i);
  if (itemDupes.length) problems.push(`duplicate item IDs: ${[...new Set(itemDupes)].join(', ')}`);

  const index = {
    schema: 'qa.prd.v1',
    prd_id: meta.prd_id,
    project: meta.project,
    title: meta.title,
    status: meta.status,
    requirements,
  };

  if (meta.status === 'approved') {
    const open = requirements.flatMap((r) => (r.open_questions ?? []).map((q) => q.id));
    if (open.length) problems.push(`an approved PRD may not have open questions: ${open.join(', ')}`);
    if (PLACEHOLDER.test(body)) problems.push('an approved PRD may not contain placeholder text');
  }
  return { index, problems };
}

export function validatePrdText(text, schemas) {
  const { index, problems } = parsePrd(text);
  if (index) {
    const check = schemas.validate('qa.prd.v1', index);
    if (!check.ok) problems.push(...check.errors.map((e) => `schema: ${e}`));
  }
  return { index, problems };
}

export function projectPrds(repoRoot, project) {
  const dir = join(repoRoot, 'projects', project, 'prd');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^PRD-[A-Z0-9-]+\.md$/.test(f)).sort().map((f) => join(dir, f));
}

export function loadPrdIndex(file, schemas) {
  const { index, problems } = validatePrdText(readFileSync(file, 'utf8'), schemas);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return index;
}
