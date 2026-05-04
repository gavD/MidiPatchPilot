import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const srcDir = path.join(rootDir, "src");
const presetsDir = path.join(rootDir, "presets");
const defaultYamlPath = path.join(presetsDir, "behringer-jt-mini.yaml");
const packageJsonPath = path.join(rootDir, "package.json");

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "presets"), { recursive: true });

const [html, monitorHtml, css, tsSource, monitorSource, defaultYaml, presetFiles, packageJsonSource] = await Promise.all([
  readFile(path.join(srcDir, "index.html"), "utf8"),
  readFile(path.join(srcDir, "midi-monitor.html"), "utf8"),
  readFile(path.join(srcDir, "styles.css"), "utf8"),
  readFile(path.join(srcDir, "main.ts"), "utf8"),
  readFile(path.join(srcDir, "midi-monitor.ts"), "utf8"),
  readFile(defaultYamlPath, "utf8"),
  readdir(presetsDir),
  readFile(packageJsonPath, "utf8"),
]);
const packageJson = JSON.parse(packageJsonSource);
const appVersion = packageJson.version;
if (typeof appVersion !== "string" || !appVersion.trim()) {
  throw new Error("package.json must define a non-empty version string.");
}
const presetYamlFiles = presetFiles.filter((file) => /\.ya?ml$/i.test(file)).sort((left, right) => {
  if (left === "behringer-jt-mini.yaml") {
    return -1;
  }
  if (right === "behringer-jt-mini.yaml") {
    return 1;
  }
  return left.localeCompare(right);
});
const presetManifest = await Promise.all(
  presetYamlFiles.map(async (file) => {
    const yaml = await readFile(path.join(presetsDir, file), "utf8");
    return {
      file,
      name: extractPresetName(yaml, file),
      yaml,
    };
  }),
);

const appJs = compileTypescript(tsSource)
  .replace("\"__DEFAULT_INSTRUMENT_YAML__\"", JSON.stringify(defaultYaml))
  .replace("\"__PRESET_MANIFEST__\"", JSON.stringify(presetManifest));
const monitorJs = compileTypescript(monitorSource);

await Promise.all([
  writeFile(path.join(distDir, "index.html"), renderHtml(html), "utf8"),
  writeFile(path.join(distDir, "midi-monitor.html"), renderHtml(monitorHtml), "utf8"),
  writeFile(path.join(distDir, "styles.css"), css, "utf8"),
  writeFile(path.join(distDir, "app.js"), appJs, "utf8"),
  writeFile(path.join(distDir, "midi-monitor.js"), monitorJs, "utf8"),
  ...presetYamlFiles.map((file) => copyFile(path.join(presetsDir, file), path.join(distDir, "presets", file))),
]);

console.log(`Built static site in ${path.relative(rootDir, distDir)}`);

function compileTypescript(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2021,
    },
  });
  return result.outputText.trimStart();
}

function renderHtml(source) {
  return source.replaceAll("__APP_VERSION__", appVersion);
}

function extractPresetName(yaml, file) {
  const match = yaml.match(/^name:\s*(.+)$/m);
  if (!match) {
    return file.replace(/\.ya?ml$/i, "");
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}
