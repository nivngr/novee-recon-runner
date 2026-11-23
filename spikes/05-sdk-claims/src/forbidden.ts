// D1: a workflow that imports a Node module.
import { readFileSync } from 'node:fs';
export async function readsFile(): Promise<string> {
  return readFileSync('/etc/hosts', 'utf8');
}
