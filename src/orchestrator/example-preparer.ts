import * as ts from "typescript";
import { createButtonExample, supportsExample } from "./example-artifact";
import type { ExamplePreparer } from "./example-workflow-types";

export const prepareExample: ExamplePreparer = async ({ component, directory, previous }) => {
  if (!previous) return { status: "prepared", code: createButtonExample(directory), changes: ["Подготовлен сценарий сохранения Button."] };

  const cannot = (reason: string) => ({ status: "cannot_revise" as const, reason });
  const { code, review } = previous;
  const blocking = review.validation.issues.filter(issue => issue.severity === "error" || issue.code === "DEPRECATED_PROP");
  if (!supportsExample(component) || !blocking.length
    || Object.values(review.validation.checks).includes("failed")
    || blocking.some(issue => issue.code !== "DEPRECATED_PROP" || issue.prop !== "isPending")) {
    return cannot("Для полученных замечаний нет однозначного правила исправления.");
  }
  if (!component.props.some(prop => prop.name === "isPending" && prop.deprecated)
    || !component.props.some(prop => prop.name === "loading" && !prop.deprecated)) {
    return cannot("Документация не подтверждает замену isPending на доступный loading.");
  }

  const source = ts.createSourceFile("example.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const replacements: { start: number; end: number }[] = [];
  let conflict = false;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Button") {
      const attributes = node.attributes.properties;
      const old = attributes.filter(ts.isJsxAttribute).filter(attr => attr.name.getText(source) === "isPending");
      if (old.length) {
        if (old.length !== 1 || attributes.some(attr => ts.isJsxSpreadAttribute(attr)
          || ts.isJsxAttribute(attr) && attr.name.getText(source) === "loading")) conflict = true;
        else replacements.push({ start: old[0].name.getStart(source), end: old[0].name.end });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (conflict) return cannot("Замена неоднозначна: рядом с isPending уже есть loading, повторный prop или JSX spread.");
  if (!replacements.length) return cannot("В JSX не найден isPending для исправления.");
  let revised = code;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    revised = revised.slice(0, replacement.start) + "loading" + revised.slice(replacement.end);
  }
  return { status: "prepared", code: revised,
    changes: [`isPending заменён на loading (${replacements.length}); значения props сохранены.`] };
};
