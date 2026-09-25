import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function loadSchemas(dir) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const ids = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const expected = file.replace(/\.json$/, '');
    if (schema.$id !== expected) throw new Error(`${file}: $id must be "${expected}"`);
    ajv.addSchema(schema);
    ids.push(schema.$id);
  }
  // Compile everything now so a broken schema fails at load, not mid-run.
  for (const id of ids) ajv.getSchema(id);

  return {
    ids,
    has: (id) => ids.includes(id),
    get(id) {
      const fn = ajv.getSchema(id);
      if (!fn) throw new Error(`Unknown schema "${id}"`);
      return fn.schema;
    },
    validate(id, data) {
      const fn = ajv.getSchema(id);
      if (!fn) throw new Error(`Unknown schema "${id}"`);
      if (fn(data)) return { ok: true, errors: [] };
      return { ok: false, errors: fn.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
    },
  };
}
