export interface TaskResult {
  mode: "mock";
  answer: string;
  example: string;
  warnings: string[];
  checks: {
    props: "not_run";
    typescript: "not_run";
  };
}

interface RunBase {
  runId: string;
  task: string;
  createdAt: string;
  updatedAt: string;
}

// Завершённый запуск обязательно содержит результат, ошибочный — причину.
export type Run = RunBase & (
  | { status: "queued" | "running" }
  | { status: "completed"; result: TaskResult }
  | { status: "failed"; error: string }
);

export interface RunEvent {
  runId: string;
  timestamp: string;
  type: "run.created" | "run.started" | "executor.started"
    | "executor.completed" | "executor.failed" | "run.completed" | "run.failed";
  message: string;
}

export type Executor = (task: string) => Promise<TaskResult>;
