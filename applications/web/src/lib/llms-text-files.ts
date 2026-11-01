import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LLMS_TEXT_FILES } from "./content-paths";

export type LlmsTextFileName = (typeof LLMS_TEXT_FILES)[number];

export interface LlmsTextFile {
  content: string | null;
  fileName: LlmsTextFileName;
}

export const isLlmsTextFileName = (fileName: string): fileName is LlmsTextFileName =>
  LLMS_TEXT_FILES.some((candidate) => candidate === fileName);

export function readLlmsTextFile(contentRoot: string, fileName: LlmsTextFileName): LlmsTextFile {
  const filePath = join(contentRoot, fileName);
  const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
  return { content, fileName };
}

export const readLlmsTextFiles = (contentRoot: string): LlmsTextFile[] =>
  LLMS_TEXT_FILES.map((fileName) => readLlmsTextFile(contentRoot, fileName));
