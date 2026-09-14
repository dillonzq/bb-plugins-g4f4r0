import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function localServers() {
  let output: string;
  try {
    output = (await exec(process.platform === 'darwin' ? 'lsof' : 'ss', process.platform === 'darwin' ? ['-nP', '-iTCP', '-sTCP:LISTEN'] : ['-H', '-ltnp'], { timeout: 3000, maxBuffer: 256 * 1024 })).stdout;
  } catch { return { servers: [], error: 'Local server discovery is unavailable on this machine.' }; }
  const ports = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = process.platform === 'darwin' ? line.match(/:(\d+)\s+\(LISTEN\)/) : line.trim().split(/\s+/)[3]?.match(/:(\d+)$/);
    if (!match) continue;
    const name = process.platform === 'darwin' ? line.trim().split(/\s+/)[0] : line.match(/users:\(\("([^"]+)"/)?.[1] || 'Web server';
    if (/chrome|chromium|ssh/i.test(name)) continue;
    ports.set(Number(match[1]), name);
  }
  const servers: Array<{ port: number; name: string; url: string }> = [];
  const candidates = [...ports].slice(0, 64);
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(candidates.slice(i, i + 8).map(async ([port, name]) => {
      const url = `http://localhost:${port}`;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(600) });
        if ((response.headers.get('content-type') || '').includes('text/html') || [301, 302, 303, 307, 308].includes(response.status)) servers.push({ port, name, url });
      } catch { /* A TCP listener is not necessarily a web app. */ }
    }));
  }
  return { servers: servers.sort((a,b) => a.port-b.port), error: null };
}
