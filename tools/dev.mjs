#!/usr/bin/env node
// Live dev loop: serve the playground, launch Firefox with Clickster loaded as
// a temporary add-on, and auto-reload the extension whenever a source file
// changes. Stop with Ctrl-C.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playgroundDir = join(repoRoot, "playground");
const PORT = 8910;

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  let path = normalize(new URL(req.url, "http://localhost").pathname);
  if (path === "/") path = "/index.html";
  try {
    const body = await readFile(join(playgroundDir, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Playground:  ${url}`);
  console.log("  Launching Firefox with Clickster (temporary add-on)…\n");

  // Watch only the shipped extension files so edits to tests/tooling don't
  // trigger reloads. web-ext reinstalls the add-on on each change.
  const watched = [
    "manifest.json",
    "clickster.js",
    "popup/popup.html",
    "popup/popup.js",
  ];
  const args = [
    "web-ext",
    "run",
    "--source-dir=.",
    `--start-url=${url}`,
    // Quiet the fresh-profile first-run UI so only the playground shows.
    "--pref=browser.aboutwelcome.enabled=false",
    "--pref=browser.messaging-system.whatsNewPanel.enabled=false",
    "--pref=datareporting.policy.dataSubmissionEnabled=false",
    ...watched.flatMap((f) => ["--watch-file", f]),
  ];

  const child = spawn("npx", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  const shutdown = () => {
    child.kill("SIGTERM");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
});
