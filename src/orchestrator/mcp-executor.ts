import { ComponentMcpClient, type ComponentClientOptions } from "../mcp/client";
import type { ComponentMetadata } from "../components/schema";
import type { Executor, ExecutorContext, ExecutorEvent, TaskResult } from "./types";

async function loggedCall<T>(
  context: ExecutorContext,
  tool: NonNullable<ExecutorEvent["tool"]>,
  args: Record<string, string>,
  action: () => Promise<T>,
  found: (result: T) => boolean,
): Promise<T> {
  await context.record({ type: "tool.started", tool, arguments: args, message: `Вызов ${tool}.` });
  let result: T;
  try {
    result = await action();
  } catch (error) {
    await context.record({
      type: "tool.failed", tool,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const outcome = found(result) ? "found" : "not_found";
  await context.record({ type: "tool.completed", tool, outcome, message: `${tool}: ${outcome}.` });
  return result;
}

function fromDocumentation(component: ComponentMetadata): TaskResult {
  const props = component.props.map(prop =>
    `- ${prop.name}${prop.required ? " (обязательный)" : ""}: ${prop.type}`
    + (prop.defaultValue !== undefined ? `; по умолчанию ${JSON.stringify(prop.defaultValue)}` : "")
    + (prop.description ? ` — ${prop.description}` : ""),
  );
  const sources = [...new Set([
    component.source.exportEntry, component.source.implementation,
    ...component.source.propDeclarations, component.source.curatedDocs,
  ])];
  return {
    mode: "mcp", outcome: "found", component,
    answer: [
      `Найден ${component.name} в ${component.package.name}@${component.package.version}.`,
      component.description ?? "", component.compactSignature,
      `Импорт: import { ${component.import.name} } from ${JSON.stringify(component.import.from)};`,
      "Props:", ...props,
      "Когда использовать:", ...component.usage.whenToUse,
      "Когда не использовать:", ...component.usage.whenNotToUse,
      `Источники: ${sources.join(", ")}.`,
    ].filter(Boolean).join("\n"),
    example: component.examples.map(item => [
      item.title, item.description, item.code,
    ].filter(Boolean).join("\n")).join("\n\n"),
    warnings: [
      ...component.usage.constraints,
      ...component.props.filter(prop => prop.deprecated).map(prop =>
        `${prop.name} устарел${typeof prop.deprecated === "string" ? `: ${prop.deprecated}` : "."}`),
    ],
    checks: { props: "not_run", typescript: "not_run" },
  };
}

function notFound(answer: string): TaskResult {
  return {
    mode: "mcp", outcome: "not_found", component: null, answer, example: "",
    warnings: ["Поиск текстовый: используйте короткий запрос или имя компонента."],
    checks: { props: "not_run", typescript: "not_run" },
  };
}

export function createMcpExecutor(options: ComponentClientOptions = {}): Executor {
  return async (task, context) => {
    const client = new ComponentMcpClient(options);
    try {
      await client.connect();
      await context.record({ type: "mcp.connected", message: "MCP подключён; оба инструмента доступны." });
      const search = await loggedCall(context, "searchComponents", { query: task },
        () => client.searchComponents(task), result => result.total > 0);
      const selected = search.components[0];
      if (!selected) return notFound(`По запросу «${task}» совпадений в текущем индексе учебной библиотеки нет.`);

      const docs = await loggedCall(context, "getComponentDocs", { name: selected.name },
        () => client.getComponentDocs(selected.name), result => result.found);
      if (!docs.component) return notFound(docs.message);
      if (docs.component.id !== selected.id || docs.component.package.version !== selected.package.version
        || docs.component.package.name !== selected.package.name) {
        throw new Error("Данные компонента изменились между поиском и чтением документации. Повторите запуск.");
      }
      return fromDocumentation(docs.component);
    } finally {
      await client.close();
    }
  };
}
