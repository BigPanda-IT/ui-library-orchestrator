import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Run, RunEvent } from "./types";

export async function createRunStorage(root: string, runId: string) {
  const directory = resolve(root, runId);
  await mkdir(root, { recursive: true });
  // Уже существующий запуск не перезаписываем.
  await mkdir(directory);
  const statePath = join(directory, "run.json");
  const eventsPath = join(directory, "events.jsonl");

  return {
    directory,
    statePath,
    eventsPath,
    async save(run: Run): Promise<void> {
      const temporaryPath = join(directory, "run.json.tmp");
      await writeFile(temporaryPath, JSON.stringify(run, null, 2) + "\n", "utf8");
      await rename(temporaryPath, statePath);
    },
    async append(event: RunEvent): Promise<void> {
      await appendFile(eventsPath, JSON.stringify(event) + "\n", "utf8");
    },
  };
}
