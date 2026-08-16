import { describe, expect, it } from "vitest";
import { resolveWriteBackFieldNames, WRITE_BACK_FIELD_LABELS } from "@keeper.sh/data-schemas";
import type { WriteBackFieldExclusions } from "@keeper.sh/data-schemas";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";

const SOURCE_NAME = "Personal";

const EXCLUSION_COMBINATIONS: WriteBackFieldExclusions[] = [false, true]
  .flatMap((excludeEventName) =>
    [false, true].flatMap((excludeEventDescription) =>
      [false, true].map((excludeEventLocation) => ({
        excludeEventDescription,
        excludeEventLocation,
        excludeEventName,
      }))));

describe("what the dashboard says two-way sync writes to the source", () => {
  it("names every field the write-back payload is allowed to carry", () => {
    for (const exclusions of EXCLUSION_COMBINATIONS) {
      const { written } = buildWriteBackFieldSummary(exclusions, SOURCE_NAME);
      const undisclosed = [...resolveWriteBackFieldNames(exclusions)]
        .flatMap((field) => WRITE_BACK_FIELD_LABELS[field] ?? [])
        .filter((label) => !written.includes(label));

      expect({ exclusions, undisclosed }).toEqual({ exclusions, undisclosed: [] });
    }
  });

  it("tells a user who shows real titles that renaming a copy renames the original", () => {
    const { hidden, written } = buildWriteBackFieldSummary({
      excludeEventDescription: false,
      excludeEventLocation: false,
      excludeEventName: false,
    }, SOURCE_NAME);

    expect(written).toContain("title");
    expect(written).toContain("description");
    expect(written).toContain("location");
    expect(written).toContain(SOURCE_NAME);
    expect(hidden).toBeNull();
  });

  it("still names the hidden fields as the ones it never writes back", () => {
    const { hidden, written } = buildWriteBackFieldSummary({
      excludeEventDescription: true,
      excludeEventLocation: true,
      excludeEventName: true,
    }, SOURCE_NAME);

    expect(written).not.toContain("title");
    expect(written).not.toContain("location");
    expect(hidden).toContain("title");
    expect(hidden).toContain("description");
    expect(hidden).toContain("location");
  });
});
