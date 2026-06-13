import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

export const FIXTURE_PORT = 8907;

export function startFixtureServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(new URL(req.url, "http://localhost").pathname);
    try {
      const body = await readFile(join(fixturesDir, path));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(FIXTURE_PORT, () => resolvePromise(server));
  });
}

export function fixtureUrl(name) {
  return `http://localhost:${FIXTURE_PORT}/${name}`;
}
