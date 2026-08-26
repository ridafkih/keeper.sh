import { describe, expect, it } from "vitest";
import {
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
  remediationTestFiles,
} from "./support/identifier-guard";

const findCommentLines = (source: string) => {
  const lines: number[] = [];
  let index = 0;
  let line = 1;
  let quote: string | null = null;
  while (index < source.length) {
    const character = source[index];
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      lines.push(line);
      if (source[index + 1] === "/") {
        while (index < source.length && source[index] !== "\n") {
          index += 1;
        }
        continue;
      }
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") {
          line += 1;
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    index += 1;
  }
  return lines;
};

describe("incident remediation tests carry no customer identifier and no comment blocks", () => {
  it("places no production-shaped opaque user identifier anywhere in the guarded test corpus", async () => {
    expect(await findOpaqueIdentifierOffenders()).toEqual([]);
  });

  it("places no deletion wall-clock timestamp anywhere in the guarded test corpus", async () => {
    expect(await findWallClockTimestampOffenders()).toEqual([]);
  });

  it("keeps every test file this remediation added free of block and line comments", async () => {
    const offenders: string[] = [];
    for (const relativePath of remediationTestFiles) {
      const source = await readGuardedFile(relativePath);
      for (const line of findCommentLines(source)) {
        offenders.push(`${relativePath}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
