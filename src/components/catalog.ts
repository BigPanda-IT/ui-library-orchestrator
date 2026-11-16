import { readFile } from "node:fs/promises";
import { componentMetadataSchema, type ComponentMetadata } from "./schema";

export class ComponentIndexError extends Error {}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
}

export function searchTerms(query: string): string[] {
  return [...new Set(normalize(query).match(/[\p{L}\p{N}_]+/gu) ?? [])];
}

export class ComponentCatalog {
  constructor(private readonly indexPath: string) {}

  async read(): Promise<ComponentMetadata> {
    let raw: string;
    try {
      raw = await readFile(this.indexPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new ComponentIndexError(
        code === "ENOENT"
          ? "Индекс компонентов не найден. Выполните npm run extract в корне проекта."
          : `Не удалось прочитать индекс компонентов (${code ?? "ошибка чтения"}).`,
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ComponentIndexError("Индекс содержит некорректный JSON. Выполните npm run extract.");
    }
    const parsed = componentMetadataSchema.safeParse(value);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join(".") || "корень";
      throw new ComponentIndexError(
        `Индекс не соответствует схеме версии 1 (поле: ${field}). Выполните npm run extract.`,
      );
    }
    return parsed.data;
  }

  async search(query: string) {
    const component = await this.read();
    const terms = searchTerms(query);
    const haystack = normalize([
      component.name,
      component.description ?? "",
      ...component.keywords,
      ...component.usage.whenToUse,
      ...component.props.map(prop => prop.name),
    ].join(" "));
    const matches = terms.length > 0 && terms.every(term => haystack.includes(term));
    return {
      query,
      total: matches ? 1 : 0,
      components: matches ? [{
        id: component.id,
        name: component.name,
        description: component.description ?? "",
        package: component.package,
        source: component.source,
      }] : [],
    };
  }

  async getDocs(name: string) {
    const component = await this.read();
    const found = normalize(component.name) === normalize(name);
    return {
      found,
      name,
      component: found ? component : null,
      message: found
        ? "Документация из локального индекса. Примеры не компилировались при этом вызове."
        : `Компонент ${name} не найден в текущем индексе учебной библиотеки.`,
      checks: { props: "not_run" as const, typescript: "not_run" as const },
    };
  }
}
