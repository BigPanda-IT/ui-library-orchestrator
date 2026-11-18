import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentMetadata } from "../components/schema";
import { saveExampleArtifact } from "./example-artifact";
import { prepareExample } from "./example-preparer";
import { needsChanges, reviewExample } from "./example-reviewer";
import type { ExampleReview, ExampleWorkers, WorkflowEvent, WorkflowHistory } from "./example-workflow-types";

export class ExampleWorkflowError extends Error {
  constructor(message: string, readonly historyPath: string) { super(message); }
}

export async function runExampleWorkflow(input: {
  task: string;
  component: ComponentMetadata;
  directory: string;
  record: (event: WorkflowEvent) => Promise<void>;
  workers?: ExampleWorkers;
}) {
  const { task, component, directory, record } = input;
  const preparer = input.workers?.preparer ?? prepareExample;
  const reviewer = input.workers?.reviewer ?? reviewExample;
  const historyPath = join(directory, "attempts.json");
  const history: WorkflowHistory = { maxRevisions: 2, status: "running", attempts: [] };
  const saveHistory = async () => {
    await writeFile(`${historyPath}.tmp`, JSON.stringify(history, null, 2) + "\n", "utf8");
    await rename(`${historyPath}.tmp`, historyPath);
  };
  let previous: { code: string; review: ExampleReview } | undefined;
  const seen = new Set<string>();

  const finish = async (status: WorkflowHistory["status"], reason: string) => {
    if (!previous) throw new Error("Подготовщик не вернул исходный пример.");
    // Последний проверенный вариант также доступен по прежним именам файлов.
    const final = await saveExampleArtifact(directory, previous.code);
    await writeFile(final.artifacts.validationPath, JSON.stringify(previous.review.validation, null, 2) + "\n", "utf8");
    history.status = status;
    history.reason = reason;
    await saveHistory();
    await record({ type: "workflow.stopped", message: `${status}: ${reason}` });
    return { ...final, validation: previous.review.validation,
      checks: previous.review.validation.checks, workflow: { ...history, historyPath } };
  };

  try {
    await saveHistory();
    for (let number = 1; number <= history.maxRevisions + 1; number++) {
      if (previous) await record({ type: "revision.requested", attempt: number, message: "Замечания переданы подготовщику." });
      await record({ type: "preparation.started", attempt: number, message: `Подготовка варианта ${number}.` });
      const prepared = await preparer({ task, directory, component: structuredClone(component),
        ...(previous ? { previous: structuredClone(previous) } : {}) });
      if (prepared.status === "cannot_revise") return await finish("no_fix", prepared.reason);
      if (!prepared.code.trim()) throw new Error("Подготовщик вернул пустой код.");
      const saved = await saveExampleArtifact(directory, prepared.code, number);
      const attempt = { number, artifacts: saved.artifacts, changes: [...prepared.changes], review: undefined as ExampleReview | undefined };
      history.attempts.push(attempt);
      await saveHistory();
      await record({ type: "example.saved", attempt: number, changes: attempt.changes, message: `Пример сохранён: ${saved.artifacts.examplePath}` });
      await record({ type: "validation.started", attempt: number, message: "Проверяющий получил пример и документацию." });
      const review = await reviewer({ task, component: structuredClone(component), artifacts: { ...saved.artifacts } });
      if (review.status === "approved" && needsChanges(review.validation)) {
        throw new Error("Проверяющий одобрил пример с блокирующими замечаниями.");
      }
      attempt.review = structuredClone(review);
      previous = { code: prepared.code, review: attempt.review };
      await writeFile(saved.artifacts.validationPath, JSON.stringify(review.validation, null, 2) + "\n", "utf8");
      await saveHistory();
      await record({ type: "validation.completed", attempt: number,
        message: `${review.status}: props=${review.validation.checks.props}, typescript=${review.validation.checks.typescript}.` });
      if (review.status === "approved") return await finish("approved", "Пример принят проверяющим.");

      // Пути файлов меняются при каждой попытке и не влияют на повтор ошибки.
      const signature = JSON.stringify([prepared.code, review.validation.checks,
        review.validation.issues.map(({ file: _file, ...issue }) => JSON.stringify(issue)).sort()]);
      if (seen.has(signature)) return await finish("repeated", "Повторились тот же код и те же замечания.");
      seen.add(signature);
      if (number === history.maxRevisions + 1) return await finish("limit_reached", "Исчерпаны две разрешённые доработки.");
    }
    throw new Error("Цикл завершился без результата.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    history.status = "technical_error";
    history.reason = message;
    await saveHistory();
    throw new ExampleWorkflowError(message, historyPath);
  }
}
