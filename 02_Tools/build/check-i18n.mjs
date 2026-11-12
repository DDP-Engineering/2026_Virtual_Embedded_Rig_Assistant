import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSoftware, software } from "../environment/software.mjs";

const { default: ts } = await importSoftware("typescript");

function flatten(value, prefix = "", result = new Set()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") result.add(path);
    else if (entry && typeof entry === "object") flatten(entry, path, result);
    else throw new Error(`Invalid catalog value: ${path}`);
  }
  return result;
}

/** Dynamic translations must use the explicit, reviewed defineTranslationKeys contract. */
export function auditCatalogs(catalogs, sources) {
  const errors = new Set();
  const used = new Set();
  for (const source of sources) {
    const tree = ts.createSourceFile("renderer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const contracts = new Set();
    function visit(node) {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(tree) === "i18nKey" &&
        ts.isStringLiteral(node.initializer)
      )
        used.add(node.initializer.text);
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(tree);
        if (callee === "defineTranslationKeys") {
          const array = node.arguments[0];
          if (!array || !ts.isArrayLiteralExpression(array) || !array.elements.every(ts.isStringLiteral))
            errors.add("invalid dynamic translation contract");
          else {
            if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))
              contracts.add(node.parent.name.text);
            for (const entry of array.elements) used.add(entry.text);
          }
        }
        if (callee === "t" || callee === "i18next.t") {
          const key = node.arguments[0];
          if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) used.add(key.text);
          else if (
            !key ||
            !ts.isElementAccessExpression(key) ||
            !ts.isIdentifier(key.expression) ||
            !contracts.has(key.expression.text)
          )
            errors.add("unregistered dynamic translation call");
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  const english = flatten(catalogs.en);
  for (const key of used) if (!english.has(key)) errors.add(`missing source key: ${key}`);
  for (const key of english) if (!used.has(key)) errors.add(`unused source key: ${key}`);
  for (const [language, catalog] of Object.entries(catalogs)) {
    if (language === "en") continue;
    const keys = flatten(catalog);
    for (const key of english) if (!keys.has(key)) errors.add(`${language} missing key: ${key}`);
    for (const key of keys) if (!english.has(key)) errors.add(`${language} translation-only key: ${key}`);
  }
  return [...errors].sort();
}

async function sourcesAt(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourcesAt(path)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name))
      result.push(await readFile(path, "utf8"));
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const renderer = join(software, "src/apps/desktop/src/renderer");
  let catalogs = {};
  let sources;
  if (process.argv[2] === "--fixture" && process.argv[3]) {
    const fixture = JSON.parse(await readFile(resolve(process.argv[3]), "utf8"));
    catalogs = fixture.catalogs;
    sources = fixture.sources;
  } else {
    for (const language of ["en", "ro", "de"])
      catalogs[language] = JSON.parse(await readFile(join(renderer, "locales", `${language}.json`), "utf8"));
    sources = await sourcesAt(renderer);
  }
  const errors = auditCatalogs(catalogs, sources);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("i18n: English usage and en/ro/de catalogs complete");
}
