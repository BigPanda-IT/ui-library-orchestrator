import type { ComponentMetadata } from "../components/schema";
import type { WorkflowHistory, WorkflowEvent } from "./example-workflow-types";

export interface CheckIssue {
  check: "props" | "typescript";
  severity: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  prop?: string;
}

export interface ExampleValidation {
  checks: { props: "passed" | "failed"; typescript: "passed" | "failed" };
  issues: CheckIssue[];
}

interface ResultBase {
  answer: string;
  example: string;
  warnings: string[];
  checks: {
    props: "not_run" | "passed" | "failed";
    typescript: "not_run" | "passed" | "failed";
  };
  validation?: ExampleValidation;
  artifacts?: { examplePath: string; tsconfigPath: string; validationPath: string };
  workflow?: WorkflowHistory & { historyPath: string };
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
  | { status: "completed" | "validation_failed"; result: TaskResult }
  | { status: "failed"; error: string; historyPath?: string }
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
    | "example.saved" | "validation.started" | "validation.completed" | "validation.failed"
    | "run.validation_failed"
    | WorkflowEvent["type"]
    | ExecutorEvent["type"];
  message: string;
  tool?: ExecutorEvent["tool"];
  arguments?: Record<string, string>;
  outcome?: ExecutorEvent["outcome"];
  attempt?: number;
  changes?: string[];
}

export interface ExecutorContext {
  record: (event: ExecutorEvent) => Promise<void>;
}

export type Executor = (task: string, context: ExecutorContext) => Promise<TaskResult>;
