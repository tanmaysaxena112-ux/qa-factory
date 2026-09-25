import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import { checkCases, casesFile, loadCases, mergeEdgeCases } from '../engine/cases.js';
import { resolvePaths } from '../engine/config.js';
import { createEvidence } from '../engine/evidence.js';
import { loadPrdIndex, projectPrds, validatePrdText } from '../engine/prd.js';
import { redact } from '../engine/redact.js';
import { loadSchemas } from '../engine/schemas.js';
import { openStore } from '../engine/store.js';
import { loadApiTests, runApiTests } from '../runners/api.js';
import { calibrate } from '../runners/calibrate.js';
import { loadProject } from '../runners/project.js';

const FAILED = 1;
const USAGE = 2;

function need(value, message) {
  if (!value) {
    const e = new Error(message);
    e.usage = true;
    throw e;
  }
  return value;
}

// Evidence goes into the current run when called from a workflow step, or into
// an explicit folder when a person runs the command directly.
function evidenceSink(paths, out) {
  const runId = process.env.QA_RUN_ID;
  if (runId) {
    const evidence = createEvidence(paths.evidence);
    return { runId, write: (rel, content) => evidence.write(runId, rel, content) };
  }
  const base = resolve(need(out, 'Outside a workflow run, pass --out <folder> for evidence'));
  return {
    runId: 'RUN-0000-0000-000',
    write(rel, content) {
      const file = resolve(base, rel);
      if (!file.startsWith(base + sep)) throw new Error(`Evidence path escapes the folder: ${rel}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, redact(typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`), { flag: 'wx' });
      return file;
    },
  };
}

function print(json, value, text) {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

function insideRepo(repoRoot, rel) {
  const abs = resolve(repoRoot, rel);
  const r = relative(repoRoot, abs);
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`Path must be inside the repository: ${rel}`);
  return abs;
}

export async function runCommand(command, rest, values) {
  const paths = resolvePaths();
  const schemas = loadSchemas(paths.schemas);

  if (command === 'prd') {
    const [sub] = rest;
    if (sub === 'index') {
      const { index, problems } = validatePrdText(readFileSync(need(values.file, 'Usage: qa prd index --file <PRD.md>'), 'utf8'), schemas);
      if (problems.length) {
        console.error(problems.join('\n'));
        return FAILED;
      }
      console.log(JSON.stringify(index, null, 2));
      return 0;
    }
    if (sub === 'validate') {
      const project = loadProject(paths.repoRoot, need(values.project, 'Usage: qa prd validate --project <name>'));
      const files = projectPrds(paths.repoRoot, project.name);
      if (!files.length) {
        console.log(`No PRDs in projects/${project.name}/prd`);
        return FAILED;
      }
      let failed = false;
      for (const file of files) {
        const { index, problems } = validatePrdText(readFileSync(file, 'utf8'), schemas);
        failed ||= problems.length > 0;
        console.log(problems.length ? `INVALID  ${index?.prd_id ?? file}\n  ${problems.join('\n  ')}` : `valid    ${index.prd_id} (${index.status}, ${index.requirements.length} requirements)`);
      }
      return failed ? FAILED : 0;
    }
    need(false, 'Usage: qa prd validate --project <name> | qa prd index --file <PRD.md>');
  }

  if (command === 'cases') {
    const [sub] = rest;
    if (sub === 'validate') {
      const project = loadProject(paths.repoRoot, need(values.project, 'Usage: qa cases validate --project <name>'));
      let failed = false;
      const report = [];
      for (const file of projectPrds(paths.repoRoot, project.name)) {
        const prd = loadPrdIndex(file, schemas);
        const doc = loadCases(casesFile(paths.repoRoot, project.name, prd.prd_id));
        if (!doc) {
          failed = true;
          report.push({ prd_id: prd.prd_id, problems: ['no case file'] });
          continue;
        }
        const { problems, coverage } = checkCases(doc, prd, { surfaces: project.surfaces, schemas });
        failed ||= problems.length > 0;
        report.push({ prd_id: prd.prd_id, cases: doc.cases.length, coverage, problems });
      }
      print(values.json, report, report.map((r) => `${r.problems.length ? 'INVALID' : 'valid  '}  ${r.prd_id}  ${r.cases ?? 0} cases  coverage ${r.coverage ? `${r.coverage.criteria_covered}/${r.coverage.criteria_total}` : 'n/a'}${r.problems.length ? `\n  ${r.problems.join('\n  ')}` : ''}`).join('\n'));
      return failed ? FAILED : 0;
    }
    need(false, 'Usage: qa cases validate --project <name>');
  }

  if (command === 'api') {
    const [sub] = rest;
    const project = loadProject(paths.repoRoot, need(values.project, `Usage: qa api ${sub ?? 'run'} --project <name>`));
    const loaded = loadApiTests(project, schemas);
    if (sub === 'validate') {
      console.log(loaded.problems.length ? `INVALID\n  ${loaded.problems.join('\n  ')}` : `valid    ${loaded.tests.length} API tests, each implementing an approved case`);
      return loaded.problems.length ? FAILED : 0;
    }
    if (sub === 'run') {
      if (loaded.problems.length) {
        console.error(`Automation gate failed:\n  ${loaded.problems.join('\n  ')}`);
        return FAILED;
      }
      let tests = loaded.tests;
      if (values.plan) {
        const plan = JSON.parse(readFileSync(values.plan, 'utf8'));
        const check = schemas.validate('qa.testplan.v1', plan);
        if (!check.ok) throw new Error(`Plan breaks qa.testplan.v1: ${check.errors.join('; ')}`);
        const wanted = new Set(plan.tests.filter((t) => t.surface === 'api').map((t) => t.test_id));
        tests = tests.filter((t) => wanted.has(t.test_id));
      }
      if (values.only) {
        const wanted = new Set(values.only.split(','));
        tests = tests.filter((t) => wanted.has(t.test_id));
      }
      if (!tests.length) throw new Error('No tests selected');
      const sink = evidenceSink(paths, values.out);
      const summary = await runApiTests({
        repoRoot: paths.repoRoot, project, envName: values.env ?? 'dev', tests, schemas, sink, runId: sink.runId, label: values.label ?? 'main',
      });
      const { results, ...counts } = summary;
      console.log(JSON.stringify(counts));
      return 0;
    }
    if (sub === 'rerun') {
      // The spot re-execution for blind review: one passing and one failing test
      // from this run, picked deterministically, run again on a fresh app.
      const runId = need(process.env.QA_RUN_ID, 'qa api rerun only runs inside a workflow run');
      const file = join(paths.evidence, runId, 'api', values.label ?? 'main', 'results.json');
      if (!existsSync(file)) throw new Error(`No results to re-run at ${relative(paths.dataRoot, file)}`);
      const previous = JSON.parse(readFileSync(file, 'utf8'));
      const pick = ['PASS', 'FAIL'].map((s) => previous.filter((r) => r.status === s).map((r) => r.test_id).sort()[0]).filter(Boolean);
      if (!pick.length) {
        evidenceSink(paths).write('api/rerun/comparison.json', []);
        console.log(JSON.stringify({ rerun: [], note: 'no passing or failing tests to re-run' }));
        return 0;
      }
      const tests = loaded.tests.filter((t) => pick.includes(t.test_id));
      const sink = evidenceSink(paths);
      const summary = await runApiTests({ repoRoot: paths.repoRoot, project, envName: values.env ?? 'dev', tests, schemas, sink, runId, label: 'rerun' });
      const original = Object.fromEntries(previous.map((r) => [r.test_id, r.status]));
      const comparison = summary.results.map((r) => ({ test_id: r.test_id, original: original[r.test_id], rerun: r.status, reproduced: r.status === original[r.test_id] }));
      sink.write('api/rerun/comparison.json', comparison);
      console.log(JSON.stringify({ rerun: comparison }));
      return 0;
    }
    need(false, 'Usage: qa api validate|run|rerun --project <name>');
  }

  if (command === 'calibrate') {
    const project = loadProject(paths.repoRoot, need(values.project, 'Usage: qa calibrate --project <name>'));
    const loaded = loadApiTests(project, schemas);
    if (loaded.problems.length) {
      console.error(`Automation gate failed:\n  ${loaded.problems.join('\n  ')}`);
      return FAILED;
    }
    const sink = evidenceSink(paths, values.out);
    const record = await calibrate({ repoRoot: paths.repoRoot, project, envName: values.env ?? 'dev', tests: loaded.tests, schemas, sink, runId: sink.runId });
    console.log(JSON.stringify(record));
    return record.ok ? 0 : FAILED;
  }

  if (command === 'stage') {
    // Copies chosen files into a folder of the current run. An agent whose
    // working directory is that folder sees exactly these files and nothing else.
    const runId = need(process.env.QA_RUN_ID, 'qa stage only runs inside a workflow run');
    const name = need(values.to, 'Usage: qa stage --to <folder> <path>... (run:<path> for files of this run)');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid stage folder "${name}"`);
    const runDir = join(paths.evidence, runId);
    const target = join(runDir, 'staged', name);
    if (existsSync(target)) throw new Error(`Stage folder "${name}" already exists in this run`);
    for (const source of need(rest.length ? rest : null, 'Name at least one path to stage')) {
      const abs = source.startsWith('run:') ? resolve(runDir, source.slice(4)) : insideRepo(paths.repoRoot, source);
      if (source.startsWith('run:') && !abs.startsWith(runDir + sep)) throw new Error(`Run path escapes the run folder: ${source}`);
      if (!existsSync(abs)) throw new Error(`Nothing to stage at ${source}`);
      const dest = join(target, source.startsWith('run:') ? source.slice(4) : relative(paths.repoRoot, abs));
      if (existsSync(dest)) throw new Error(`Already staged: ${source}`);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(abs, dest, { recursive: statSync(abs).isDirectory(), errorOnExist: true, force: false });
    }
    // Agents cannot rely on file search tools on every platform, so the folder
    // carries its own index of exactly what was staged.
    const listing = [];
    const walk = (dir, prefix = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else listing.push(rel);
      }
    };
    walk(target);
    writeFileSync(join(target, 'INDEX.txt'), `Files staged for this step:\n${listing.map((f) => `- ${f}`).join('\n')}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ staged: target, files: listing.length }));
    return 0;
  }

  if (command === 'promote') {
    // Writes an approved agent output into the project. Runs only after a QA Lead
    // gate, so agents never write to the repository themselves.
    const runId = need(process.env.QA_RUN_ID, 'qa promote only runs inside a workflow run');
    const stepId = need(values.step, 'Usage: qa promote --step <id> --to <path> [--field <name>] [--format yaml|json|text] [--merge-edge <step>]');
    const dest = insideRepo(paths.repoRoot, need(values.to, 'Name the destination with --to'));
    if (!relative(paths.repoRoot, dest).startsWith(`projects${sep}`)) throw new Error('Promotion writes only inside projects/');
    const store = openStore(paths.db);
    try {
      const decisions = store.getSteps(runId).map((s) => store.getDecision(runId, s.step_id)).filter(Boolean);
      if (!decisions.some((d) => d.decision === 'approve')) throw new Error('Nothing is promoted before a QA Lead approval in this run');
      const read = (id) => {
        const step = store.getStep(runId, id);
        if (step?.status !== 'completed') throw new Error(`Step ${id} has no completed output`);
        return step.output.value;
      };
      let value = read(stepId);
      let questions = [];
      if (values['merge-edge']) ({ doc: value, questions } = mergeEdgeCases(value, read(values['merge-edge'])));
      if (values.field) value = value[values.field];
      const format = values.format ?? (dest.endsWith('.json') ? 'json' : dest.endsWith('.yaml') ? 'yaml' : 'text');
      const text = format === 'json' ? `${JSON.stringify(value, null, 2)}\n` : format === 'yaml' ? YAML.stringify(value) : String(value);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text.endsWith('\n') ? text : `${text}\n`);
      console.log(JSON.stringify({ promoted: relative(paths.repoRoot, dest), open_questions: questions }));
      return 0;
    } finally {
      store.close();
    }
  }

  return null;
}

export { USAGE };
