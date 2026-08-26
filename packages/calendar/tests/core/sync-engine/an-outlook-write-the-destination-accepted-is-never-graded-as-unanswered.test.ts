import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPING_ID = "mapping-1";
const MIRROR_ITEM_ID = "AAMkSyntheticMirrorId";
const MIRROR_UID = "mirror-uid-1";
const CREATED_ITEM_ID = "AAMkAGcreated";
const CREATED_UID = "created-uid";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* Nothing exotic about this event: it serializes cleanly on the update verb AND on the create
   verb, so no refusal in this file is ever ours. Every failure here is raised strictly after
   Graph answered the write with a 2xx. */
const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  startTimeZone: "UTC",
  summary: "Quarterly review — moved to Thursday",
};

interface GraphRequest {
  method: string;
  path: string;
}

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const mirrorInTheMailbox = (): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId: DESTINATION_FOLDER_ID,
  iCalUId: MIRROR_UID,
  id: MIRROR_ITEM_ID,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: "Quarterly review",
});

/*
 * The three shapes of a 2xx Graph really sends that the provider cannot turn into an event object.
 * A 204 with no body is the most ordinary acknowledgement of a PATCH there is; a plain-text 200
 * comes back from a gateway in front of Graph; and a 200 whose location.displayName is null is a
 * body arktype refuses. Every one of them is the destination saying the write landed.
 */
interface AcceptedButUnreadable {
  name: string;
  respond: (accepted: MailboxEvent) => Response;
}

const ACCEPTED_BUT_UNREADABLE: AcceptedButUnreadable[] = [
  {
    name: "204 No Content",
    respond: () => new Response(null, { status: 204 }),
  },
  {
    name: "text/plain 200",
    respond: () => new Response("OK", {
      headers: { "content-type": "text/plain" },
      status: 200,
    }),
  },
  {
    name: "200 whose location.displayName is null",
    respond: (accepted) => Response.json({ ...accepted, location: { displayName: null } }),
  },
];

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const readDirectEventId = (url: URL): string | null => {
  const segments = readPathSegments(url);
  const eventsIndex = segments.lastIndexOf("events");
  if (eventsIndex === -1) {
    return null;
  }
  const identifier = segments[eventsIndex + 1];
  if (!identifier) {
    return null;
  }
  return decodeURIComponent(identifier);
};

const readAddressedFolderId = (url: URL): string => {
  const segments = readPathSegments(url);
  const calendarsIndex = segments.lastIndexOf("calendars");
  if (calendarsIndex === -1) {
    return DEFAULT_FOLDER_ID;
  }
  const folderId = segments[calendarsIndex + 1];
  if (!folderId) {
    return DEFAULT_FOLDER_ID;
  }
  return decodeURIComponent(folderId);
};

const isCalendarListRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "calendars";
};

const isProfileRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "me";
};

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

interface SyntheticMailbox {
  held: () => MailboxEvent[];
  requests: GraphRequest[];
}

interface MailboxOptions {
  /* Which write verb Graph acknowledges with a body the provider cannot read. Everything else
     answers exactly as the real mailbox does, so nothing here is kinder than Graph. */
  unreadableOn: "PATCH" | "POST";
  variant: AcceptedButUnreadable;
}

/* A synthetic Graph mailbox that is no kinder than the real one: a DELETE of a held id really
   removes the object, a PATCH of a held id really edits it, and a POST really puts another copy
   on the calendar. The write under test is ACCEPTED - only its echo is unreadable. */
const installGraphMailbox = (options: MailboxOptions): SyntheticMailbox => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [];
  if (options.unreadableOn === "PATCH") {
    held.push(mirrorInTheMailbox());
  }
  let creations = 0;

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });

    const directId = readDirectEventId(url);

    if (method === "DELETE") {
      const index = held.findIndex((event) => event.id === directId);
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => event.id === directId);
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      target.subject = "Quarterly review — moved to Thursday";
      if (options.unreadableOn === "PATCH") {
        return Promise.resolve(options.variant.respond(target));
      }
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      creations += 1;
      const created: MailboxEvent = {
        ...mirrorInTheMailbox(),
        folderId: readAddressedFolderId(url),
        iCalUId: `${CREATED_UID}-${creations}`,
        id: `${CREATED_ITEM_ID}-${creations}`,
        subject: "Quarterly review — moved to Thursday",
      };
      held.push(created);
      if (options.unreadableOn === "POST") {
        return Promise.resolve(options.variant.respond(created));
      }
      return Promise.resolve(Response.json(created));
    }

    if (isProfileRead(url)) {
      return Promise.resolve(Response.json({ mail: "mirror-owner@synthetic.invalid" }));
    }

    if (isCalendarListRead(url)) {
      return Promise.resolve(Response.json({
        value: [
          { id: DESTINATION_FOLDER_ID, owner: { address: "mirror-owner@synthetic.invalid" } },
          { id: DEFAULT_FOLDER_ID, owner: { address: "mirror-owner@synthetic.invalid" } },
        ],
      }));
    }

    if (directId) {
      const found = held.find((event) => event.id === directId);
      if (!found) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(found));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = held.filter((event) => {
      if (event.folderId !== folderId) {
        return false;
      }
      if (uid === null) {
        return true;
      }
      return event.iCalUId === uid;
    });
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return { held: () => held.map((event) => ({ ...event })), requests };
};

const createOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: DESTINATION_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const outlookMapping = (consecutiveUpdateFailures: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  consecutiveUpdateFailures,
  deleteIdentifier: MIRROR_ITEM_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

/* The mapping as the next cycle reads it back: whatever the run wrote down, checkpointed or
   returned, applied on top of the row. Without this the counter never reaches the promotion. */
const carryMappingForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
  checkpointed: PendingChanges[],
): EventMapping => {
  const written = [
    ...(outcome.changes.updates ?? []),
    ...checkpointed.flatMap((changes) => changes.updates ?? []),
  ].find((update) => update.id === mapping.id);
  if (!written) {
    return mapping;
  }
  return { ...mapping, ...written, id: mapping.id } as EventMapping;
};

const CYCLES = 3;

interface OutlookRun {
  errors: { error: string }[];
  held: MailboxEvent[];
  requests: GraphRequest[];
}

const runThreeUpdateCycles = async (variant: AcceptedButUnreadable): Promise<OutlookRun> => {
  const mailbox = installGraphMailbox({ unreadableOn: "PATCH", variant });
  const errors: { error: string }[] = [];
  let mapping = outlookMapping(0);

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const checkpointed: PendingChanges[] = [];
    const outcome = await executeRemoteOperations(
      [replacementFor(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createOutlookProvider(),
      globalThis.undefined,
      globalThis.undefined,
      (changes: PendingChanges) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );
    errors.push(...outcome.errors);
    mapping = carryMappingForward(mapping, outcome, checkpointed);
  }

  return { errors, held: mailbox.held(), requests: mailbox.requests };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an Outlook write the destination accepted is never graded as unanswered", () => {
  /* The premise: nothing in this file is a refusal of ours. The event serializes on the very verb
     a delete-then-add would have to recreate it with, so every failure below was raised only after
     Graph had already answered 2xx and the edit had already landed. */
  it("serializes cleanly on the create verb", () => {
    expect(() => serializeOutlookEvent(editedEvent)).not.toThrow();
  });

  for (const variant of ACCEPTED_BUT_UNREADABLE) {
    describe(`when Graph acknowledges the PATCH with ${variant.name}`, () => {
      it("issues three PATCHes and nothing else across three cycles", async () => {
        const run = await runThreeUpdateCycles(variant);

        const writes = run.requests.filter((request) => request.method !== "GET");
        expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
          `PATCH /v1.0/me/events/${MIRROR_ITEM_ID}`,
          `PATCH /v1.0/me/events/${MIRROR_ITEM_ID}`,
          `PATCH /v1.0/me/events/${MIRROR_ITEM_ID}`,
        ]);
      });

      it("leaves the customer's own event standing under its own identity", async () => {
        const run = await runThreeUpdateCycles(variant);

        expect(run.held.map((event) => event.id)).toEqual([MIRROR_ITEM_ID]);
      });

      /* Silence is the other half of the failure: the operator has to be able to see that the
         provider could not read what the destination sent back. */
      it("still reports the unreadable acknowledgement to the operator", async () => {
        const run = await runThreeUpdateCycles(variant);

        expect(run.errors.length).toBeGreaterThan(0);
      });
    });
  }
});

const addOperation = (): Extract<SyncOperation, { type: "add" }> => ({
  event: editedEvent,
  type: "add",
});

const toMapping = (insert: PendingChanges["inserts"][number], index: number): EventMapping => ({
  ...insert,
  consecutiveUpdateFailures: 0,
  id: `insert-mapping-${index}`,
} as EventMapping);

interface CreateRun {
  errors: { error: string }[];
  held: MailboxEvent[];
  mappings: EventMapping[];
  requests: GraphRequest[];
}

/* Three cycles of the same pending create, driven the way the planner drives them: an event that
   the destination is already known to hold is not added again. A create whose 2xx echo could not
   be read still put the object on the customer's calendar, so a cycle that learns nothing from it
   is a cycle that POSTs a second permanent copy - Outlook's push is a create-only POST. */
const runThreeCreateCycles = async (variant: AcceptedButUnreadable): Promise<CreateRun> => {
  const mailbox = installGraphMailbox({ unreadableOn: "POST", variant });
  const errors: { error: string }[] = [];
  let mappings: EventMapping[] = [];

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    if (mappings.length > 0) {
      continue;
    }
    const checkpointed: PendingChanges[] = [];
    const outcome = await executeRemoteOperations(
      [addOperation()],
      mappings,
      DESTINATION_CALENDAR_ID,
      createOutlookProvider(),
      globalThis.undefined,
      globalThis.undefined,
      (changes: PendingChanges) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );
    errors.push(...outcome.errors);
    const inserts = [
      ...outcome.changes.inserts,
      ...checkpointed.flatMap((changes) => changes.inserts),
    ];
    mappings = inserts.map((insert, index) => toMapping(insert, index));
  }

  return { errors, held: mailbox.held(), mappings, requests: mailbox.requests };
};

describe("a create the destination accepted is resolved by reading, never by creating again", () => {
  for (const variant of ACCEPTED_BUT_UNREADABLE) {
    describe(`when Graph acknowledges the POST with ${variant.name}`, () => {
      it("posts at most once across three cycles", async () => {
        const run = await runThreeCreateCycles(variant);

        const posts = run.requests.filter((request) => request.method === "POST");
        expect(posts.map((request) => request.path)).toEqual([
          `/v1.0/me/calendars/${DESTINATION_FOLDER_ID}/events`,
        ]);
      });

      it("leaves exactly one copy on the calendar", async () => {
        const run = await runThreeCreateCycles(variant);

        expect(run.held).toHaveLength(1);
      });

      /* The mapping is what stops the next cycle: the object the destination accepted has to be
         located by reading the destination and written down under the identifier it really holds. */
      it("records a mapping naming the object the destination really holds", async () => {
        const run = await runThreeCreateCycles(variant);

        expect(run.mappings).toHaveLength(1);
        expect(run.mappings[0]?.deleteIdentifier).toBe(run.held[0]?.id);
      });
    });
  }
});
