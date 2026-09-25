import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { redact } from './redact.js';

const MANIFEST = 'MANIFEST.json';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

export function createEvidence(evidenceRoot) {
  const runDir = (runId) => join(evidenceRoot, runId);
  const isSealed = (runId) => existsSync(join(runDir(runId), MANIFEST));

  function target(runId, rel) {
    const base = runDir(runId);
    const file = resolve(base, rel);
    if (!file.startsWith(base + sep)) throw new Error(`Evidence path escapes the run folder: ${rel}`);
    return file;
  }

  return {
    runDir,
    isSealed,

    init(runId) {
      mkdirSync(evidenceRoot, { recursive: true });
      mkdirSync(runDir(runId));
    },

    // Append-only: a file is written once, redacted, and never overwritten.
    write(runId, rel, content) {
      if (isSealed(runId)) throw new Error(`Evidence for ${runId} is sealed`);
      const file = target(runId, rel);
      mkdirSync(dirname(file), { recursive: true });
      const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
      writeFileSync(file, redact(text), { flag: 'wx' });
      return file;
    },

    seal(runId) {
      if (isSealed(runId)) return JSON.parse(readFileSync(join(runDir(runId), MANIFEST), 'utf8'));
      const base = runDir(runId);
      const files = walk(base)
        .map((file) => ({
          path: relative(base, file).split(sep).join('/'),
          sha256: sha256(readFileSync(file)),
          bytes: statSync(file).size,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const manifest = { run_id: runId, sealed_at: new Date().toISOString(), files };
      writeFileSync(join(base, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      for (const file of walk(base)) chmodSync(file, 0o444);
      return manifest;
    },

    verify(runId) {
      const base = runDir(runId);
      if (!isSealed(runId)) return { ok: false, problems: ['not sealed'] };
      const manifest = JSON.parse(readFileSync(join(base, MANIFEST), 'utf8'));
      const problems = [];
      const listed = new Set(manifest.files.map((f) => f.path));
      for (const f of manifest.files) {
        const file = join(base, f.path);
        if (!existsSync(file)) problems.push(`missing: ${f.path}`);
        else if (sha256(readFileSync(file)) !== f.sha256) problems.push(`changed: ${f.path}`);
      }
      for (const file of walk(base)) {
        const rel = relative(base, file).split(sep).join('/');
        if (rel !== MANIFEST && !listed.has(rel)) problems.push(`added after sealing: ${rel}`);
      }
      return { ok: problems.length === 0, problems, files: manifest.files.length };
    },
  };
}
