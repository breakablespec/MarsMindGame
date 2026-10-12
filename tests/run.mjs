// Runs every headless test: bundle each with esbuild and execute in Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'marsmind-'));
let failed = 0;
for (const t of ['sim', 'ai', 'late', 'soak']) {
  const out = join(dir, `${t}.cjs`);
  await build({ entryPoints: [`tests/${t}.test.ts`], bundle: true, platform: 'node', outfile: out, logLevel: 'error' });
  const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
