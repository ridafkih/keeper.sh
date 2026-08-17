import type { BoundedSample, EchoVerdict, EditableContent, NormalizedContent } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import { readBody } from "../decode/body";
import { contentOfGraphEvent } from "../decode/decode-event";
import { createGraphZones } from "../decode/zone";
import { canonicalEncoding } from "../fingerprint";
import { withoutProviderRegion } from "./online-meeting";

const notObserved: EchoVerdict = { kind: "notObserved" };

const comparableFieldNames = [
  "title",
  "description",
  "location",
  "availability",
  "visibility",
  "occurrence",
] as const;

const describedProjection = (content: EditableContent): readonly string[] => [
  content.title,
  content.description ?? "",
  content.location ?? "",
  content.availability,
  content.visibility,
  canonicalEncoding(content),
];

const divergedFields = (
  submitted: EditableContent,
  observed: EditableContent,
): BoundedSample => {
  const left = describedProjection(submitted);
  const right = describedProjection(observed);
  const named: string[] = [];
  for (const [position, name] of comparableFieldNames.entries()) {
    if (left[position] !== right[position]) {
      named.push(name);
    }
  }
  return { sample: named, total: named.length };
};

const echoVerdictOf = (
  submitted: NormalizedContent<"microsoft">,
  readBack: GraphEvent | null,
): EchoVerdict => {
  if (readBack === null) {
    return notObserved;
  }
  const body = readBody(readBack.body ?? null);
  if (body.kind === "uncomparable" && body.reason === "bodyFormat") {
    return notObserved;
  }
  const observed = contentOfGraphEvent(withoutProviderRegion(readBack), createGraphZones());
  if (typeof observed === "string") {
    return notObserved;
  }
  if (canonicalEncoding(observed) === canonicalEncoding(submitted.content)) {
    return { kind: "matched" };
  }
  return { kind: "diverged", fields: divergedFields(submitted.content, observed) };
};

export { echoVerdictOf };
