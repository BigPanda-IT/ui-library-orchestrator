import { writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ComponentMetadata } from "../components/schema";

const projectRoot = resolve(__dirname, "../../..");

function fromDirectory(directory: string, target: string): string {
  const path = relative(directory, target).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}

export function supportsExample(component: ComponentMetadata): boolean {
  return component.name === "Button" && component.import.name === "Button"
    && component.source.exportEntry === "src/ui/index.ts";
}

// Явный шаблон сценария сохранения. Значения API проверяются после подготовки.
export function createButtonExample(directory: string): string {
  const entry = fromDirectory(directory, join(projectRoot, "src/ui/index"));
  return `import { useState } from "react";
import { Button } from ${JSON.stringify(entry)};

export function SaveButtonExample({ onSave }: { onSave: () => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDocument(): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      await onSave();
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Button loading={isSaving} onClick={saveDocument}>Сохранить</Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
`;
}

export async function saveExampleArtifact(directory: string, example = createButtonExample(directory), attempt?: number) {
  const suffix = attempt === undefined ? "" : `-${attempt}`;
  const exampleName = `example${suffix}.tsx`;
  const examplePath = join(directory, exampleName);
  const tsconfigPath = join(directory, `tsconfig${suffix}.json`);
  const validationPath = join(directory, `validation${suffix}.json`);
  // Конфигурация работает и для runs вне корня проекта. Только проверка типов.
  const reactTypes = fromDirectory(directory, join(projectRoot, "node_modules/@types/react"));
  const config = {
    compilerOptions: {
      target: "ES2022", module: "Node16", moduleResolution: "Node16",
      jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, types: ["react"],
      typeRoots: [fromDirectory(directory, join(projectRoot, "node_modules/@types"))],
      paths: { react: [`${reactTypes}/index.d.ts`], "react/*": [`${reactTypes}/*`] },
    },
    files: [exampleName],
  };
  await writeFile(examplePath, example, "utf8");
  await writeFile(tsconfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { example, artifacts: { examplePath, tsconfigPath, validationPath } };
}
