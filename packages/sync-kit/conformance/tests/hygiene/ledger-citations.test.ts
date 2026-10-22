import { beforeAll, describe, expect, test } from "vitest";
import { caseIdsCitedBy, conformanceCaseIds, ledgerEntryOf } from "../../src/case-id";
import type { ConformanceCaseId, LedgerEntryId } from "../../src/case-id";
import { packageRoot, readSource, sourceFiles } from "../support/sources";

interface Citation {
  readonly entry: LedgerEntryId;
  readonly case: ConformanceCaseId;
  readonly file: string;
}

const ledgerText = (): Promise<string> => Bun.file(`${packageRoot}../LEARNINGS.md`).text();

const conformanceSectionOf = (ledger: string): string =>
  ledger.slice(ledger.indexOf("# sync-conformance learnings ledger"));

const isCaseId = (value: string): value is ConformanceCaseId =>
  conformanceCaseIds.some((id) => id === value);

const provingMarker = "**Proved by.**";

const provingClaimsIn = (body: string): readonly string[] =>
  body
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.includes(provingMarker))
    .map((paragraph) => paragraph.slice(paragraph.indexOf(provingMarker)));

const citationsIn = (section: string): readonly Citation[] => {
  const entries = section.split(/^### (CONF-I\d+)\./gm);
  const found: Citation[] = [];
  for (let index = 1; index < entries.length; index += 2) {
    const entry = entries.at(index);
    const body = entries.at(index + 1);
    if (!entry || !body) {
      continue;
    }
    for (const paragraph of provingClaimsIn(body)) {
      const files = [
        ...paragraph.matchAll(/`conformance\/(tests\/[^`\s]+\.test\.ts)`/g),
      ].flatMap((match) => {
        const file = match.at(1);
        if (!file) {
          return [];
        }
        return [file];
      });
      const cases = [...paragraph.matchAll(/`(CONF-[OL]\d+)`/g)].flatMap((match) => {
        const caseId = match.at(1);
        if (!caseId || !isCaseId(caseId)) {
          return [];
        }
        return [caseId];
      });
      for (const [position, caseId] of cases.entries()) {
        const file = files.at(position) ?? files.at(0);
        if (!file) {
          continue;
        }
        found.push({
          entry: `CONF-I${Number(entry.slice("CONF-I".length))}`,
          case: caseId,
          file,
        });
      }
    }
  }
  return found;
};

const titlesIn = (text: string): readonly string[] =>
  [...text.matchAll(/test\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap((match) => {
    const title = match.at(2);
    if (!title) {
      return [];
    }
    return [title];
  });

let citations: readonly Citation[] = [];

describe("the ledger can be walked against the suite", () => {
  beforeAll(async () => {
    citations = citationsIn(conformanceSectionOf(await ledgerText()));
  });

  test("CONF-I59: every cited test file exists and every case resolves to a real ledger entry", async () => {
    const section = conformanceSectionOf(await ledgerText());
    const files = new Set(await sourceFiles("tests"));
    const missing = citations.filter((citation) => !files.has(citation.file));
    const unresolved = conformanceCaseIds.filter(
      (id) => !section.includes(`### ${ledgerEntryOf(id)}.`),
    );

    expect(missing.map((citation) => citation.file)).toEqual([]);
    expect(unresolved).toEqual([]);
    expect(citations.length).toBeGreaterThan(40);
  });

  test("CONF-I59: every cited case id appears verbatim in a test title in the file that cites it", async () => {
    const broken: string[] = [];
    const titlesOf = new Map<string, readonly string[]>();
    for (const citation of citations) {
      const cached = titlesOf.get(citation.file);
      const titles = cached ?? titlesIn(await readSource(citation.file));
      titlesOf.set(citation.file, titles);
      if (!titles.some((title) => title.startsWith(`${citation.case}:`))) {
        broken.push(`${citation.file} :: ${citation.case}`);
      }
    }

    expect(broken).toEqual([]);
    expect(citations.map((citation) => ledgerEntryOf(citation.case))).toEqual(
      citations.map((citation) => citation.entry),
    );
  });

  test("CONF-I59: every declared case id is cited by the ledger entry case-id.ts names", () => {
    const cited = new Set(citations.map((citation) => citation.case));
    const uncited = conformanceCaseIds.filter((id) => !cited.has(id));
    const misattributed = conformanceCaseIds.filter(
      (id) =>
        !citations.some(
          (citation) => citation.case === id && citation.entry === ledgerEntryOf(id),
        ),
    );

    expect(uncited).toEqual([]);
    expect(misattributed).toEqual([]);
  });

  test("CONF-I59: the case-id cross-reference agrees with the ledger it claims to index", () => {
    const disagreements = citations.filter(
      (citation) => ledgerEntryOf(citation.case) !== citation.entry,
    );

    expect(disagreements.map((citation) => citation.case)).toEqual([]);
  });

  test("CONF-I59: the reverse lookup returns every case an entry cites", () => {
    const alpha = citations.at(0);
    const expected = citations
      .filter((citation) => citation.entry === alpha?.entry)
      .map((citation) => citation.case);

    expect(caseIdsCitedBy(alpha?.entry ?? "CONF-I1")).toEqual(expected);
  });
});
