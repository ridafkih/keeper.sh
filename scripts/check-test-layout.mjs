import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
      continue;
    }

    if (entry.isFile()) files.push(absolutePath);
  }

  return files;
}

const files = await walk(root);
const invalid = files
  .map((filePath) => path.relative(root, filePath))
  .filter((filePath) => /(^|\/)src\/.*\.test\.tsx?$/.test(filePath.replaceAll(path.sep, "/")));

if (invalid.length > 0) {
  console.error("Tests must not live under src/. Move them to tests/.");
  for (const filePath of invalid) {
    console.error(` - ${filePath}`);
  }
  process.exit(1);
}

console.log("test layout check passed");
