import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConditionRow } from "../../../../src/features/rules/components/condition-row";
import { ActionRow } from "../../../../src/features/rules/components/action-row";

describe("ConditionRow", () => {
  it("renders a valueless condition as a labelled row with a remove button", () => {
    const markup = renderToStaticMarkup(<ConditionRow condition={{ kind: "all_day" }} onChange={() => null} onRemove={() => null} />);
    expect(markup).toContain("Is All-Day");
    expect(markup).toContain('aria-label="Remove Is All-Day"');
    expect(markup).not.toContain("<input");
  });

  it("shows a title condition's value and opens empty ones for typing", () => {
    const filled = renderToStaticMarkup(
      <ConditionRow condition={{ kind: "title_contains", value: "Standup" }} onChange={() => null} onRemove={() => null} />,
    );
    expect(filled).toContain("Title Contains");
    expect(filled).toContain("Standup");
    expect(filled).not.toContain("<input");

    const empty = renderToStaticMarkup(
      <ConditionRow condition={{ kind: "title_contains", value: "" }} onChange={() => null} onRemove={() => null} />,
    );
    expect(empty).toContain("<input");
    expect(empty).toContain('aria-label="Remove Title Contains"');
  });
});

describe("ActionRow", () => {
  it("renders the rename template with its variables highlighted", () => {
    const markup = renderToStaticMarkup(
      <ActionRow action={{ kind: "rename", template: "Busy ({{calendar_name}})" }} onChange={() => null} onRemove={() => null} />,
    );
    expect(markup).toContain("Rename To");
    expect(markup).toContain("{{calendar_name}}");
    expect(markup).toContain("text-template");
    expect(markup).toContain('aria-label="Remove Rename To"');
  });

  it("renders a plain action as a labelled row", () => {
    const markup = renderToStaticMarkup(<ActionRow action={{ kind: "skip" }} onChange={() => null} onRemove={() => null} />);
    expect(markup).toContain("Don&#x27;t Copy");
  });
});
