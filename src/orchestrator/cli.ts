import { resolve } from "node:path";
import { runTask } from "./run-task";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log('Запуск: npm run orchestrate -- "кнопка сохранения"');
    console.log('MCP без модели: короткий поисковый запрос или имя, например "Button".');
    console.log("Перед первым запуском подготовьте индекс: npm run extract.");
    return;
  }
  if (args.length !== 1 || !args[0].trim()) {
    throw new Error('Передайте одну непустую задачу в кавычках: npm run orchestrate -- "Текст задачи"');
  }

  console.log("Режим: MCP — поиск и документация из локального индекса, без модели.");
  // От compiled dist/src/orchestrator идём к корню проекта, независимо от cwd.
  const runsDirectory = resolve(__dirname, "../../../runs");
  const { run, statePath, eventsPath } = await runTask(args[0], { runsDirectory });
  console.log(`Run ID: ${run.runId}\nЗадача: ${run.task}\nСтатус: ${run.status}`);
  console.log(`Состояние: ${statePath}\nЖурнал: ${eventsPath}`);

  if (run.status === "failed") {
    console.error(`Ошибка исполнителя: ${run.error}`);
    if (run.historyPath) console.log(`История попыток: ${run.historyPath}`);
    process.exitCode = 1;
  } else if (run.status === "completed" || run.status === "validation_failed") {
    console.log(`\n${run.result.answer}\n\n${run.result.example}`);
    for (const warning of run.result.warnings) console.log(`Примечание: ${warning}`);
    console.log(`Проверки примера: props=${run.result.checks.props}, typescript=${run.result.checks.typescript}`);
    if (run.result.workflow) {
      const workflow = run.result.workflow;
      console.log(`Попыток: ${workflow.attempts.length}; итог проверки: ${workflow.status}.`);
      console.log(`Причина завершения: ${workflow.reason}\nИстория попыток: ${workflow.historyPath}`);
    }
    if (run.result.artifacts) {
      console.log(`Пример: ${run.result.artifacts.examplePath}\nДиагностика: ${run.result.artifacts.validationPath}`);
      console.log(`Повторная проверка типов: npx tsc -p "${run.result.artifacts.tsconfigPath}"`);
    }
    for (const issue of run.result.validation?.issues ?? []) {
      const location = issue.file ? `${issue.file}:${issue.line ?? 1}:${issue.column ?? 1}: ` : "";
      console.log(`${location}${issue.severity} ${issue.code}: ${issue.message}`);
    }
    if (run.status === "validation_failed") process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(`Ошибка запуска или сохранения: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
