import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const DIGEST_REFERENCE = /^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export function workspacePath(workspace, relativePath) {
  const root = resolve(workspace);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`path escapes workspace: ${relativePath}`);
  return target;
}
export async function assertFile(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`not a file: ${path}`);
}
export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) result[name] = true;
    else { result[name] = next; index += 1; }
  }
  return result;
}
