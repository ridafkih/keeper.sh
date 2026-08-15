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
const HOMEPAGE = resolve(
  fileURLToPath(import.meta.url),
  "../../../src/routes/(marketing)/index.tsx",
);

function gridClassNames(): string[] {
  const source = readFileSync(HOMEPAGE, "utf-8");
  const block = source.slice(
    source.indexOf("const MARKETING_FEATURES"),
    source.indexOf("type FaqItem"),
  );

  return [...block.matchAll(/gridClassName: '([^']+)'/g)].map(([, value]) => value!);
}

describe("the homepage bento grid", () => {
  it("fills every row of the two-column layout, leaving no blank cell", () => {
    const classNames = gridClassNames();
    expect(classNames.length).toBeGreaterThan(0);

    const columnsUsed = classNames.reduce(
      (total, className) => total + (className.includes("sm:col-span-2") ? 2 : 1),
      0,
    );

    expect(columnsUsed % 2).toBe(0);
  });

  it("fills every row of the ten-column layout", () => {
    const spansByRow = new Map<string, number>();

    for (const className of gridClassNames()) {
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
