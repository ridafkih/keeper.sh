#!/usr/bin/env bun

type Register = "a" | "b" | "c";

interface Thresholds {
  medianWords: number;
  maxSentenceWords: number;
  maxBlockSentences: number;
  checkGlossary: boolean;
}

interface Block {
  text: string;
  line: number;
  prose: boolean;
}

interface Sentence {
  text: string;
  words: number;
  line: number;
}

interface Hit {
  term: string;
  line: number;
  excerpt: string;
}

interface FileReport {
  file: string;
  words: number;
  sections: number;
  median: number;
  sentences: number;
  longSentences: number;
  longest: Sentence | null;
  longBlocks: Block[];
  hits: Hit[];
}

interface Glossary {
  terms: string[];
  allowed: string[];
}

const LONG_SENTENCE_WORDS = 30;
const LONG_BLOCK_SENTENCES = 3;
const PROSE_MINIMUM_WORDS = 12;
const EXCERPT_LENGTH = 72;
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const ENTITIES: [string, string][] = [
  ["&amp;", "&"],
  ["&nbsp;", " "],
  ["&quot;", '"'],
  ["&apos;", "'"],
  ["&#39;", "'"],
  ["&mdash;", "—"],
  ["&ndash;", "–"],
];

const CLASS_TOKEN =
  /[:[\]]|^-?[a-z]+-\d|^(?:flex|grid|hidden|absolute|relative|fixed|rounded|border|bg|text|font|gap|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|max|min|space|items|justify|overflow|col|row|z|w|h)-/;

const thresholdsFor = (register: Register): Thresholds | null => {
  if (register === "c") {
    return null;
  }
  if (register === "b") {
    return {
      medianWords: 18,
      maxSentenceWords: LONG_SENTENCE_WORDS,
      maxBlockSentences: LONG_BLOCK_SENTENCES,
      checkGlossary: false,
    };
  }
  return {
    medianWords: 15,
    maxSentenceWords: LONG_SENTENCE_WORDS,
    maxBlockSentences: LONG_BLOCK_SENTENCES,
    checkGlossary: true,
  };
};

const decode = (value: string): string => {
  let decoded = value;
  for (const [entity, replacement] of ENTITIES) {
    decoded = decoded.replaceAll(entity, replacement);
  }
  return decoded;
};

const normalise = (value: string): string =>
  decode(value).replaceAll(/\s+/g, " ").trim();

const countWords = (value: string): number =>
  value.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(“])/)
    .map((part) => part.trim())
    .filter(Boolean);

const isProse = (text: string): boolean => {
  if (countWords(text) >= PROSE_MINIMUM_WORDS) {
    return true;
  }
  return splitSentences(text).length >= 2;
};

const isCopy = (value: string): boolean => {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }
  if (value.includes("://")) {
    return false;
  }
  if (!/[A-Za-z]{3}/.test(value)) {
    return false;
  }
  const classLike = tokens.filter((token) => CLASS_TOKEN.test(token)).length;
  return classLike / tokens.length <= 0.25;
};

const lineStarts = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
};

const lineOf = (starts: number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const start = starts[middle] ?? 0;
    if (start <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
};

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

const extractCode = (source: string, starts: number[]): Block[] => {
  const blocks: Block[] = [];
  const add = (raw: string, offset: number) => {
    const text = normalise(raw);
    if (!isCopy(text)) {
      return;
    }
    blocks.push({ text, line: lineOf(starts, offset), prose: isProse(text) });
  };
  for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    add(match[2] ?? "", match.index ?? 0);
  }
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    add(match[1] ?? "", match.index ?? 0);
  }
  return blocks;
};

const extractMarkdown = (source: string, starts: number[]): Block[] => {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let offset = 0;
  let inFrontmatter = false;
  let inFence = false;
  let buffer: string[] = [];
  let bufferOffset = 0;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    const text = normalise(buffer.join(" "));
    buffer = [];
    if (!isCopy(text)) {
      return;
    }
    blocks.push({
      text,
      line: lineOf(starts, bufferOffset),
      prose: isProse(text),
    });
  };

  const push = (raw: string, at: number, prose: boolean) => {
    const text = normalise(raw);
    if (!isCopy(text)) {
      return;
    }
    blocks.push({ text, line: lineOf(starts, at), prose });
  };

  for (const [index, line] of lines.entries()) {
    const at = offset;
    offset += line.length + 1;
    const trimmed = line.trim();

    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
        continue;
      }
      const field = /^(?:title|description|blurb):\s*["'](.+)["']\s*$/.exec(
        trimmed,
      );
      if (field?.[1]) {
        push(field[1], at, true);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) {
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("|")) {
      flush();
      continue;
    }
    if (/^(?:import|export)\s/.test(trimmed)) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      flush();
      push(cleanMarkdown(trimmed.replace(/^#{1,6}\s+/, "")), at, false);
      continue;
    }
    if (/^(?:[-+*]|\d+\.)\s/.test(trimmed)) {
      flush();
    }
    const cleaned = cleanMarkdown(trimmed);
    if (!cleaned) {
      continue;
    }
    if (buffer.length === 0) {
      bufferOffset = at;
    }
    buffer.push(cleaned);
  }
  flush();
  return blocks;
};

const bodyLines = (source: string): string[] => {
  const lines = source.split("\n");
  const kept: string[] = [];
  let inFrontmatter = false;
  let inFence = false;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      kept.push(trimmed);
    }
  }
  return kept;
};

const bodyWords = (lines: string[]): number =>
  countWords(decode(lines.join(" ")).replaceAll(/\[([^\]]*)]\([^)]*\)/g, "$1"));

const sectionCount = (lines: string[]): number =>
  lines.filter((line) => /^#{2,6}\s/.test(line)).length;

const bodyMetrics = (
  source: string,
  isCode: boolean,
): { words: number; sections: number } => {
  if (isCode) {
    return { words: 0, sections: 0 };
  }
  const body = bodyLines(source);
  return { words: bodyWords(body), sections: sectionCount(body) };
};

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 !== 0) {
    return upper;
  }
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const termPattern = (term: string): RegExp => {
  const body = escapeRegExp(term).replaceAll(/\s+/g, String.raw`\s+`);
  return new RegExp(String.raw`\b${body}(?:s|es|d|ed|ing)?\b`, "gi");
};

const parseGlossary = (source: string, path: string): Glossary => {
  const lines = source.split("\n");
  const tierStart = lines.findIndex((line) => /^##\s+Tier 1\b/.test(line.trim()));
  if (tierStart === -1) {
    throw new Error(`No "## Tier 1" section found in ${path}`);
  }

  const terms: string[] = [];
  for (const line of lines.slice(tierStart + 1)) {
    const trimmed = line.trim();
    if (/^##\s/.test(trimmed)) {
      break;
    }
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cell = trimmed.split("|").slice(1, -1)[0]?.trim();
    if (!cell || /^:?-+:?$/.test(cell) || cell.toLowerCase() === "term") {
      continue;
    }
    for (const part of cell.split("/")) {
      const term = part.replaceAll(/[`*]/g, "").replaceAll(/\(.*?\)/g, "").trim();
      if (term) {
        terms.push(term);
      }
    }
  }
  if (terms.length === 0) {
    throw new Error(`Parsed no Tier 1 terms from ${path}`);
  }

  const allowedStart = lines.findIndex((line) => /^##\s+Allowed phrases\b/.test(line.trim()));
  const allowed: string[] = [];
  if (allowedStart !== -1) {
    for (const line of lines.slice(allowedStart + 1)) {
      const trimmed = line.trim();
      if (/^##\s/.test(trimmed)) {
        break;
      }
      const phrase = /^-\s+(.+)$/.exec(trimmed)?.[1]?.trim();
      if (phrase) {
        allowed.push(phrase);
      }
    }
  }
  return { terms, allowed };
};

const maskAllowed = (text: string, allowed: string[]): string => {
  let masked = text;
  for (const phrase of allowed) {
    const pattern = new RegExp(String.raw`\b${escapeRegExp(phrase)}\b`, "gi");
    masked = masked.replaceAll(pattern, (match) => " ".repeat(match.length));
  }
  return masked;
};

const excerpt = (text: string): string => {
  if (text.length <= EXCERPT_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_LENGTH - 3)}...`;
};

const collectHits = (
  block: Block,
  patterns: RegExp[],
  allowed: string[],
): Hit[] => {
  const masked = maskAllowed(block.text, allowed);
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const found = match[0].toLowerCase();
      if (seen.has(found)) {
        continue;
      }
      seen.add(found);
      hits.push({ term: match[0], line: block.line, excerpt: excerpt(block.text) });
    }
  }
  return hits;
};

const analyse = (
  file: string,
  source: string,
  patterns: RegExp[],
  glossary: Glossary,
  checkGlossary: boolean,
): FileReport => {
  const starts = lineStarts(source);
  const isCode = CODE_EXTENSIONS.some((extension) => file.endsWith(extension));
  let blocks = extractMarkdown(source, starts);
  if (isCode) {
    blocks = extractCode(source, starts);
  }

  const lengths: number[] = [];
  const longBlocks: Block[] = [];
  const hits: Hit[] = [];
  let longSentences = 0;
  let longest: Sentence | null = null;

  for (const block of blocks) {
    const parts = splitSentences(block.text);
    if (block.prose) {
      for (const part of parts) {
        const words = countWords(part);
        lengths.push(words);
        if (words > LONG_SENTENCE_WORDS) {
          longSentences += 1;
        }
        if (!longest || words > longest.words) {
          longest = { text: part, words, line: block.line };
        }
      }
      if (parts.length > LONG_BLOCK_SENTENCES) {
        longBlocks.push(block);
      }
    }
    if (checkGlossary) {
      hits.push(...collectHits(block, patterns, glossary.allowed));
    }
  }

  const metrics = bodyMetrics(source, isCode);

  return {
    file,
    words: metrics.words,
    sections: metrics.sections,
    median: median(lengths),
    sentences: lengths.length,
    longSentences,
    longest,
    longBlocks,
    hits,
  };
};

const formatReport = (report: FileReport, checkGlossary: boolean): string[] => {
  const lines = [report.file];
  if (report.words > 0) {
    lines.push(
      `  ${report.words} body words in ${report.sections} sections — check against length.md`,
    );
  }
  lines.push(
    `  ${report.sentences} sentences, median ${report.median} words`,
    `  over ${LONG_SENTENCE_WORDS} words: ${report.longSentences}`,
  );
  if (report.longest) {
    lines.push(
      `  longest: ${report.longest.words} words at ${report.file}:${report.longest.line}`,
      `    ${excerpt(report.longest.text)}`,
    );
  }
  lines.push(
    `  paragraphs over ${LONG_BLOCK_SENTENCES} sentences: ${report.longBlocks.length}`,
  );
  for (const block of report.longBlocks) {
    lines.push(`    ${report.file}:${block.line}  ${excerpt(block.text)}`);
  }
  if (checkGlossary) {
    lines.push(`  auto-fail terms: ${report.hits.length}`);
    for (const hit of report.hits) {
      lines.push(`    ${report.file}:${hit.line}  ${hit.term}  ${hit.excerpt}`);
    }
  }
  lines.push("");
  return lines;
};

const collectFailures = (
  report: FileReport,
  thresholds: Thresholds,
): string[] => {
  const failures: string[] = [];
  if (report.sentences > 0 && report.median > thresholds.medianWords) {
    failures.push(
      `${report.file}: median ${report.median} words exceeds ${thresholds.medianWords}`,
    );
  }
  if (report.longSentences > 0) {
    failures.push(
      `${report.file}: ${report.longSentences} sentence(s) over ${thresholds.maxSentenceWords} words`,
    );
  }
  if (report.longBlocks.length > 0) {
    failures.push(
      `${report.file}: ${report.longBlocks.length} paragraph(s) over ${thresholds.maxBlockSentences} sentences`,
    );
  }
  if (thresholds.checkGlossary && report.hits.length > 0) {
    failures.push(
      `${report.file}: ${report.hits.length} auto-fail glossary term(s)`,
    );
  }
  return failures;
};

const USAGE =
  "usage: bun .claude/skills/marketing-voice/scripts/readability.ts [--register=a|b|c] <file...>";

const parseArgs = (args: string[]): { register: Register; files: string[] } => {
  let register: Register = "a";
  const files: string[] = [];
  for (const arg of args) {
    const value = /^--register=(.+)$/.exec(arg)?.[1];
    if (value) {
      if (value !== "a" && value !== "b" && value !== "c") {
        throw new Error(`Unknown register "${value}". Expected a, b or c.`);
      }
      register = value;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(USAGE);
    }
    files.push(arg);
  }
  if (files.length === 0) {
    throw new Error(USAGE);
  }
  return { register, files };
};

const main = async () => {
  const { register, files } = parseArgs(Bun.argv.slice(2));
  const thresholds = thresholdsFor(register);
  const checkGlossary = thresholds?.checkGlossary === true;

  const glossaryPath = new URL("../references/glossary.md", import.meta.url)
    .pathname;
  const glossary = parseGlossary(
    await Bun.file(glossaryPath).text(),
    glossaryPath,
  );
  const patterns = glossary.terms.map(termPattern);

  const reports = await Promise.all(
    files.map(async (file) => {
      const source = await Bun.file(file).text();
      return analyse(file, source, patterns, glossary, checkGlossary);
    }),
  );

  const lines = [`Register ${register.toUpperCase()}`, ""];
  const failures: string[] = [];
  for (const report of reports) {
    lines.push(...formatReport(report, checkGlossary));
    if (thresholds) {
      failures.push(...collectFailures(report, thresholds));
    }
  }

  if (!thresholds) {
    lines.push("Register C is reported, never gated.");
  } else if (failures.length === 0) {
    lines.push("Pass.");
  } else {
    lines.push("Fail.");
    for (const failure of failures) {
      lines.push(`  ${failure}`);
    }
  }

  await Bun.write(Bun.stdout, `${lines.join("\n")}\n`);
  if (thresholds && failures.length > 0) {
    process.exit(1);
  }
};

await main();
