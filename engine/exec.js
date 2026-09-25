import { spawn } from 'node:child_process';

const BASE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL'];

// Children never inherit the full environment. They get the basics plus the
// names a step explicitly declares, so a secret reaches a process only when a
// workflow author asked for it by name.
export function minimalEnv(extra = {}, names = [], source = process.env) {
  const env = {};
  for (const key of [...BASE_ENV_KEYS, ...names]) if (source[key] !== undefined) env[key] = source[key];
  return { ...env, ...extra };
}

export function spawnCapture(command, args, { cwd, env, timeoutMs, maxBytes = 50 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const collect = (bucket) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        truncated = true;
        return;
      }
      bucket.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    // Timers use a clock that stops while the machine sleeps, so a deadline on
    // the wall clock is checked as well; otherwise a sleep can hang a run.
    const deadline = timeoutMs ? Date.now() + timeoutMs : null;
    const expire = () => {
      if (timedOut) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    const timer = timeoutMs ? setTimeout(expire, timeoutMs) : null;
    const watch = timeoutMs
      ? setInterval(() => {
          if (Date.now() > deadline) expire();
        }, Math.min(10000, timeoutMs))
      : null;
    const finish = (code, spawnError) => {
      if (timer) clearTimeout(timer);
      if (watch) clearInterval(watch);
      resolvePromise({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8') + (spawnError ? `\n${spawnError.message}` : ''),
        timedOut,
        truncated,
        durationMs: Date.now() - started,
        spawnError: spawnError?.message,
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
  });
}
