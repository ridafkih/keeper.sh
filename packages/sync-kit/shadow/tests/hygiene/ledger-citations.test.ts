import { describe, expect, test } from "vitest";
import { packageRoot, readSource, sourceFiles } from "../support/sources";

interface Citation {
  readonly file: string;
  readonly title: string;
}

const ledgerText = (): Promise<string> => Bun.file(`${packageRoot}../LEARNINGS.md`).text();

const shadowSectionOf = (ledger: string): string => {
  const start = ledger.indexOf("# sync-shadow learnings ledger");
  const next = ledger.indexOf("\n# ", start + 1);
  if (next === -1) {
    return ledger.slice(start);
  }
  return ledger.slice(start, next);
};

const citationsIn = (section: string): readonly Citation[] =>
  [...section.matchAll(/`(tests\/[^`\s]+\.test(?:-d)?\.ts) :: ([^`]+)`/g)].flatMap((match) => {
    const [, file, title] = match;
    if (!file || !title) {
      return [];
    }
    return [{ file, title }];
  });

const titlesIn = (text: string): readonly string[] =>
  [...text.matchAll(/test\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap((match) => {
    const title = match.at(2);
    if (!title) {
      return [];
    }
    return [title];
  });

const citations = citationsIn(shadowSectionOf(await ledgerText()));

describe("the sync-shadow ledger can be walked against the suite", () => {
  test("SHADOW-I35: every cited test file exists", async () => {
    const files = new Set(await sourceFiles("tests"));
    const missing = citations.filter((citation) => !files.has(citation.file));

    expect(missing.map((citation) => citation.file)).toEqual([]);
  });

  test("SHADOW-I35: every cited test name exists verbatim in the file that is cited", async () => {
    const broken: string[] = [];
    const titlesOf = new Map<string, readonly string[]>();
    for (const citation of citations) {
      const cached = titlesOf.get(citation.file);
      const titles = cached ?? titlesIn(await readSource(citation.file));
      titlesOf.set(citation.file, titles);
      if (!titles.includes(citation.title)) {
        broken.push(`${citation.file} :: ${citation.title}`);
      }
    }

    expect(broken).toEqual([]);
  });

  test("SHADOW-I35: the walk covers the whole section, not a handful of lines", () => {
    expect(citations.length).toBeGreaterThan(60);
  });
});
