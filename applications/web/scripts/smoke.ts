import { fileURLToPath } from "node:url";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;

const paths = Bun.argv.slice(2);

if (paths.length === 0) {
  throw new Error("Usage: bun scripts/smoke.ts <path> [path...]");
}

const port = Bun.env.PORT;

if (!port) {
  throw new Error("PORT is required, and is passed through to keeper-web.");
}

const origin = `http://127.0.0.1:${port}`;
const webRoot = fileURLToPath(new URL("..", import.meta.url));

const server = Bun.spawn(["bun", "scripts/start.ts"], {
  cwd: webRoot,
  env: Bun.env,
  stdout: "inherit",
  stderr: "inherit",
});

let exitCode: number | null = null;
void server.exited.then((code) => {
  exitCode = code;
});

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`keeper-web exited with code ${exitCode} before it accepted requests.`);
    }

    try {
      await fetch(origin, { redirect: "manual" });
      return;
    } catch {
      await Bun.sleep(READY_POLL_MS);
    }
  }

  throw new Error(`keeper-web did not accept requests within ${READY_TIMEOUT_MS} ms.`);
}

async function check(path: string): Promise<string | null> {
  const response = await fetch(new URL(path, origin));
  const landed = new URL(response.url).pathname;
  const summary = `GET ${path} -> ${response.status}${landed === path ? "" : ` (at ${landed})`}`;
  console.log(summary);

  if (response.status !== 200) return summary;
  return null;
}

try {
  await waitForServer();

  const failures: string[] = [];
  for (const path of paths) {
    const failure = await check(path);
    if (failure) failures.push(failure);
  }

  if (exitCode !== null) {
    failures.push(`keeper-web exited with code ${exitCode} while serving requests.`);
  }

  if (failures.length > 0) {
    throw new Error(`Smoke check failed:\n${failures.join("\n")}`);
  }

  console.log(`keeper-web served ${paths.length} paths with HTTP 200.`);
} finally {
  server.kill();
  await server.exited;
}
