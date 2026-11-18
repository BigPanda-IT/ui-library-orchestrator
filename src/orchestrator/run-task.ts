import { randomUUID } from "node:crypto";
import { supportsExample } from "./example-artifact";
import { ExampleWorkflowError, runExampleWorkflow } from "./example-workflow";
import type { ExampleWorkers } from "./example-workflow-types";
import { createMcpExecutor } from "./mcp-executor";
import { createRunStorage } from "./storage";
import type { Executor, Run, RunEvent, TaskResult, TaskRoute } from "./types";

export async function runTask(
  task: string,
  options: { runsDirectory: string; executor?: Executor; workers?: ExampleWorkers; route?: TaskRoute },
): Promise<{ run: Run; statePath: string; eventsPath: string }> {
  const normalizedTask = task.trim();
  if (!normalizedTask) throw new Error("Задача не должна быть пустой.");
  const route = options.route ?? "example";
  if (route !== "docs" && route !== "example") throw new Error("Неизвестный маршрут: используйте docs или example.");

  const timestamp = new Date().toISOString();
  let run: Run = {
    runId: randomUUID(), task: normalizedTask, route, status: "queued",
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
  await record("route.selected", `Выбран маршрут ${route}.`);
  await record("executor.started", "Исполнитель запущен.");

  let result: TaskResult;
  try {
    result = await (options.executor ?? createMcpExecutor())(run.task, {
      record: event => storage.append({
        ...event, runId: run.runId, timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run = { ...run, status: "failed", error: message, updatedAt: new Date().toISOString() };
    await storage.save(run);
    await record("executor.failed", message);
    await record("run.failed", "Запуск завершён с ошибкой исполнителя.");
    return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
  }

  await record("executor.completed", "Результат исполнителя получен.");
  if (route === "docs" && result.mode === "mcp" && result.outcome === "found") {
    result = { ...result, example: "" };
  } else if (route === "example" && result.mode === "mcp" && result.outcome === "found" && supportsExample(result.component)) {
    try {
      const prepared = await runExampleWorkflow({ task: run.task, component: result.component,
        directory: storage.directory, workers: options.workers,
        record: event => storage.append({ ...event, runId: run.runId, timestamp: new Date().toISOString() }),
      });
      result = {
        ...result, ...prepared,
        warnings: [...result.warnings,
          "Подготовлен фиксированный сценарий сохранения для Button; он не адаптируется к смыслу запроса.",
          "onSave передаётся приложением. Проверены локальные типы, выполнение и отображение не проверялись."],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run = { ...run, status: "failed", error: message, updatedAt: new Date().toISOString(),
        ...(error instanceof ExampleWorkflowError ? { historyPath: error.historyPath } : {}) };
      await storage.save(run);
      await record("validation.failed", message);
      await record("run.failed", "Не удалось подготовить или проверить пример.");
      return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
    }
  } else if (route === "example" && result.mode === "mcp" && result.outcome === "found") {
    result.warnings.push("Для этого компонента нет локального шаблона; примеры документации не проверялись.");
  }
  if (result.workflow && result.workflow.status !== "approved"
    || result.checks.props === "failed" || result.checks.typescript === "failed") {
    run = { ...run, status: "validation_failed", result, updatedAt: new Date().toISOString() };
    await storage.save(run);
    await record("run.validation_failed", result.workflow?.reason ?? "Пример сохранён, но содержит ошибки проверки.");
    return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
  }
  run = { ...run, status: "completed", result, updatedAt: new Date().toISOString() };
  await storage.save(run);
  await record("run.completed", "Запуск завершён.");
  return { run, statePath: storage.statePath, eventsPath: storage.eventsPath };
}
