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

  const raw = new Map(ids.map((id) => [id, ajv.getSchema(id).schema]));

  // Inlines references to other contract schemas under $defs, so the schema can
  // be handed to a model as one self-contained document. Our own validator
  // still checks the full schema afterwards.
  function bundle(id) {
    const defs = {};
    const keyFor = (schemaId) => schemaId.replace(/\./g, '_');
    const rewrite = (node, base) => {
      if (Array.isArray(node)) return node.map((n) => rewrite(n, base));
      if (!node || typeof node !== 'object') return node;
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') {
          const [target, pointer = ''] = v.split('#');
          if (target && target !== id) {
            include(target);
            out.$ref = `#/$defs/${keyFor(target)}${pointer}`;
          } else if (base) {
            out.$ref = `#/$defs/${keyFor(base)}${pointer}`;
          } else {
            out.$ref = v;
          }
        } else {
          out[k] = rewrite(v, base);
        }
      }
      return out;
    };
    const include = (target) => {
      const key = keyFor(target);
      if (defs[key]) return;
      if (!raw.has(target)) throw new Error(`Unknown schema reference "${target}"`);
      defs[key] = true;
      const { $id, $schema, ...rest } = raw.get(target);
      defs[key] = rewrite(rest, target);
    };
    const { $id, $schema, ...root } = raw.get(id);
    const bundled = rewrite(root, null);
    if (Object.keys(defs).length) bundled.$defs = { ...(bundled.$defs ?? {}), ...defs };
    return bundled;
  }

  return {
    ids,
    bundle,
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
