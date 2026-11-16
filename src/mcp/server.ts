import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ComponentCatalog, ComponentIndexError, searchTerms } from "../components/catalog";
import { componentMetadataSchema } from "../components/schema";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

async function toolResult(action: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const output = await action();
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: error instanceof ComponentIndexError ? error.message : "Внутренняя ошибка чтения каталога.",
      }],
    };
  }
}

export function createComponentServer(indexPath: string): McpServer {
  const catalog = new ComponentCatalog(indexPath);
  const server = new McpServer({ name: "ui-library-components", version: "1.0.0" });

  server.registerTool("searchComponents", {
    title: "Поиск компонентов",
    description: "Поиск по имени, описанию, ключевым словам, назначению и именам props локальной UI-библиотеки. Все слова запроса должны встретиться в данных. Используйте короткие запросы: Button, кнопка сохранения, loading. Пустой список означает отсутствие совпадений в индексе.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(500)
        .refine(value => searchTerms(value).length > 0, "Запрос должен содержать буквы или цифры"),
    }).strict(),
    outputSchema: z.object({
      query: z.string(),
      total: z.number().int().nonnegative(),
      components: z.array(componentMetadataSchema.pick({
        id: true, name: true, description: true, package: true, source: true,
      })),
    }),
    annotations,
  }, ({ query }) => toolResult(() => catalog.search(query)));

  server.registerTool("getComponentDocs", {
    title: "Документация компонента",
    description: "Возвращает полный публичный API компонента: props, типы, значения по умолчанию, deprecated, правила, ограничения, примеры и пути источников. Поиск по точному имени без учёта регистра. Не генерирует и не компилирует примеры. Неизвестный компонент возвращается как found=false.",
    inputSchema: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    outputSchema: z.object({
      found: z.boolean(),
      name: z.string(),
      component: componentMetadataSchema.nullable(),
      message: z.string(),
      checks: z.object({ props: z.literal("not_run"), typescript: z.literal("not_run") }),
    }),
    annotations,
  }, ({ name }) => toolResult(() => catalog.getDocs(name)));

  return server;
}
