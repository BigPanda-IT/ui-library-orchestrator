const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, dirname, basename } = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTask } = require("../dist/src/orchestrator/run-task.js");
const { mockExecutor } = require("../dist/src/orchestrator/mock-executor.js");
const { createMcpExecutor } = require("../dist/src/orchestrator/mcp-executor.js");
const { saveExampleArtifact } = require("../dist/src/orchestrator/example-artifact.js");
const { validateExample } = require("../dist/src/orchestrator/validate-example.js");

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
    "run.created", "run.started", "route.selected", "executor.started", "executor.completed", "run.completed",
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
    "run.created", "run.started", "route.selected", "executor.started", "executor.failed", "run.failed",
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
  for (const args of [[], ["   "], ["один", "два"], ["--docs"], ["--unknown", "Button"], ["--example", "--docs"], ["--docs", "Button", "extra"]]) {
    const invalid = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /одну непустую задачу/);
  }
});

test("оркестратор → MCP: реальные данные, отсутствие совпадений, ошибки и журнал", { timeout: 60000 }, async t => {
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
  assert.equal(success.run.result.component.examples[0].code, "<Button>Из индекса</Button>");
  assert.match(success.run.result.example, /<Button loading=\{isSaving\} onClick=\{saveDocument\}>/);
  assert.deepEqual(success.run.result.checks, { props: "passed", typescript: "passed" });
  assert.equal(await readFile(success.run.result.artifacts.examplePath, "utf8"), success.run.result.example);
  assert.deepEqual(JSON.parse(await readFile(success.run.result.artifacts.validationPath, "utf8")), success.run.result.validation);
  assert.deepEqual(JSON.parse(await readFile(success.statePath, "utf8")), success.run);
  const journal = await events(success.eventsPath);
  assert.deepEqual(journal.map(event => event.type), [
    "run.created", "run.started", "route.selected", "executor.started", "mcp.connected",
    "tool.started", "tool.completed", "tool.started", "tool.completed",
    "executor.completed", "preparation.started", "example.saved", "validation.started", "validation.completed", "workflow.stopped", "run.completed",
  ]);
  assert.deepEqual(journal.filter(event => event.type === "tool.started").map(event => [event.tool, event.arguments]), [
    ["searchComponents", { query: "кнопка сохранения" }], ["getComponentDocs", { name: "Button" }],
  ]);
  assert.ok(journal.every(event => event.runId === success.run.runId));

  const docsOnly = await runTask("Button", { ...options, route: "docs", workers: {
    preparer: async () => { throw new Error("Подготовщик не должен вызываться"); },
    reviewer: async () => { throw new Error("Проверяющий не должен вызываться"); },
  } });
  assert.equal(docsOnly.run.status, "completed");
  assert.equal(docsOnly.run.route, "docs");
  assert.match(docsOnly.run.result.answer, /Props:/);
  assert.equal(docsOnly.run.result.example, "");
  assert.equal(docsOnly.run.result.artifacts, undefined);
  assert.deepEqual(docsOnly.run.result.checks, { props: "not_run", typescript: "not_run" });
  const docsEvents = await events(docsOnly.eventsPath);
  assert.equal(docsEvents.find(event => event.type === "route.selected").message, "Выбран маршрут docs.");
  assert.equal(docsEvents.filter(event => event.type === "tool.started").length, 2);
  assert.ok(!docsEvents.some(event => event.type === "preparation.started"));
  assert.deepEqual((await readdir(dirname(docsOnly.statePath))).sort(), ["events.jsonl", "run.json"]);

  await assert.rejects(runTask("Button", { ...options, route: "unknown" }), /Неизвестный маршрут/);

  const absent = await runTask("DatePicker", options);
  assert.equal(absent.run.status, "completed");
  assert.equal(absent.run.result.outcome, "not_found");
  assert.equal(absent.run.result.component, null);
  assert.equal(absent.run.result.example, "");
  assert.equal(absent.run.result.artifacts, undefined);
  assert.deepEqual(absent.run.result.checks, { props: "not_run", typescript: "not_run" });
  assert.match(absent.run.result.answer, /совпадений.*нет/);
  const absentJournal = await events(absent.eventsPath);
  assert.equal(absentJournal.filter(event => event.type === "tool.started").length, 1);
  assert.equal(absentJournal.find(event => event.type === "tool.completed").outcome, "not_found");

  // Несогласованный с шаблоном API не должен давать зелёный результат.
  const changedApi = structuredClone(expected);
  changedApi.props = changedApi.props.filter(prop => prop.name !== "loading");
  await writeFile(indexPath, JSON.stringify(changedApi), "utf8");
  const rejected = await runTask("Button", options);
  assert.equal(rejected.run.status, "validation_failed");
  assert.deepEqual(rejected.run.result.checks, { props: "failed", typescript: "passed" });
  assert.ok(rejected.run.result.validation.issues.some(issue => issue.code === "UNKNOWN_PROP" && /loading/.test(issue.message)));
  assert.deepEqual(JSON.parse(await readFile(rejected.statePath, "utf8")), rejected.run);
  assert.equal((await events(rejected.eventsPath)).at(-1).type, "run.validation_failed");

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
  assert.equal(defaultRun.run.result.workflow.status, "approved");
  assert.equal(defaultRun.run.result.workflow.attempts.length, 1);
});

test("два исполнителя: доработка, причины остановки и история", { timeout: 60000 }, async t => {
  const { prepareExample } = require("../dist/src/orchestrator/example-preparer.js");
  const component = JSON.parse(await readFile(join(__dirname, "../component-index.json"), "utf8"));
  const root = await temporaryDirectory(t);
  const executor = async () => ({ mode: "mcp", outcome: "found", component,
    answer: "Button", example: "", warnings: [], checks: { props: "not_run", typescript: "not_run" } });
  const seeded = transform => async input => {
    if (input.previous) return prepareExample(input);
    const first = await prepareExample(input);
    return { ...first, code: transform(first.code), changes: ["Тестовый исходный вариант."] };
  };
  const run = workers => runTask("Button", { runsDirectory: root, executor, workers });

  await t.test("isPending исправляется; обе версии и замечания сохраняются", async () => {
    const result = await run({ preparer: seeded(code => code.replace("loading={isSaving}", "isPending={isSaving}")) });
    assert.equal(result.run.status, "completed", result.run.error);
    const { workflow, example } = result.run.result;
    assert.equal(workflow.status, "approved");
    assert.equal(workflow.attempts.length, 2);
    const [first, second] = workflow.attempts;
    assert.equal(first.review.status, "needs_changes");
    assert.deepEqual(first.review.validation.checks, { props: "passed", typescript: "passed" });
    assert.equal(second.review.status, "approved");
    assert.match(await readFile(first.artifacts.examplePath, "utf8"), /isPending=\{isSaving\}/);
    assert.match(await readFile(second.artifacts.examplePath, "utf8"), /loading=\{isSaving\}/);
    assert.equal(await readFile(second.artifacts.examplePath, "utf8"), example);
    for (const attempt of workflow.attempts) {
      assert.deepEqual(JSON.parse(await readFile(attempt.artifacts.validationPath, "utf8")), attempt.review.validation);
    }
    const { historyPath, ...savedHistory } = workflow;
    assert.deepEqual(JSON.parse(await readFile(historyPath, "utf8")), savedHistory);
    const journal = await events(result.eventsPath);
    assert.equal(journal.filter(event => event.type === "revision.requested").length, 1);
    assert.match(journal.find(event => event.type === "example.saved" && event.attempt === 2).changes[0], /isPending заменён/);
  });

  for (const [name, transform, reason] of [
    ["неизвестный prop не удаляется", code => code.replace("<Button loading", '<Button size="large" loading'), /нет однозначного/],
    ["конфликт loading и isPending", code => code.replace("<Button loading", "<Button isPending={true} loading"), /неоднозначна/],
  ]) await t.test(name, async () => {
    const result = await run({ preparer: seeded(transform) });
    assert.equal(result.run.status, "validation_failed");
    assert.equal(result.run.result.workflow.status, "no_fix");
    assert.match(result.run.result.workflow.reason, reason);
    assert.equal(result.run.result.workflow.attempts.length, 1);
  });

  await t.test("повтор того же кода и ошибки останавливает цикл", async () => {
    const first = seeded(code => code.replace("<Button loading", '<Button size="large" loading'));
    const result = await run({ preparer: input => input.previous
      ? Promise.resolve({ status: "prepared", code: input.previous.code, changes: [] }) : first(input) });
    assert.equal(result.run.status, "validation_failed");
    assert.equal(result.run.result.workflow.status, "repeated");
    assert.equal(result.run.result.workflow.attempts.length, 2);
  });

  await t.test("не больше двух доработок; сохраняется последний вариант", async () => {
    let calls = 0;
    const first = seeded(code => code.replace("<Button loading", '<Button size="large" loading'));
    const result = await run({ preparer: async input => {
      calls++;
      return input.previous ? { status: "prepared", code: input.previous.code + `\n// попытка ${calls}`, changes: ["Добавлен комментарий."] }
        : first(input);
    } });
    assert.equal(calls, 3);
    assert.equal(result.run.status, "validation_failed");
    assert.equal(result.run.result.workflow.status, "limit_reached");
    assert.equal(result.run.result.workflow.attempts.length, 3);
    assert.match(result.run.result.example, /попытка 3/);
  });

  await t.test("ошибка проверяющего сохраняет подготовленный код и причину", async () => {
    const result = await run({ reviewer: async () => { throw new Error("Проверяющий недоступен"); } });
    assert.equal(result.run.status, "failed");
    assert.match(result.run.error, /Проверяющий недоступен/);
    const history = JSON.parse(await readFile(result.run.historyPath, "utf8"));
    assert.equal(history.status, "technical_error");
    assert.equal(history.attempts.length, 1);
    assert.equal(history.attempts[0].review, undefined);
    assert.match(await readFile(history.attempts[0].artifacts.examplePath, "utf8"), /SaveButtonExample/);
  });

  await t.test("ошибка подготовщика при доработке не теряет первую проверку", async () => {
    const first = seeded(code => code.replace("loading={isSaving}", "isPending={isSaving}"));
    const result = await run({ preparer: async input => {
      if (input.previous) throw new Error("Доработка недоступна");
      return first(input);
    } });
    assert.equal(result.run.status, "failed");
    const history = JSON.parse(await readFile(result.run.historyPath, "utf8"));
    assert.equal(history.status, "technical_error");
    assert.equal(history.attempts[0].review.status, "needs_changes");
  });
});

test("проверка артефакта: реальные типы, обязательные, неизвестные и устаревшие props", { timeout: 60000 }, async t => {
  const root = await temporaryDirectory(t);
  const component = JSON.parse(await readFile(join(__dirname, "../component-index.json"), "utf8"));
  const { example, artifacts } = await saveExampleArtifact(root);
  const check = () => validateExample(artifacts.examplePath, artifacts.tsconfigPath, component);
  assert.deepEqual(check(), { checks: { props: "passed", typescript: "passed" }, issues: [] });

  const cases = [
    ["неизвестный prop", example.replace("<Button loading", '<Button size="large" loading'), "failed", "failed", "UNKNOWN_PROP"],
    ["нет children", example.replace(">Сохранить</Button>", " />"), "failed", "failed", "MISSING_REQUIRED_PROP"],
    ["неверный тип", example.replace("loading={isSaving}", 'loading="yes"'), "passed", "failed", "TS2322"],
    ["неверный вариант", example.replace("<Button loading", '<Button variant="large" loading'), "passed", "failed", "TS2322"],
    ["неизвестный обработчик", example.replace("onClick={saveDocument}", "onClick={missingHandler}"), "passed", "failed", "TS2304"],
    ["устаревший prop", example.replace("<Button loading", "<Button isPending={true} loading"), "passed", "passed", "DEPRECATED_PROP"],
    ["JSX spread", example.replace("<Button loading", "<Button {...{ disabled: true }} loading"), "failed", "passed", "UNSUPPORTED_SPREAD"],
    ["пустой children", example.replace(">Сохранить</Button>", ">{/* только комментарий */}</Button>"), "failed", "failed", "MISSING_REQUIRED_PROP"],
    ["нет компонента", 'export const example = "Button";', "failed", "passed", "COMPONENT_NOT_USED"],
    ["ошибка синтаксиса", example + "\nconst broken = ;", "failed", "failed", "INVALID_TSX"],
  ];
  for (const [name, code, props, typescript, diagnostic] of cases) {
    await t.test(name, async () => {
      await writeFile(artifacts.examplePath, code, "utf8");
      const validation = check();
      assert.deepEqual(validation.checks, { props, typescript });
      const issue = validation.issues.find(item => item.code === diagnostic);
      assert.ok(issue, JSON.stringify(validation));
      assert.ok(issue.line > 0 && issue.column > 0);
      if (diagnostic === "DEPRECATED_PROP") assert.equal(issue.severity, "warning");
    });
  }
  await writeFile(artifacts.examplePath, example, "utf8");
  // Сохранённая конфигурация должна работать также через обычный tsc.
  const compilerPackagePath = require.resolve("typescript/package.json");
  const compilerPackage = require(compilerPackagePath);
  const compiler = join(dirname(compilerPackagePath), compilerPackage.bin.tsc ?? compilerPackage.bin.tsc6);
  const valid = spawnSync(process.execPath, [compiler, "-p", artifacts.tsconfigPath], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.ok(!(await readdir(root)).some(name => name.endsWith(".js")));
});
