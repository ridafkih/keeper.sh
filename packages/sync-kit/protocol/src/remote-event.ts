import type { CalendarKey } from "./calendar-ref";
import type {
  DeleteHandle,
  EventUid,
  Fingerprint,
  InstallationId,
  RemoteEventId,
  RemoteVersion,
  Revision,
} from "./handles";
import type { EventTime, RecurrenceAnchor } from "./time";

const availabilityKinds = ["busy", "free"] as const;
type Availability = (typeof availabilityKinds)[number];

const visibilityKinds = ["default", "private", "public"] as const;
type Visibility = (typeof visibilityKinds)[number];

const recurrenceDialects = ["rfc5545", "providerNative"] as const;
type RecurrenceDialect = (typeof recurrenceDialects)[number];

interface RecurrencePayload {
  readonly dialect: RecurrenceDialect;
  readonly value: string;
  readonly exceptions: readonly string[];
}

interface DescribedContent {
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly availability: Availability;
  readonly visibility: Visibility;
}

type SingleOccurrenceContent = DescribedContent & {
  readonly recurrence: null;
  readonly time: EventTime;
  readonly anchor?: never;
};

type RecurringContent = DescribedContent & {
  readonly recurrence: RecurrencePayload;
  readonly anchor: RecurrenceAnchor;
  readonly time?: never;
};

type EditableContent = SingleOccurrenceContent | RecurringContent;

interface RemoteEventFacts {
  readonly id: RemoteEventId;
  readonly deleteHandle: DeleteHandle;
  readonly uid: EventUid;
  readonly calendar: CalendarKey;
  readonly revision: Revision;
  readonly version: RemoteVersion;
  readonly content: EditableContent;
  readonly fingerprint: Fingerprint;
}

type ForeignEvent = RemoteEventFacts & {
  readonly provenance: { readonly kind: "foreign" };
};

type OwnEvent = RemoteEventFacts & {
  readonly provenance: { readonly kind: "ours"; readonly installation: InstallationId };
};

type IndeterminateEvent = RemoteEventFacts & {
  readonly provenance: { readonly kind: "indeterminate" };
};

type RemoteEvent = ForeignEvent | OwnEvent | IndeterminateEvent;
type Provenance = RemoteEvent["provenance"];
type MirrorSource = ForeignEvent;

export { availabilityKinds, recurrenceDialects, visibilityKinds };
export type {
  Availability,
  DescribedContent,
  EditableContent,
  ForeignEvent,
  IndeterminateEvent,
  MirrorSource,
  OwnEvent,
  Provenance,
  RecurrenceDialect,
  RecurrencePayload,
  RecurringContent,
  RemoteEvent,
  RemoteEventFacts,
  SingleOccurrenceContent,
  Visibility,
};
