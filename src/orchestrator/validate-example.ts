import { dirname, resolve } from "node:path";
import * as ts from "typescript";
import type { ComponentMetadata } from "../components/schema";
import type { CheckIssue, ExampleValidation } from "./types";

export function validateExample(
  examplePath: string, tsconfigPath: string, component: ComponentMetadata,
): ExampleValidation {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const source = program.getSourceFile(resolve(examplePath));
  if (!source) throw new Error(`Пример не включён в программу TypeScript: ${examplePath}`);

  const issues: CheckIssue[] = [];
  const report = (node: ts.Node, code: string, message: string, severity: "error" | "warning" = "error", prop?: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    issues.push({ check: "props", severity, code, message, file: examplePath,
      line: line + 1, column: character + 1, ...(prop ? { prop } : {}) });
  };
  const props = new Map(component.props.map(prop => [prop.name, prop]));
  let usages = 0;
  function visit(node: ts.Node, parent?: ts.Node): void {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(source) === component.import.name) {
      usages++;
      const used = new Set<string>();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          report(attribute, "UNSUPPORTED_SPREAD", "Передайте props явно: проверка по индексу не раскрывает JSX spread.");
          continue;
        }
        const name = attribute.name.getText(source);
        used.add(name);
        const prop = props.get(name);
        if (!prop && name !== "key") report(attribute, "UNKNOWN_PROP", `Неизвестный prop ${name} у ${component.name}.`);
        if (prop?.deprecated) report(attribute, "DEPRECATED_PROP",
          `Prop ${name} устарел${typeof prop.deprecated === "string" ? `: ${prop.deprecated}` : "."}`, "warning", name);
      }
      if (ts.isJsxOpeningElement(node) && parent && ts.isJsxElement(parent)
        && parent.children.some(child => ts.isJsxText(child) ? !!child.text.trim()
          : !ts.isJsxExpression(child) || child.expression !== undefined)) used.add("children");
      for (const prop of props.values()) {
        if (prop.required && !used.has(prop.name)) report(node, "MISSING_REQUIRED_PROP", `Не передан обязательный prop ${prop.name}.`);
      }
    }
    ts.forEachChild(node, child => visit(child, node));
  }
  visit(source);
  if (!usages) report(source, "COMPONENT_NOT_USED", `В примере нет JSX-вызова ${component.import.name}.`);
  if (program.getSyntacticDiagnostics(source).length) {
    report(source, "INVALID_TSX", "Синтаксис примера некорректен; см. диагностику TypeScript.");
  }
  for (const diagnostic of [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]) {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    issues.push({
      check: "typescript", severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
      code: `TS${diagnostic.code}`, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ...(diagnostic.file ? { file: diagnostic.file.fileName } : {}),
      ...(position ? { line: position.line + 1, column: position.character + 1 } : {}),
    });
  }
  const status = (check: CheckIssue["check"]) =>
    issues.some(issue => issue.check === check && issue.severity === "error") ? "failed" : "passed";
  return { checks: { props: status("props"), typescript: status("typescript") }, issues };
}
