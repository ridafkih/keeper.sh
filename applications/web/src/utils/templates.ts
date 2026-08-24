export type TemplateSegment =
  | { type: "text"; value: string }
  | { type: "variable"; name: string };

const TEMPLATE_REGEX = /\{\{(\w+)\}\}/g;

export function parseTemplate(input: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(TEMPLATE_REGEX)) {
    const index = match.index!;
    if (index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, index) });
    }
    segments.push({ type: "variable", name: match[1] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }

  return segments;
}
