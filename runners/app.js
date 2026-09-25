import { spawn } from 'node:child_process';
import { minimalEnv } from '../engine/exec.js';

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { ok: true, body: await res.json() };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code ?? e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, detail: last };
}

// Starts the project's local app on a free port and waits until it is healthy.
// Every run gets its own process, so no two runs share state.
export async function startLocalApp(repoRoot, localApp, extraEnv = {}) {
  const [command, ...args] = localApp.command;
  const child = spawn(command, args, { cwd: repoRoot, env: minimalEnv({ PORT: '0', ...extraEnv }), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c;
  });
  const port = await new Promise((resolve) => {
    let out = '';
    const timer = setTimeout(() => resolve(null), 10000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = /listening (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    });
  if (!port) {
    await stop();
    return { ok: false, detail: `app did not start: ${stderr.trim() || 'no port reported'}`, stop };
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(`${baseUrl}${localApp.health}`, 10000);
  if (!health.ok) {
    await stop();
    return { ok: false, detail: `health check failed: ${health.detail}`, stop };
  }
  return { ok: true, baseUrl, build: health.body?.build, stop };
}

export async function probeHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'up' : 'degraded';
  } catch {
    return 'down';
  }
}
