import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const id = process.argv[2];
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw Error('Usage: node maintenance/install.mjs <plugin-id>');
const dir = fs.realpathSync(path.join(root, `bb-plugin-${id}`));
if (path.dirname(dir) !== root) throw Error('Refusing an installation outside the permanent source directory.');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
if (manifest.name !== `bb-plugin-${id}`) throw Error('Plugin ID and directory do not match.');
const run = (cmd, args, cwd = dir) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const changes = execFileSync('git', ['status', '--porcelain', '--', path.basename(dir)], { cwd: root, encoding: 'utf8' }).trim();
if (changes) throw Error('Commit the reviewed plugin changes before deployment.');
const tracked = execFileSync('git', ['ls-files', '--', `${path.basename(dir)}/package-lock.json`], { cwd: root, encoding: 'utf8' }).trim();
if (!tracked) throw Error('A committed package-lock.json is required.');
const tree = () => execFileSync('git', ['rev-parse', `HEAD:${path.basename(dir)}`], { cwd: root, encoding: 'utf8' }).trim();
const reviewedTree = tree();
const inventory = JSON.parse(execFileSync('bb', ['plugin', 'list', '--json'], { encoding: 'utf8' })).plugins;
const current = inventory.find(p => p.id === id);
if (current && !current.source.startsWith('path:')) throw Error('This helper only handles local path plugins.');
function ensureBrowseIdle() {
  if (id !== 'browse' || current?.status !== 'running') return;
  const sessions = JSON.parse(execFileSync('bb', ['browse', 'list', '{}'], { encoding: 'utf8' }));
  if (sessions.some(s => !['released', 'error'].includes(s.status))) throw Error('Browse has active sessions. Finish them before deploying.');
}
ensureBrowseIdle();
const check = manifest.scripts?.typecheck ? 'typecheck' : manifest.scripts?.check ? 'check' : null;
if (check) run('npm', ['run', check]);
if (manifest.scripts?.test) run('npm', ['test']);
run('bb', ['plugin', 'build', dir]);
// Check the reviewed revision again in case another thread edited it during verification.
if (tree() !== reviewedTree || execFileSync('git', ['status', '--porcelain', '--', path.basename(dir)], { cwd: root, encoding: 'utf8' }).trim()) {
  throw Error('Source changed during verification; review and commit it before deploying.');
}
const backup = path.join(os.homedir(), '.bb', 'plugin-backups');
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
run('git', ['bundle', 'create', path.join(backup, `${id}-${stamp}.bundle`), '--all'], root);
ensureBrowseIdle();
run('bb', current?.rootDir === dir ? ['plugin', 'reload', id] : ['plugin', 'install', `path:${dir}`, '--yes']);
run(process.execPath, [path.join(root, 'maintenance/check-installations.mjs')], root);
