import { describe, expect, it } from "vitest";
import { extractContentFaq } from "../../src/lib/content-faq";

describe("extractContentFaq", () => {
  it("reads faq-item components", () => {
    const content = '<faq>\n<faq-item question="Is it free?">Yes.</faq-item>\n</faq>';
    expect(extractContentFaq(content)).toEqual([{ answer: "Yes.", question: "Is it free?" }]);
  });

  it("reads faq-item answers as plain text", () => {
    const content = '<faq-item question="Where are the limits?">See [plans](/docs/plans-and-limits) and **pricing**.</faq-item>';
    expect(extractContentFaq(content)).toEqual([
      { answer: "See plans and pricing.", question: "Where are the limits?" },
    ]);
  });

  it("reads question headings under an FAQ section", () => {
    const content = [
      "## How it works",
      "",
      "### Not a question",
      "",
      "Ignored.",
      "",
      "## FAQ",
      "",
      "### Does it copy guests?",
      "",
      "No. See [the docs](/docs/what-a-copied-event-shows) for **what** travels.",
      "",
      "Second paragraph.",
      "",
      "### Is there a free plan?",
      "",
      "Yes.",
      "",
      "## Sources",
      "",
      "### Not a question either",
    ].join("\n");

    expect(extractContentFaq(content)).toEqual([
      {
        answer: "No. See the docs for what travels.\n\nSecond paragraph.",
        question: "Does it copy guests?",
      },
      { answer: "Yes.", question: "Is there a free plan?" },
    ]);
  });

  it("recognises longer common-questions headings", () => {
    const content = "## Common questions about syncing two calendars\n\n### Does it sync both ways?\n\nYes.";
    expect(extractContentFaq(content)).toEqual([{ answer: "Yes.", question: "Does it sync both ways?" }]);
  });

  it("returns nothing for pages without an FAQ", () => {
    expect(extractContentFaq("## Setup\n\n### Step one\n\nDo it.")).toEqual([]);
  });
});
