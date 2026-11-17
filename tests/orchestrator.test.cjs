const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, dirname, basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTask } = require("../dist/src/orchestrator/run-task.js");
const { mockExecutor } = require("../dist/src/orchestrator/mock-executor.js");
const { createMcpExecutor } = require("../dist/src/orchestrator/mcp-executor.js");

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
  t.after(async () => {
    // Удаляем только созданный этим тестом каталог в системной temp-папке.
    assert.equal(dirname(root), tmpdir());
    assert.ok(basename(root).startsWith("orchestrator-test-"));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function events(path) {
  return (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
}

test("сохраняет результат и последовательность событий; запуски изолированы", async t => {
  const runsDirectory = await temporaryDirectory(t);
  const first = await runTask("  Кнопка сохранения  ", { runsDirectory, executor: mockExecutor });
  const saved = JSON.parse(await readFile(first.statePath, "utf8"));
  assert.deepEqual(saved, first.run);
  assert.equal(saved.task, "Кнопка сохранения");
  assert.equal(saved.status, "completed");
  assert.equal(saved.result.mode, "mock");
  assert.deepEqual(saved.result.checks, { props: "not_run", typescript: "not_run" });
  const journal = await events(first.eventsPath);
  assert.deepEqual(journal.map(event => event.type), [
    "run.created", "run.started", "executor.started", "executor.completed", "run.completed",
  ]);
  assert.ok(journal.every(event => event.runId === saved.runId && !Number.isNaN(Date.parse(event.timestamp))));
  const second = await runTask("Другой запрос", { runsDirectory, executor: mockExecutor });
  assert.notEqual(second.run.runId, saved.runId);
  assert.equal((await readdir(runsDirectory)).length, 2);
  assert.deepEqual(JSON.parse(await readFile(first.statePath, "utf8")), saved);
});

test("ошибка исполнителя сохраняется как failed без успешного результата", async t => {
  const runsDirectory = await temporaryDirectory(t);
  const outcome = await runTask("Задача", {
    runsDirectory,
    executor: async task => {
      assert.equal(task, "Задача");
      throw new Error("Тестовая ошибка исполнителя");
    },
  });
  const saved = JSON.parse(await readFile(outcome.statePath, "utf8"));
  assert.equal(saved.status, "failed");
  assert.equal(saved.error, "Тестовая ошибка исполнителя");
  assert.equal(saved.result, undefined);
  assert.deepEqual((await events(outcome.eventsPath)).map(event => event.type), [
    "run.created", "run.started", "executor.started", "executor.failed", "run.failed",
  ]);
});

test("пустая задача отклоняется до создания файлов", async t => {
  const runsDirectory = await temporaryDirectory(t);
  await assert.rejects(runTask("   ", { runsDirectory }), /не должна быть пустой/);
  assert.deepEqual(await readdir(runsDirectory), []);
});

test("ошибка хранилища не выдаётся за успешный запуск", async t => {
  const root = await temporaryDirectory(t);
  const runsDirectory = join(root, "file-instead-of-directory");
  await writeFile(runsDirectory, "occupied", "utf8");
  let called = false;
  await assert.rejects(runTask("Задача", {
    runsDirectory,
    executor: async () => { called = true; throw new Error("Не должен вызываться"); },
  }));
  assert.equal(called, false);
});

test("CLI: справка успешна, отсутствие задачи и лишние аргументы дают код 1", () => {
  const cli = join(__dirname, "../dist/src/orchestrator/cli.js");
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /npm run orchestrate/);
  for (const args of [[], ["   "], ["один", "два"]]) {
    const invalid = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /одну непустую задачу/);
  }
});

test("оркестратор → MCP: реальные данные, отсутствие совпадений, ошибки и журнал", { timeout: 30000 }, async t => {
  const root = await temporaryDirectory(t);
  const projectRoot = join(__dirname, "..");
  const extraction = spawnSync(process.execPath, [join(projectRoot, "dist/scripts/extract-component-props.js")], {
    cwd: projectRoot, encoding: "utf8", timeout: 20000,
  });
  assert.equal(extraction.status, 0, extraction.stderr);
  const original = JSON.parse(await readFile(join(projectRoot, "component-index.json"), "utf8"));
  const indexPath = join(root, "index.json");
  // Изменённые данные доказывают, что ответ поступает через сервер, а не из заглушки.
  const expected = structuredClone(original);
  expected.package.version = "2.4.6";
  expected.description = "Описание из тестового индекса";
  expected.examples = [{ title: "Пример из индекса", code: "<Button>Из индекса</Button>" }];
  await writeFile(indexPath, JSON.stringify(expected), "utf8");
  const options = { runsDirectory: join(root, "runs"), executor: createMcpExecutor({ indexPath }) };

  const success = await runTask("  кнопка сохранения  ", options);
  assert.equal(success.run.status, "completed");
  assert.equal(success.run.result.mode, "mcp");
  assert.equal(success.run.result.outcome, "found");
  assert.deepEqual(success.run.result.component, expected);
  assert.match(success.run.result.answer, /2\.4\.6/);
  assert.match(success.run.result.answer, /Описание из тестового индекса/);
  assert.match(success.run.result.answer, /src\/ui\/Button.types.ts/);
  assert.match(success.run.result.example, /<Button>Из индекса<\/Button>/);
  assert.deepEqual(success.run.result.checks, { props: "not_run", typescript: "not_run" });
  assert.deepEqual(JSON.parse(await readFile(success.statePath, "utf8")), success.run);
  const journal = await events(success.eventsPath);
  assert.deepEqual(journal.map(event => event.type), [
    "run.created", "run.started", "executor.started", "mcp.connected",
    "tool.started", "tool.completed", "tool.started", "tool.completed",
    "executor.completed", "run.completed",
  ]);
  assert.deepEqual(journal.filter(event => event.type === "tool.started").map(event => [event.tool, event.arguments]), [
    ["searchComponents", { query: "кнопка сохранения" }], ["getComponentDocs", { name: "Button" }],
  ]);
  assert.ok(journal.every(event => event.runId === success.run.runId));

  const absent = await runTask("DatePicker", options);
  assert.equal(absent.run.status, "completed");
  assert.equal(absent.run.result.outcome, "not_found");
  assert.equal(absent.run.result.component, null);
  assert.equal(absent.run.result.example, "");
  assert.match(absent.run.result.answer, /совпадений.*нет/);
  const absentJournal = await events(absent.eventsPath);
  assert.equal(absentJournal.filter(event => event.type === "tool.started").length, 1);
  assert.equal(absentJournal.find(event => event.type === "tool.completed").outcome, "not_found");

  for (const [query, content, message] of [
    ["!!!", JSON.stringify(expected), /Input validation error/],
    ["Button", "{broken", /некорректный JSON/],
    ["Button", "{}", /не соответствует схеме/],
    ["Button", null, /Индекс компонентов не найден/],
  ]) {
    if (content === null) await rm(indexPath);
    else await writeFile(indexPath, content, "utf8");
    const failed = await runTask(query, options);
    assert.equal(failed.run.status, "failed");
    assert.match(failed.run.error, message);
    assert.equal(failed.run.result, undefined);
    const failedJournal = await events(failed.eventsPath);
    assert.deepEqual(failedJournal.slice(-3).map(event => event.type), ["tool.failed", "executor.failed", "run.failed"]);
    assert.equal(failedJournal.filter(event => event.type === "tool.started").length, 1);
    assert.deepEqual(JSON.parse(await readFile(failed.statePath, "utf8")), failed.run);
  }

  // Без явной подстановки исполнитель тоже должен работать через MCP.
  const defaultRun = await runTask("Button", { runsDirectory: join(root, "default-runs") });
  assert.equal(defaultRun.run.status, "completed");
  assert.deepEqual(defaultRun.run.result.component, original);
});
