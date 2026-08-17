import { describe, expect, test } from "vitest";
import { packageRoot, readSource, sourceFiles } from "../support/sources";

interface Citation {
  readonly file: string;
  readonly title: string;
}

const ledgerText = (): Promise<string> => Bun.file(`${packageRoot}../LEARNINGS.md`).text();

const microsoftSectionOf = (ledger: string): string => ledger.slice(ledger.indexOf("### MS-I1."));

const citationsIn = (section: string): readonly Citation[] =>
  [...section.matchAll(/`microsoft\/(tests\/[^`\s]+\.test(?:-d)?\.ts)\s*::\s*([^`]+)`/g)].flatMap(
    (match) => {
      const [, file, title] = match;
      if (!file || !title) {
        return [];
      }
      return [{ file, title: title.replaceAll(/\s+/g, " ").trim() }];
    },
  );

const titlesIn = (text: string): readonly string[] =>
  [...text.matchAll(/test\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap((match) => {
    const title = match.at(2);
    if (!title) {
      return [];
    }
    return [title];
  });

const citations = citationsIn(microsoftSectionOf(await ledgerText()));

describe("the ledger can be walked against the suite", () => {
  test("MS-H9: every cited test file exists", async () => {
    const files = new Set(await sourceFiles("tests"));
    const missing = citations.filter((citation) => !files.has(citation.file));

    expect(missing.map((citation) => citation.file)).toEqual([]);
  });

  test("MS-H9: every cited test name exists verbatim in the file that is cited", async () => {
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

  test("MS-H9: the walk covers the whole ledger, not a handful of lines", () => {
    expect(citations.length).toBeGreaterThan(40);
  });
});
