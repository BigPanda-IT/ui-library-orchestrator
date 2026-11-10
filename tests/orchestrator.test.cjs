const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, dirname, basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTask } = require("../dist/src/orchestrator/run-task.js");

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
  const first = await runTask("  Кнопка сохранения  ", { runsDirectory });
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
  const second = await runTask("Другой запрос", { runsDirectory });
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
