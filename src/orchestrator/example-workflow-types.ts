import type { ComponentMetadata } from "../components/schema";
import type { ExampleValidation } from "./types";

export interface ExampleArtifacts {
  examplePath: string;
  tsconfigPath: string;
  validationPath: string;
}

export interface ExampleReview {
  status: "approved" | "needs_changes";
  validation: ExampleValidation;
}

export interface PreparationInput {
  task: string;
  component: ComponentMetadata;
  directory: string;
  previous?: { code: string; review: ExampleReview };
}

export type PreparationResult =
  | { status: "prepared"; code: string; changes: string[] }
  | { status: "cannot_revise"; reason: string };

export type ExamplePreparer = (input: PreparationInput) => Promise<PreparationResult>;
export type ExampleReviewer = (input: {
  task: string; component: ComponentMetadata; artifacts: ExampleArtifacts;
}) => Promise<ExampleReview>;

export interface ExampleAttempt {
  number: number;
  artifacts: ExampleArtifacts;
  changes: string[];
  review?: ExampleReview;
}

export interface WorkflowHistory {
  maxRevisions: number;
  status: "running" | "approved" | "no_fix" | "repeated" | "limit_reached" | "technical_error";
  reason?: string;
  attempts: ExampleAttempt[];
}

export interface WorkflowEvent {
  type: "preparation.started" | "revision.requested" | "example.saved"
    | "validation.started" | "validation.completed" | "workflow.stopped";
  message: string;
  attempt?: number;
  changes?: string[];
}

export interface ExampleWorkers {
  preparer?: ExamplePreparer;
  reviewer?: ExampleReviewer;
}
