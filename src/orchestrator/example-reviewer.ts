import { validateExample } from "./validate-example";
import type { ExampleReviewer } from "./example-workflow-types";
import type { ExampleValidation } from "./types";

// Устаревшие props допустимы для TS, но требуют доработки по политике примера.
export function needsChanges(validation: ExampleValidation): boolean {
  return Object.values(validation.checks).includes("failed")
    || validation.issues.some(issue => issue.severity === "error" || issue.code === "DEPRECATED_PROP");
}

export const reviewExample: ExampleReviewer = async ({ component, artifacts }) => {
  const validation = validateExample(artifacts.examplePath, artifacts.tsconfigPath, component);
  return { status: needsChanges(validation) ? "needs_changes" : "approved", validation };
};
