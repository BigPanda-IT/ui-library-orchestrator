import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { docsResultSchema, searchResultSchema } from "./contracts";

export interface ComponentClientOptions {
  indexPath?: string;
}

export class ComponentMcpClient {
  private readonly client = new Client({ name: "ui-library-orchestrator", version: "1.0.0" });
  private readonly transport: StdioClientTransport;
  private readonly requestOptions = { timeout: 10_000 };

  constructor(options: ComponentClientOptions = {}) {
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(__dirname, "cli.js"),
        ...(options.indexPath ? ["--index", resolve(options.indexPath)] : [])],
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport, this.requestOptions);
    const { tools } = await this.client.listTools(undefined, this.requestOptions);
    for (const name of ["searchComponents", "getComponentDocs"]) {
      if (!tools.some(tool => tool.name === name)) {
        throw new Error(`MCP-сервер не предоставляет инструмент ${name}.`);
      }
    }
  }

  private async call<T>(name: string, args: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
    const result = CallToolResultSchema.parse(await this.client.callTool(
      { name, arguments: args }, undefined, this.requestOptions,
    ));
    if (result.isError) {
      const message = result.content.filter(item => item.type === "text")
        .map(item => item.text).join("\n");
      throw new Error(`${name}: ${message || "MCP-инструмент вернул ошибку."}`);
    }
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error(`${name}: ответ MCP не соответствует контракту.`);
    return parsed.data;
  }

  async searchComponents(query: string) {
    const result = await this.call("searchComponents", { query }, searchResultSchema);
    if (result.total !== result.components.length || result.query !== query) {
      throw new Error("searchComponents: несогласованный ответ MCP.");
    }
    return result;
  }

  async getComponentDocs(name: string) {
    const result = await this.call("getComponentDocs", { name }, docsResultSchema);
    if (result.found !== (result.component !== null)
      || result.name !== name
      || (result.component && result.component.name.toLowerCase() !== name.toLowerCase())) {
      throw new Error("getComponentDocs: несогласованный ответ MCP.");
    }
    return result;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      // Закрываем процесс также при ошибке инициализации клиента.
      await this.transport.close();
    }
  }
}
