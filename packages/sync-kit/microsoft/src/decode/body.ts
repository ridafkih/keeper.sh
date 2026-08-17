import type { ItemBody } from "@microsoft/microsoft-graph-types";

type BodyReading =
  | { readonly kind: "comparable"; readonly text: string }
  | { readonly kind: "uncomparable"; readonly reason: "bodyFormat" | "absent" };

const readBody = (body: ItemBody | null): BodyReading => {
  if (body === null) {
    return { kind: "uncomparable", reason: "absent" };
  }
  if (body.contentType !== "text") {
    return { kind: "uncomparable", reason: "bodyFormat" };
  }
  if (typeof body.content !== "string") {
    return { kind: "uncomparable", reason: "absent" };
  }
  return { kind: "comparable", text: body.content };
};

export { readBody };
export type { BodyReading };
