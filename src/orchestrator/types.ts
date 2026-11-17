import type { ComponentMetadata } from "../components/schema";

interface ResultBase {
  answer: string;
  example: string;
  warnings: string[];
  checks: {
    props: "not_run";
    typescript: "not_run";
  };
}

export type TaskResult = ResultBase & (
  | { mode: "mock" }
  | { mode: "mcp"; outcome: "found"; component: ComponentMetadata }
  | { mode: "mcp"; outcome: "not_found"; component: null }
);

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

export interface ExecutorEvent {
  type: "mcp.connected" | "tool.started" | "tool.completed" | "tool.failed";
  message: string;
  tool?: "searchComponents" | "getComponentDocs";
  arguments?: Record<string, string>;
  outcome?: "found" | "not_found";
}

export interface RunEvent {
  runId: string;
  timestamp: string;
  type: "run.created" | "run.started" | "executor.started"
    | "executor.completed" | "executor.failed" | "run.completed" | "run.failed"
    | ExecutorEvent["type"];
  message: string;
  tool?: ExecutorEvent["tool"];
  arguments?: Record<string, string>;
  outcome?: ExecutorEvent["outcome"];
}

export interface ExecutorContext {
  record: (event: ExecutorEvent) => Promise<void>;
}

export type Executor = (task: string, context: ExecutorContext) => Promise<TaskResult>;
