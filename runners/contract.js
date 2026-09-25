import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

function rewriteRefs(node) {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `openapi${v}` : rewriteRefs(v);
  }
  return out;
}

// Validates live responses against the project's OpenAPI document: documented
// status codes, response bodies and empty bodies where none is documented.
export function loadContract(file) {
  const doc = YAML.parse(readFileSync(file, 'utf8'));
  // OpenAPI 3.0 schemas carry keywords such as "nullable" that JSON Schema does
  // not define, so this validator is not strict about unknown keywords.
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'openapi', components: doc.components ?? {} });

  const operations = [];
  for (const [template, ops] of Object.entries(doc.paths ?? {})) {
    const regex = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^/}]+\}/g, '[^/]+')}$`);
    for (const [method, op] of Object.entries(ops)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) operations.push({ method: method.toUpperCase(), template, regex, op });
    }
  }
  const compiled = new Map();

  return {
    check(method, path, status, contentType, body) {
      const op = operations.find((o) => o.method === method && o.regex.test(path));
      if (!op) return { ok: false, errors: [`${method} ${path} is not in the contract`] };
      const response = op.op.responses?.[String(status)];
      if (!response) return { ok: false, errors: [`status ${status} is not documented for ${method} ${op.template}`] };
      const media = response.content?.['application/json'];
      if (!media) {
        return body === undefined || body === '' ? { ok: true, errors: [] } : { ok: false, errors: [`${method} ${op.template} ${status} documents no body but one was returned`] };
      }
      if (!/application\/json/.test(contentType ?? '')) return { ok: false, errors: [`expected JSON, got content type "${contentType ?? 'none'}"`] };
      const key = `${method} ${op.template} ${status}`;
      if (!compiled.has(key)) compiled.set(key, ajv.compile(rewriteRefs(media.schema ?? {})));
      const validate = compiled.get(key);
      return validate(body) ? { ok: true, errors: [] } : { ok: false, errors: validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
    },
  };
}
