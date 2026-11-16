const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, join, dirname, basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const projectRoot = resolve(__dirname, "..");
const cli = join(projectRoot, "dist/src/mcp/cli.js");

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "components-mcp-test-"));
  t.after(async () => {
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith("components-mcp-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function connect(t, indexPath) {
  const client = new Client({ name: "components-integration-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, ...(indexPath ? ["--index", indexPath] : [])],
    cwd: tmpdir(), // Путь по умолчанию не должен зависеть от cwd клиента.
    stderr: "pipe",
  });
  const protocolErrors = [];
  let stderr = "";
  transport.stderr.on("data", chunk => { stderr += chunk.toString(); });
  client.onerror = error => { protocolErrors.push(error); };
  t.after(async () => {
    await client.close();
    await transport.close();
    assert.deepEqual(protocolErrors, [], "stdout должен содержать только MCP-сообщения");
    assert.equal(stderr, "");
  });
  await client.connect(transport, { timeout: 5000 });
  return client;
}

async function call(client, name, args) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
}

function payload(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const parsed = JSON.parse(result.content.find(item => item.type === "text").text);
  assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}

// Генерация из реальных TSX и docs, чтобы проверить весь путь, а не только fixture.
test("MCP stdio: индексатор → handshake → tools/list → поиск → документация", { timeout: 30000 }, async t => {
  const extraction = spawnSync(process.execPath, [join(projectRoot, "dist/scripts/extract-component-props.js")], {
    cwd: projectRoot, encoding: "utf8", timeout: 20000,
  });
  assert.equal(extraction.status, 0, extraction.stderr);
  const expected = JSON.parse(await readFile(join(projectRoot, "component-index.json"), "utf8"));
  const client = await connect(t);
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(tool => tool.name).sort(), ["getComponentDocs", "searchComponents"]);
  for (const tool of list.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
    assert.equal(tool.annotations.readOnlyHint, true);
  }

  for (const query of ["BUTTON", "кнопка сохранения", "loading"]) {
    const search = payload(await call(client, "searchComponents", { query }));
    assert.equal(search.total, 1);
    assert.equal(search.components[0].id, expected.id);
    assert.equal(search.components[0].props, undefined, "поиск возвращает компактную карточку");
  }
  const absent = payload(await call(client, "searchComponents", { query: "DatePicker" }));
  assert.deepEqual(absent.components, []);
  assert.equal(absent.total, 0);
  assert.equal(payload(await call(client, "searchComponents", { query: "button DatePicker" })).total, 0);

  const docs = payload(await call(client, "getComponentDocs", { name: " button " }));
  assert.equal(docs.found, true);
  assert.deepEqual(docs.component, expected);
  assert.equal(docs.component.props.find(prop => prop.name === "children").required, true);
  assert.equal(docs.component.props.find(prop => prop.name === "loading").defaultValue, false);
  assert.ok(docs.component.props.find(prop => prop.name === "isPending").deprecated);
  assert.ok(!docs.component.props.some(prop => ["size", "type"].includes(prop.name)));
  assert.ok(docs.component.usage.constraints.some(text => text.includes("не использует isPending")));
  assert.ok(docs.component.usage.constraints.some(text => text.includes('type="button"')));
  assert.deepEqual(docs.checks, { props: "not_run", typescript: "not_run" });
  const missing = payload(await call(client, "getComponentDocs", { name: "DatePicker" }));
  assert.equal(missing.found, false);
  assert.equal(missing.component, null);
  assert.match(missing.message, /текущем индексе/);

  await t.test("неверные аргументы и неизвестный инструмент отклоняются; сервер продолжает работать", async () => {
    for (const [name, args] of [
      ["searchComponents", {}],
      ["searchComponents", { query: "  " }],
      ["searchComponents", { query: "!!!" }],
      ["searchComponents", { query: 123 }],
      ["searchComponents", { query: "x".repeat(501) }],
      ["searchComponents", { query: "button", path: "package.json" }],
      ["getComponentDocs", {}],
      ["getComponentDocs", { name: "" }],
      ["getComponentDocs", { name: ["Button"] }],
      ["getComponentDocs", { name: "Button", command: "echo hello" }],
      ["runCommand", { command: "echo hello" }],
    ]) {
      const result = await call(client, name, args);
      assert.equal(result.isError, true, `${name}: ${JSON.stringify(args)}`);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(payload(await call(client, "getComponentDocs", { name: "Button" })).found, true);
  });

  await t.test("ошибки индекса не маскируются под пустой поиск; обновления читаются без перезапуска", async t => {
    const directory = await temporaryDirectory(t);
    const indexPath = join(directory, "component-index.json");
    const client = await connect(t, indexPath);
    const missing = await call(client, "searchComponents", { query: "Button" });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /не найден/);
    for (const invalid of ["{broken", "null", "{}", JSON.stringify({ ...expected, schemaVersion: 2 }),
      JSON.stringify({ ...expected, props: [{ name: "x" }] })]) {
      await writeFile(indexPath, invalid, "utf8");
      const result = await call(client, "getComponentDocs", { name: "Button" });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
      assert.match(result.content[0].text, /npm run extract/);
    }
    await writeFile(indexPath, JSON.stringify(expected), "utf8");
    assert.equal(payload(await call(client, "getComponentDocs", { name: "Button" })).found, true);
    const updated = { ...expected, description: "Обновлённое описание из индекса" };
    await writeFile(indexPath, JSON.stringify(updated), "utf8");
    assert.deepEqual(payload(await call(client, "getComponentDocs", { name: "Button" })).component, updated);
    await rm(indexPath);
    assert.equal((await call(client, "getComponentDocs", { name: "Button" })).isError, true);
  });
});

test("CLI: справка и ошибки не загрязняют stdout", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: 5000 });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, "");
  assert.match(help.stderr, /--index/);
  for (const args of [["--index"], ["--model"], ["--index", ""]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /--index/);
  }
});
