import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
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
let activePort = port;

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${activePort}`);
    const safePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    const targetPath = path.normalize(path.join(distDir, safePath || "index.html"));

    if (!targetPath.startsWith(distDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const filePath = await resolveFile(targetPath);
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
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

function listen(portToTry, attempts) {
  activePort = portToTry;
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 10) {
      listen(portToTry + 1, attempts + 1);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });

  server.listen(portToTry, host, () => {
    console.log(`Serving MultiMIDI at http://${host}:${portToTry}`);
  });
}
