const SECRET_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL)/i;

const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
];

// Runs before anything is written to disk. A logged-in screenshot or a token in
// a log line is a credential leak with a timestamp.
export function redact(text, env = process.env) {
  let out = String(text);
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_KEY.test(key)) out = out.split(value).join(`[REDACTED:${key}]`);
  }
  for (const pattern of PATTERNS) out = out.replace(pattern, '[REDACTED]');
  out = out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
  out = out.replace(/(\b(?:password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, '$1[REDACTED]');
  return out;
}
