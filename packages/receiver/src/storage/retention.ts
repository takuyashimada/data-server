import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export async function cleanupRetention(dataDir: string, retentionDays: number, now = new Date()): Promise<number> {
  const root = path.join(dataDir, "devices");
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffPart = cutoff.toISOString().slice(0, 10);
  let removed = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name)) {
        const datePart = entry.name.slice(0, 10);
        if (datePart < cutoffPart) {
          await rm(fullPath);
          removed += 1;
        }
      }
    }
  }

  await walk(root);
  return removed;
}
