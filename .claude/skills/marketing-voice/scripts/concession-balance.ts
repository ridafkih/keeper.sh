#!/usr/bin/env bun

interface Section {
  heading: string;
  line: number;
  words: number;
  bullets: number;
}

interface Hit {
  line: number;
  text: string;
  reason: string;
}

interface FileReport {
  file: string;
  keeper: Section | null;
  concessions: Section[];
  hits: Hit[];
}

const MAX_RATIO = 0.5;
const EXCERPT_LENGTH = 72;

const KEEPER_HEADINGS = [/^where\s+(?:is\s+)?keeper\.sh\b/i];

const CONCESSION_HEADINGS = [
  /^where\s+is\s+(?!keeper\.sh)\S.*\bbetter\b/i,
  /^where\s+\S.*\bis\s+ahead\b/i,
  /^what\s+\S.*\bhas\s+that\s+keeper\.sh\s+does\s+not\b/i,
  /^where\s+(?!keeper\.sh)\S.*\bfits\s+better\b/i,
  /^(?:buy|pick|choose|go\s+with)\b(?!.*keeper\.sh)/i,
];

const ADVOCACY_VERB =
  /\b(?:[Bb]uy|[Pp]ick|[Cc]hoose|[Gg]o\s+with)\s+([A-Z][A-Za-z0-9.-]*)/g;

const ADVOCACY_PHRASES: [RegExp, string][] = [
  [/\bthe\s+correct\s+tool\b/i, '"the correct tool"'],
  [/\bthe\s+right\s+answer\b/i, '"the right answer"'],
];

const cleanMarkdown = (line: string): string =>
  line
    .replaceAll(/!\[[^\]]*]\([^)]*\)/g, "")
    .replaceAll(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/`([^`]*)`/g, "$1")
    .replaceAll(/\*\*|__|\*|_/g, "")
    .replace(/^>\s?/, "")
    .replace(/^(?:[-+*]|\d+\.)\s+/, "")
    .trim();

const countWords = (value: string): number =>
  value.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;

const excerpt = (text: string): string => {
  if (text.length <= EXCERPT_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_LENGTH - 3)}...`;
};

const bodyLines = (source: string): (string | null)[] => {
  const lines = source.split("\n");
  const kept: (string | null)[] = [];
  let inFrontmatter = false;
  let inFence = false;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      kept.push(null);
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
      }
      kept.push(null);
      continue;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      kept.push(null);
      continue;
    }
    if (inFence) {
      kept.push(null);
      continue;
    }
    kept.push(trimmed);
  }
  return kept;
};

const isBullet = (line: string): boolean =>
  /^(?:[-+*]|\d+\.)\s/.test(line) || line.startsWith("**");

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const measureSection = (
  lines: (string | null)[],
  start: number,
): { words: number; bullets: number } => {
  let words = 0;
  let bullets = 0;
  let previousBlank = true;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line === null) {
      previousBlank = true;
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      break;
    }
    if (line === "") {
      previousBlank = true;
      continue;
    }
    words += countWords(cleanMarkdown(line));
    if (previousBlank && isBullet(line)) {
      bullets += 1;
    }
    previousBlank = false;
  }
  return { words, bullets };
};

const collectAdvocacy = (lines: (string | null)[]): Hit[] => {
  const hits: Hit[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line) {
      continue;
    }
    const text = cleanMarkdown(line.replace(/^#{1,6}\s+/, ""));
    for (const match of text.matchAll(ADVOCACY_VERB)) {
      const target = match[1] ?? "";
      if (/^Keeper\.sh\b/.test(target)) {
        continue;
      }
      hits.push({
        line: index + 1,
        text,
        reason: `advocacy verb aimed at "${target}"`,
      });
    }
    for (const [pattern, label] of ADVOCACY_PHRASES) {
      if (pattern.test(text)) {
        hits.push({ line: index + 1, text, reason: `banned phrase ${label}` });
      }
    }
  }
  return hits;
};

const analyse = (file: string, source: string): FileReport => {
  const lines = bodyLines(source);
  let keeper: Section | null = null;
  const concessions: Section[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line || !/^##\s/.test(line)) {
      continue;
    }
    const heading = cleanMarkdown(line.replace(/^##\s+/, ""));
    const measured = measureSection(lines, index);
    if (matchesAny(heading, KEEPER_HEADINGS)) {
      keeper ??= { heading, line: index + 1, ...measured };
      continue;
    }
    if (matchesAny(heading, CONCESSION_HEADINGS)) {
      concessions.push({ heading, line: index + 1, ...measured });
    }
  }

  return { file, keeper, concessions, hits: collectAdvocacy(lines) };
};

const describe = (section: Section): string =>
  `"${section.heading}" — ${section.words} words, ${section.bullets} bullets`;

const formatReport = (report: FileReport): string[] => {
  const lines = [report.file];
  if (report.keeper) {
    lines.push(
      `  Keeper.sh section at line ${report.keeper.line}: ${describe(report.keeper)}`,
    );
  } else {
    lines.push("  Keeper.sh strength section: none found");
  }
  if (report.concessions.length === 0) {
    lines.push("  concession section: none found — balance not applicable");
  }
  for (const section of report.concessions) {
    lines.push(`  concession section at line ${section.line}: ${describe(section)}`);
  }
  const [first] = report.concessions;
  if (report.keeper && first && report.keeper.words > 0) {
    const ratio = Math.round((first.words / report.keeper.words) * 100);
    lines.push(`  ratio: ${ratio}% of our section (limit ${MAX_RATIO * 100}%)`);
  }
  lines.push(`  advocacy hits: ${report.hits.length}`);
  for (const hit of report.hits) {
    lines.push(`    ${report.file}:${hit.line}  ${hit.reason}`);
    lines.push(`      ${excerpt(hit.text)}`);
  }
  lines.push("");
  return lines;
};

const collectFailures = (report: FileReport): string[] => {
  const failures: string[] = [];
  const { keeper, concessions, hits } = report;

  if (concessions.length > 1) {
    failures.push(
      `${report.file}: ${concessions.length} concession sections — merge into exactly one`,
    );
  }
  const [first] = concessions;
  if (first && !keeper) {
    failures.push(
      `${report.file}: concession section at line ${first.line} with no Keeper.sh strength section on the page`,
    );
  }
  if (first && keeper) {
    if (first.line < keeper.line) {
      failures.push(
        `${report.file}: concession at line ${first.line} comes before our case at line ${keeper.line}`,
      );
    }
    if (first.words > keeper.words * MAX_RATIO) {
      failures.push(
        `${report.file}: concession is ${first.words} words against our ${keeper.words} — over the ${MAX_RATIO * 100}% limit`,
      );
    }
    if (first.bullets > keeper.bullets) {
      failures.push(
        `${report.file}: concession has ${first.bullets} bullets against our ${keeper.bullets}`,
      );
    }
  }
  if (hits.length > 0) {
    failures.push(`${report.file}: ${hits.length} advocacy hit(s) for a competitor`);
  }
  return failures;
};

const USAGE =
  "usage: bun .claude/skills/marketing-voice/scripts/concession-balance.ts <file...>";

const main = async () => {
  const files = Bun.argv.slice(2);
  if (files.length === 0 || files.some((file) => file.startsWith("--"))) {
    throw new Error(USAGE);
  }

  const reports = await Promise.all(
    files.map(async (file) => analyse(file, await Bun.file(file).text())),
  );

  const lines: string[] = [];
  const failures: string[] = [];
  for (const report of reports) {
    lines.push(...formatReport(report));
    failures.push(...collectFailures(report));
  }

  if (failures.length === 0) {
    lines.push("Pass.");
  } else {
    lines.push("Fail.");
    for (const failure of failures) {
      lines.push(`  ${failure}`);
    }
  }

  await Bun.write(Bun.stdout, `${lines.join("\n")}\n`);
  if (failures.length > 0) {
    process.exit(1);
  }
};

if (import.meta.main) {
  await main();
}
