/**
 * Orchestrator/dev utility to load Codex JSON files from disk.
 * Not a protocol-level API; used by local tools and runners only.
 */
import fs from 'fs';
import path from 'path';

export async function loadCodexFile<T = any>(relativePath: string): Promise<T> {
  const fullPath = path.join(process.cwd(), relativePath);
  const fileContent = await fs.promises.readFile(fullPath, 'utf-8');
  return JSON.parse(fileContent);
}
