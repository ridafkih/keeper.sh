import { existsSync } from "node:fs";

const serverEntryUrl = new URL("../dist/server-entry/index.js", import.meta.url);

if (!existsSync(serverEntryUrl)) {
  throw new Error(
    "Missing production server entry at applications/web/dist/server-entry/index.js. Run `bun run build` before `bun run start`.",
  );
}

await import(serverEntryUrl.href);
