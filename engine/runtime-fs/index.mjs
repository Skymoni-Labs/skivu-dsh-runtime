// SPDX-License-Identifier: GPL-3.0-only
// Preserve link(source,target)'s source and exclusive publication on Android,
// which denies hard links in app-private storage. Never use overwriting rename.
import { constants } from 'node:fs';
import { copyFile, open, rm, stat, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function publishExclusive(source, target) {
  const staged = join(dirname(target), `.skivu-publish-${randomUUID()}`);
  try {
    await copyFile(source, staged, constants.COPYFILE_EXCL);
    await chmod(staged, (await stat(source)).mode & 0o777);
    const handle = await open(staged, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    try {
      await run('/opt/skivu/rename-excl', [staged, target], { timeout: 10000, maxBuffer: 1024 });
    } catch (error) {
      if (error?.code === 17 && !error.signal && !error.killed) error.code = 'EEXIST';
      throw error;
    }
  } finally { await rm(staged, { force: true }); }
}
