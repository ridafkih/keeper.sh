import { describe, expect, it } from "vitest";
import { shouldSkipEditableCommit } from "../../../../../src/components/ui/composites/navigation-menu/navigation-menu-editable-logic";

describe("shouldSkipEditableCommit", () => {
  it("skips a cleared value when the field cannot be empty", () => {
    expect(shouldSkipEditableCommit("", "Work", false)).toBe(true);
  });

  it("commits a cleared value when the field can be empty", () => {
    expect(shouldSkipEditableCommit("", "zoom room", true)).toBe(false);
  });

  it("skips an unchanged value", () => {
    expect(shouldSkipEditableCommit("Work", "Work", true)).toBe(true);
  });

  it("commits a changed value when the field cannot be empty", () => {
    expect(shouldSkipEditableCommit("Personal", "Work", false)).toBe(false);
  });
});
