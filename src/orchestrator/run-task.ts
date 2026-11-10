import { randomUUID } from "node:crypto";
import { mockExecutor } from "./mock-executor";
import { createRunStorage } from "./storage";
import type { Executor, Run, RunEvent, TaskResult } from "./types";

export async function runTask(
  task: string,
  options: { runsDirectory: string; executor?: Executor },
): Promise<{ run: Run; statePath: string; eventsPath: string }> {
  const normalizedTask = task.trim();
  if (!normalizedTask) throw new Error("Задача не должна быть пустой.");

  const timestamp = new Date().toISOString();
  let run: Run = {
    runId: randomUUID(), task: normalizedTask, status: "queued",
    createdAt: timestamp, updatedAt: timestamp,
  };
  const storage = await createRunStorage(options.runsDirectory, run.runId);
  const record = async (type: RunEvent["type"], message: string) => {
    await storage.append({ runId: run.runId, timestamp: new Date().toISOString(), type, message });
  };

  await storage.save(run);
  await record("run.created", "Задача принята.");
  run = { ...run, status: "running", updatedAt: new Date().toISOString() };
  await storage.save(run);
  await record("run.started", "Запуск начат.");
  await record("executor.started", "Исполнитель запущен.");

  let result: TaskResult;
  try {
    result = await (options.executor ?? mockExecutor)(run.task);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run = { ...run, status: "failed", error: message, updatedAt: new Date().toISOString() };
    await storage.save(run);
    await record("executor.failed", message);
    await record("run.failed", "Запуск завершён с ошибкой исполнителя.");
    return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
  }

  await record("executor.completed", "Результат исполнителя получен.");
  run = { ...run, status: "completed", result, updatedAt: new Date().toISOString() };
  await storage.save(run);
  await record("run.completed", "Запуск завершён.");
  return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
}
