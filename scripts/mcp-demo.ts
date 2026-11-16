import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function printResult(result: CallToolResult): void {
  for (const content of result.content) {
    if (content.type === "text") console.log(content.text);
  }
  if (result.isError) throw new Error("MCP-инструмент вернул ошибку.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !args[0].trim())) {
    throw new Error('Передайте один непустой поисковый запрос в кавычках.');
  }
  const query = args[0]?.trim() ?? "кнопка сохранения";
  const client = new Client({ name: "ui-library-demo", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(__dirname, "../src/mcp/cli.js")],
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    console.log(`MCP-инструменты: ${tools.tools.map(tool => tool.name).join(", ")}`);
    const search = CallToolResultSchema.parse(await client.callTool({
      name: "searchComponents", arguments: { query },
    }));
    printResult(search);
    const { components } = z.object({
      components: z.array(z.object({ name: z.string() })),
    }).parse(search.structuredContent);
    if (components[0]) {
      const docs = await client.callTool({
        name: "getComponentDocs", arguments: { name: components[0].name },
      });
      printResult(CallToolResultSchema.parse(docs));
    } else {
      console.log("Совпадений в локальном индексе нет.");
    }
  } finally {
    await client.close();
    await transport.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Ошибка MCP-клиента.");
  process.exitCode = 1;
});
