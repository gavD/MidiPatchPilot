import { createServer } from "node:http";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const srcDir = path.join(rootDir, "src");
const presetsDir = path.join(rootDir, "presets");
const buildScript = path.join(rootDir, "scripts", "build.mjs");
const liveReloadPath = "/__multimidi_reload";
const rebuildDelayMs = 80;
const args = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith("--")) {
    args.set(arg.slice(2), process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
      ? process.argv[++index]
      : "true");
  }
}

const host = args.get("host") || "127.0.0.1";
const port = Number(args.get("port") || process.env.PORT || 4173);
const watchMode = args.has("watch");
let activePort = port;
let activeBuild = null;
let queuedBuild = false;
let rebuildTimer = null;
let shuttingDown = false;
const liveReloadClients = new Set();
const fileWatchers = [];

if (watchMode) {
  const built = await runBuild({ initial: true });
  if (!built) {
    process.exit(1);
  }
  startFileWatchers();
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${activePort}`);

    if (watchMode && requestUrl.pathname === liveReloadPath) {
      connectLiveReloadClient(request, response);
      return;
    }

    const safePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    const targetPath = path.normalize(path.join(distDir, safePath || "index.html"));

    if (!targetPath.startsWith(distDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const filePath = await resolveFile(targetPath);
    const type = contentType(filePath);
    let body = await readFile(filePath);
    if (watchMode && type.startsWith("text/html")) {
      body = Buffer.from(injectLiveReload(body.toString("utf8")), "utf8");
    }
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

listen(port, 0);

async function resolveFile(targetPath) {
  const info = await stat(targetPath);
  if (info.isDirectory()) {
    return path.join(targetPath, "index.html");
  }
  return targetPath;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".yml": "text/yaml; charset=utf-8",
  };
  return types[extension] || "application/octet-stream";
}

function injectLiveReload(source) {
  const script = `    <script>
      (() => {
        const events = new EventSource("${liveReloadPath}");
        events.addEventListener("reload", () => window.location.reload());
      })();
    </script>`;
  if (source.includes(liveReloadPath)) {
    return source;
  }
  if (source.includes("</body>")) {
    return source.replace("</body>", `${script}\n  </body>`);
  }
  return `${source}\n${script}\n`;
}

function connectLiveReloadClient(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
  liveReloadClients.add(response);
  request.on("close", () => {
    liveReloadClients.delete(response);
  });
}

function notifyLiveReloadClients() {
  const event = `event: reload\ndata: ${Date.now()}\n\n`;
  for (const client of liveReloadClients) {
    client.write(event);
  }
}

function startFileWatchers() {
  for (const directory of [srcDir, presetsDir]) {
    fileWatchers.push(watchDirectory(directory));
  }
  console.log("Watching src/ and presets/ for changes");
}

function watchDirectory(directory) {
  const onChange = (eventType, filename) => {
    if (!filename || filename.endsWith("~")) {
      return;
    }

    const changedPath = path.relative(rootDir, path.join(directory, filename.toString()));
    console.log(`Change detected in ${changedPath}`);
    queueRebuild();
  };

  const fileWatcher = watch(directory, onChange);
  fileWatcher.on("error", (error) => {
    console.error(`File watcher failed for ${path.relative(rootDir, directory)}: ${error.message}`);
  });
  return fileWatcher;
}

function queueRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    runQueuedBuild();
  }, rebuildDelayMs);
}

async function runQueuedBuild() {
  if (activeBuild) {
    queuedBuild = true;
    return;
  }

  do {
    queuedBuild = false;
    await runBuild({ initial: false });
  } while (queuedBuild);
}

function runBuild({ initial }) {
  if (activeBuild) {
    queuedBuild = true;
    return activeBuild;
  }

  const startedAt = Date.now();
  activeBuild = new Promise((resolve) => {
    const build = spawn(process.execPath, [buildScript], {
      cwd: rootDir,
      stdio: "inherit",
    });

    build.on("error", (error) => {
      console.error(`Build failed to start: ${error.message}`);
      activeBuild = null;
      resolve(false);
    });

    build.on("close", (code) => {
      const elapsedMs = Date.now() - startedAt;
      activeBuild = null;
      if (code === 0) {
        console.log(`${initial ? "Initial build" : "Rebuilt"} in ${elapsedMs}ms`);
        if (!initial) {
          notifyLiveReloadClients();
        }
        resolve(true);
        return;
      }

      console.error(`Build failed with exit code ${code}`);
      resolve(false);
    });
  });

  return activeBuild;
}

function listen(portToTry, attempts) {
  activePort = portToTry;
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 10) {
      listen(portToTry + 1, attempts + 1);
      return;
    }
    console.error(error.message);
    shutdown(1);
  });

  server.listen(portToTry, host, () => {
    console.log(`Serving MultiMIDI at http://${host}:${portToTry}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(0);
  });
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearTimeout(rebuildTimer);
  for (const fileWatcher of fileWatchers) {
    fileWatcher.close();
  }
  if (!server.listening) {
    process.exit(exitCode);
  }
  server.close(() => {
    process.exit(exitCode);
  });
}
