import { Glob } from "bun";

const packageRoot = new URL("../../", import.meta.url).pathname;

const sourceFiles = async (directory: string): Promise<readonly string[]> => {
  const glob = new Glob("**/*.ts");
  const found: string[] = [];
  for await (const relative of glob.scan({ cwd: `${packageRoot}${directory}` })) {
    found.push(`${directory}/${relative}`);
  }
  return found.toSorted();
};

const readSource = (relative: string): Promise<string> =>
  Bun.file(`${packageRoot}${relative}`).text();

const filesMatching = async (directory: string, needle: string): Promise<readonly string[]> => {
  const files = await sourceFiles(directory);
  const matched: string[] = [];
  for (const file of files) {
    const text = await readSource(file);
    if (text.includes(needle)) {
      matched.push(file);
    }
  }
  return matched;
};

export { filesMatching, packageRoot, readSource, sourceFiles };
