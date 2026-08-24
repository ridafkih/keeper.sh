import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The bento grid is two columns from `sm` up to `lg`, and its cells are separated
 * by a one-pixel gap over a border-coloured background. A row that is not filled
 * therefore renders as a visible blank square rather than as empty space, so the
 * cards have to add up to a whole number of rows at that width.
 */
const PAGES = [
  {
    name: "homepage",
    path: "../../../src/routes/(marketing)/index.tsx",
    from: "const MARKETING_FEATURES",
    to: "type FaqItem",
    quote: "'",
  },
  {
    name: "features page",
    path: "../../../src/routes/(marketing)/features.tsx",
    from: "const FEATURE_CARDS",
    to: "const MCP_READ_TOOLS",
    quote: '"',
  },
] as const;

function gridClassNames(page: (typeof PAGES)[number]): string[] {
  const source = readFileSync(resolve(fileURLToPath(import.meta.url), page.path), "utf-8");
  const block = source.slice(source.indexOf(page.from), source.indexOf(page.to));
  const pattern = new RegExp(`gridClassName: ${page.quote}([^${page.quote}]+)${page.quote}`, "g");

  return [...block.matchAll(pattern)].map(([, value]) => value!);
}

describe.each(PAGES)("the $name bento grid", (page) => {
  it("fills every row of the two-column layout, leaving no blank cell", () => {
    const classNames = gridClassNames(page);
    expect(classNames.length).toBeGreaterThan(0);

    const columnsUsed = classNames.reduce(
      (total, className) => total + (className.includes("sm:col-span-2") ? 2 : 1),
      0,
    );

    expect(columnsUsed % 2).toBe(0);
  });

  it("fills every row of the ten-column layout", () => {
    const spansByRow = new Map<string, number>();

    for (const className of gridClassNames(page)) {
      const row = /lg:row-start-(\d+)/.exec(className)?.[1];
      const span = /lg:col-span-(\d+)/.exec(className)?.[1];
      if (!row || !span) continue;
      spansByRow.set(row, (spansByRow.get(row) ?? 0) + Number(span));
    }

    expect(spansByRow.size).toBeGreaterThan(0);
    for (const [row, total] of spansByRow) {
      expect(`row ${row}: ${total}`).toBe(`row ${row}: 10`);
    }
  });
});
