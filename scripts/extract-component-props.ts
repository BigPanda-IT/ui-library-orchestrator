import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

type JsonValue = string | number | boolean | null;

interface PropMetadata {
  name: string;
  type: string;
  required: boolean;
  allowedValues?: JsonValue[];
  defaultValue?: JsonValue;
  description?: string;
  deprecated?: string | boolean;
  declaredIn?: string;
}

interface CuratedExample {
  title: string;
  description?: string;
  code: string;
}

interface CuratedComponentDocs {
  keywords: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  constraints: string[];
  examples: CuratedExample[];
}

interface ComponentMetadata {
  schemaVersion: 1;
  id: string;
  kind: "component";
  name: string;
  package: {
    name: string;
    version: string;
  };
  description?: string;
  import: {
    style: "named";
    name: string;
    from: string;
  };
  compactSignature: string;
  propsType: string;
  props: PropMetadata[];
  usage: {
    whenToUse: string[];
    whenNotToUse: string[];
    constraints: string[];
  };
  examples: CuratedExample[];
  keywords: string[];
  source: {
    exportEntry: string;
    implementation: string;
    propDeclarations: string[];
    curatedDocs: string;
  };
}

interface PackageMetadata {
  name: string;
  version: string;
}

const projectRoot = process.cwd();
const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");

if (!configPath) {
  throw new Error("Не найден tsconfig.json");
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

if (configFile.error) {
  throw new Error(formatDiagnostic(configFile.error));
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
);

if (parsedConfig.errors.length > 0) {
  throw new Error(parsedConfig.errors.map(formatDiagnostic).join("\n"));
}

const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});

const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length > 0) {
  throw new Error(diagnostics.map(formatDiagnostic).join("\n"));
}

const checker = program.getTypeChecker();
const entryFileName = path.join(projectRoot, "src", "ui", "index.ts");
const packageFileName = path.join(projectRoot, "package.json");
const curatedDocsFileName = path.join(projectRoot, "docs", "Button.docs.json");
const entrySourceFile = program.getSourceFile(entryFileName);

const packageMetadata = readPackageMetadata(packageFileName);
const curatedDocs = readCuratedDocs(curatedDocsFileName);

if (!entrySourceFile) {
  throw new Error(`Файл входа не найден в Program: ${entryFileName}`);
}

const moduleSymbol = checker.getSymbolAtLocation(entrySourceFile);

if (!moduleSymbol) {
  throw new Error("TypeChecker не создал Symbol для src/ui/index.ts");
}

const exportedButton = checker
  .getExportsOfModule(moduleSymbol)
  .find((symbol) => symbol.getName() === "Button");

if (!exportedButton) {
  throw new Error("Публичный export Button не найден");
}

const buttonSymbol = resolveAlias(exportedButton);
const buttonDeclaration = buttonSymbol.valueDeclaration ?? buttonSymbol.declarations?.[0];

if (!buttonDeclaration) {
  throw new Error("Не найдено объявление компонента Button");
}

const buttonType = checker.getTypeOfSymbolAtLocation(buttonSymbol, buttonDeclaration);
const callSignature = buttonType.getCallSignatures()[0];

if (!callSignature) {
  throw new Error("У Button нет call signature — значение не похоже на функцию-компонент");
}

const propsParameter = callSignature.getParameters()[0];
const propsDeclaration = propsParameter?.valueDeclaration ?? propsParameter?.declarations?.[0];

if (!propsParameter || !propsDeclaration) {
  throw new Error("У Button не найден первый параметр с props");
}

const propsType = checker.getTypeOfSymbolAtLocation(propsParameter, propsDeclaration);
const defaultValues = extractDefaults(buttonDeclaration);
const returnType = checker.getReturnTypeOfSignature(callSignature);
const compactReturnType = getDeclaredReturnType(buttonDeclaration) ?? checker.typeToString(
  returnType,
  buttonDeclaration,
  ts.TypeFormatFlags.NoTruncation,
);

const props = checker
  .getPropertiesOfType(propsType)
  .map<PropMetadata>((propSymbol) => {
    const declaration = propSymbol.valueDeclaration ?? propSymbol.declarations?.[0];
    const propType = declaration
      ? checker.getTypeOfSymbolAtLocation(propSymbol, declaration)
      : checker.getTypeOfSymbol(propSymbol);
    const documentation = ts.displayPartsToString(
      propSymbol.getDocumentationComment(checker),
    );
    const deprecatedTag = propSymbol
      .getJsDocTags(checker)
      .find((tag) => tag.name === "deprecated");
    const deprecatedText = deprecatedTag
      ? ts.displayPartsToString(deprecatedTag.text)
      : undefined;
    const allowedValues = extractLiteralUnionValues(propType);
    const declaredIn = declaration
      ? relativePath(declaration.getSourceFile().fileName)
      : undefined;

    return {
      name: propSymbol.getName(),
      type: checker.typeToString(
        propType,
        declaration,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      ),
      required: (propSymbol.flags & ts.SymbolFlags.Optional) === 0,
      ...(allowedValues ? { allowedValues } : {}),
      ...(defaultValues.has(propSymbol.getName())
        ? { defaultValue: defaultValues.get(propSymbol.getName()) }
        : {}),
      ...(documentation ? { description: documentation } : {}),
      ...(deprecatedTag
        ? { deprecated: deprecatedText || true }
        : {}),
      ...(declaredIn ? { declaredIn } : {}),
    };
  });

const result: ComponentMetadata = {
  schemaVersion: 1,
  id: `${packageMetadata.name}@${packageMetadata.version}/${buttonSymbol.getName()}`,
  kind: "component",
  name: buttonSymbol.getName(),
  package: packageMetadata,
  description: ts.displayPartsToString(
    buttonSymbol.getDocumentationComment(checker),
  ),
  import: {
    style: "named",
    name: buttonSymbol.getName(),
    from: packageMetadata.name,
  },
  compactSignature: createCompactSignature(
    buttonSymbol.getName(),
    checker.typeToString(
      propsType,
      propsDeclaration,
      ts.TypeFormatFlags.NoTruncation,
    ),
    compactReturnType,
    props,
  ),
  propsType: checker.typeToString(
    propsType,
    propsDeclaration,
    ts.TypeFormatFlags.NoTruncation,
  ),
  props,
  usage: {
    whenToUse: curatedDocs.whenToUse,
    whenNotToUse: curatedDocs.whenNotToUse,
    constraints: curatedDocs.constraints,
  },
  examples: curatedDocs.examples,
  keywords: curatedDocs.keywords,
  source: {
    exportEntry: relativePath(entrySourceFile.fileName),
    implementation: relativePath(buttonDeclaration.getSourceFile().fileName),
    propDeclarations: [
      ...new Set(
        props
          .map((prop) => prop.declaredIn)
          .filter((fileName): fileName is string => fileName !== undefined),
      ),
    ],
    curatedDocs: relativePath(curatedDocsFileName),
  },
};

const outputPath = path.join(projectRoot, "component-index.json");
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(`Создан ${relativePath(outputPath)}`);
console.log(JSON.stringify(result, null, 2));

function resolveAlias(symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function createCompactSignature(
  componentName: string,
  propsTypeName: string,
  returnTypeName: string,
  props: PropMetadata[],
): string {
  const propLines = props.map((prop) => {
    const optionalMarker = prop.required ? "" : "?";
    const compactType = prop.required
      ? prop.type
      : prop.type.replace(/ \| undefined$/, "");
    const defaultValue = Object.prototype.hasOwnProperty.call(prop, "defaultValue")
      ? ` = ${JSON.stringify(prop.defaultValue)}`
      : "";
    const deprecated = prop.deprecated
      ? ` [deprecated${typeof prop.deprecated === "string" ? `: ${prop.deprecated}` : ""}]`
      : "";

    return `- ${prop.name}${optionalMarker}: ${compactType}${defaultValue}${deprecated}`;
  });

  return [
    `${componentName}(props: ${propsTypeName}): ${returnTypeName}`,
    "",
    `${propsTypeName}:`,
    ...propLines,
  ].join("\n");
}

function getDeclaredReturnType(declaration: ts.Declaration): string | undefined {
  if (ts.isFunctionDeclaration(declaration) && declaration.type) {
    return declaration.type.getText();
  }

  return undefined;
}

function readPackageMetadata(fileName: string): PackageMetadata {
  const value: unknown = JSON.parse(fs.readFileSync(fileName, "utf8"));

  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.version !== "string"
  ) {
    throw new Error("package.json должен содержать строковые name и version");
  }

  return {
    name: value.name,
    version: value.version,
  };
}

function readCuratedDocs(fileName: string): CuratedComponentDocs {
  const value: unknown = JSON.parse(fs.readFileSync(fileName, "utf8"));

  if (!isRecord(value)) {
    throw new Error(`${relativePath(fileName)} должен содержать JSON-объект`);
  }

  const stringArrayFields = [
    "keywords",
    "whenToUse",
    "whenNotToUse",
    "constraints",
  ] as const;

  for (const field of stringArrayFields) {
    if (!isStringArray(value[field])) {
      throw new Error(`${relativePath(fileName)}: ${field} должен быть массивом строк`);
    }
  }

  if (!Array.isArray(value.examples) || !value.examples.every(isCuratedExample)) {
    throw new Error(
      `${relativePath(fileName)}: examples должен содержать title, code и необязательный description`,
    );
  }

  return {
    keywords: value.keywords as string[],
    whenToUse: value.whenToUse as string[],
    whenNotToUse: value.whenNotToUse as string[],
    constraints: value.constraints as string[],
    examples: value.examples as CuratedExample[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCuratedExample(value: unknown): value is CuratedExample {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.code === "string" &&
    (value.description === undefined || typeof value.description === "string")
  );
}

function extractDefaults(declaration: ts.Declaration): Map<string, JsonValue> {
  const defaults = new Map<string, JsonValue>();

  if (!ts.isFunctionDeclaration(declaration)) {
    return defaults;
  }

  const parameter = declaration.parameters[0];

  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) {
    return defaults;
  }

  for (const element of parameter.name.elements) {
    if (!element.initializer || !ts.isIdentifier(element.name)) {
      continue;
    }

    const value = literalValue(element.initializer);

    if (value !== undefined) {
      defaults.set(element.name.text, value);
    }
  }

  return defaults;
}

function literalValue(expression: ts.Expression): JsonValue | undefined {
  if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
    return ts.isNumericLiteral(expression)
      ? Number(expression.text)
      : expression.text;
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  return undefined;
}

function extractLiteralUnionValues(type: ts.Type): JsonValue[] | undefined {
  const members = type.isUnion() ? type.types : [type];
  const values: JsonValue[] = [];

  for (const member of members) {
    if ((member.flags & ts.TypeFlags.Undefined) !== 0) {
      continue;
    }

    if ((member.flags & ts.TypeFlags.StringLiteral) !== 0) {
      values.push((member as ts.StringLiteralType).value);
      continue;
    }

    if ((member.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      values.push((member as ts.NumberLiteralType).value);
      continue;
    }

    if ((member.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      values.push(checker.typeToString(member) === "true");
      continue;
    }

    if ((member.flags & ts.TypeFlags.Null) !== 0) {
      values.push(null);
      continue;
    }

    return undefined;
  }

  return values.length > 1 ? values : undefined;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

  return `${relativePath(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
}

function relativePath(fileName: string): string {
  return path.relative(projectRoot, fileName).replaceAll("\\", "/");
}
