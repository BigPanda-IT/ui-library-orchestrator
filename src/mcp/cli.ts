import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createComponentServer } from "./server";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.error("Использование: node dist/src/mcp/cli.js [--index <путь к component-index.json>]");
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--index" && args[1].trim())) {
    throw new Error("Допустим только аргумент --index <путь к component-index.json>.");
  }
  // Привязка к расположению сборки, а не к рабочей папке MCP-клиента.
  const indexPath = args.length === 2
    ? resolve(args[1])
    : resolve(__dirname, "../../../component-index.json");
  const server = createComponentServer(indexPath);
  await server.connect(new StdioServerTransport());
  // stdout зарезервирован для JSON-RPC. Диагностика — только stderr.
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Не удалось запустить MCP-сервер.");
  process.exitCode = 1;
});
