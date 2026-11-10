import type { Executor } from "./types";

// Заглушка проверяет каркас. Она не анализирует запрос и не читает библиотеку.
export const mockExecutor: Executor = async (_task) => ({
  mode: "mock",
  answer: "Демонстрационный ответ: Button может показывать загрузку через loading. "
    + "Это заранее подготовленный пример, одинаковый для любого запроса.",
  example: '<Button loading={isSaving} onClick={saveDocument}>\n  Сохранить\n</Button>',
  warnings: [
    "Модель и поиск не подключены; исходная задача не решалась автоматически.",
    "Button нужно импортировать; isSaving и saveDocument предоставляет приложение.",
  ],
  checks: { props: "not_run", typescript: "not_run" },
});
