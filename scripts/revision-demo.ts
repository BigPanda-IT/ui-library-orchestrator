import { resolve } from "node:path";
import { prepareExample } from "../src/orchestrator/example-preparer";
import { runTask } from "../src/orchestrator/run-task";

async function main(): Promise<void> {
  console.log("Демонстрация: в первый вариант намеренно добавлен устаревший isPending.");
  const { run, statePath, eventsPath } = await runTask("Button", {
    runsDirectory: resolve(__dirname, "../../runs"),
    workers: { preparer: async input => {
      const prepared = await prepareExample(input);
      if (!input.previous && prepared.status === "prepared") return {
        ...prepared, code: prepared.code.replace("loading={isSaving}", "isPending={isSaving}"),
        changes: ["Демонстрационный вариант с устаревшим isPending."],
      };
      return prepared;
    } },
  });
  console.log(`Статус: ${run.status}\nСостояние: ${statePath}\nЖурнал: ${eventsPath}`);
  if (run.status === "failed") throw new Error(run.error);
  if (run.status === "completed" || run.status === "validation_failed") {
    for (const attempt of run.result.workflow?.attempts ?? []) {
      console.log(`Вариант ${attempt.number}: ${attempt.review?.status}\n${attempt.changes.join("\n")}\n${attempt.artifacts.examplePath}`);
    }
    console.log(`Причина завершения: ${run.result.workflow?.reason}\nИстория: ${run.result.workflow?.historyPath}`);
    if (run.status !== "completed") process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
