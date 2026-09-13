import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const permanentRoot = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const { plugins } = JSON.parse(execFileSync('bb', ['plugin', 'list', '--json'], { encoding: 'utf8' }));
const expected = ['browse', 'beacon', 'sidetree', 'silk'];
const problems = [];
for (const id of expected) if (!plugins.some(p => p.id === id)) problems.push(`${id}: registration missing`);
for (const plugin of plugins.filter(p => p.source?.startsWith('path:'))) {
  let real;
  try { real = fs.realpathSync(plugin.rootDir); }
  catch { problems.push(`${plugin.id}: source directory missing`); continue; }
  const relative = path.relative(permanentRoot, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    problems.push(`${plugin.id}: source is outside the permanent plugin directory: ${real}`);
  }
  if (!fs.existsSync(path.join(real, 'package.json'))) problems.push(`${plugin.id}: package manifest missing`);
  if (plugin.enabled && plugin.status !== 'running') problems.push(`${plugin.id}: ${plugin.status}`);
  console.log(`${plugin.id}: ${plugin.status} — ${real}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log('All registered local plugins have permanent source paths; enabled plugins are running.');
