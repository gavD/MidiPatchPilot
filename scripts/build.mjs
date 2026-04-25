import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const srcDir = path.join(rootDir, "src");
const examplesDir = path.join(rootDir, "examples");
const defaultYamlPath = path.join(examplesDir, "behringer-jt-mini.yaml");

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "examples"), { recursive: true });

const [html, css, tsSource, defaultYaml] = await Promise.all([
  readFile(path.join(srcDir, "index.html"), "utf8"),
  readFile(path.join(srcDir, "styles.css"), "utf8"),
  readFile(path.join(srcDir, "main.ts"), "utf8"),
  readFile(defaultYamlPath, "utf8"),
]);

const js = stripTypescriptDeclarations(tsSource).replace(
  "\"__DEFAULT_INSTRUMENT_YAML__\"",
  JSON.stringify(defaultYaml),
);

await Promise.all([
  writeFile(path.join(distDir, "index.html"), html, "utf8"),
  writeFile(path.join(distDir, "styles.css"), css, "utf8"),
  writeFile(path.join(distDir, "app.js"), js, "utf8"),
  copyFile(defaultYamlPath, path.join(distDir, "examples", "behringer-jt-mini.yaml")),
]);

console.log(`Built static site in ${path.relative(rootDir, distDir)}`);

function stripTypescriptDeclarations(source) {
  return source
    .replace(/^interface\s+[^{]+\{[\s\S]*?^}\n/gm, "")
    .replace(/^type\s+\w+\s*=[\s\S]*?;\n/gm, "")
    .replace(/\s+as\s+any/g, "")
    .trimStart();
}
