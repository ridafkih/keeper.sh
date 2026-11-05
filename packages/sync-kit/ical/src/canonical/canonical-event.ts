import type { EditableContent, Instant } from "@keeper.sh/sync-protocol";
import type { EventIdentity } from "../parse/identity";

interface CanonicalEvent {
  readonly identity: EventIdentity;
  readonly content: EditableContent;
  readonly cancellations: readonly Instant[];
}

const canonicalFieldOrder = [
  "title",
  "description",
  "location",
  "availability",
  "visibility",
  "time",
  "recurrence",
  "anchor",
  "cancellations",
] as const;

export { canonicalFieldOrder };
export type { CanonicalEvent };
