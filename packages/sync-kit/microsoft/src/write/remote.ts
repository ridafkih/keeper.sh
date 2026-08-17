import type {
  IdempotencyKey,
  NotAttemptedReason,
  OperationContext,
  ProviderFailure,
  RemoteEventId,
  RemoteRef,
  RemoteVersion,
  Result,
  WritableCalendar,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";
import type { GraphCall } from "../client/graph-call";
import { graphJson } from "../client/graph-call";
import { preferHeaders } from "../client/prefer";
import {
  expandKeeperProperties,
  extendedPropertyValue,
  matchesPropertyValue,
  mirroredUidPropertyName,
} from "../decode/extended-property";
import { readIdentity } from "../decode/identity";
import { microsoftLimits } from "../limits";
import type { MicrosoftFailure } from "../errors/classify";
import { toProviderFailure } from "../errors/to-provider-failure";
import type { WriteSurroundings } from "./surroundings";

type RemoteRead =
  | { readonly kind: "found"; readonly event: GraphEvent }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

const remoteRefOf = (id: string): RemoteRef => ({
  id: { kind: "remoteEventId", value: id },
  deleteHandle: { kind: "deleteHandle", value: id },
});

const writeFailure = (
  failure: MicrosoftFailure,
  calendar: WritableCalendar,
): ProviderFailure =>
  toProviderFailure(failure, {
    operation: "write",
    account: calendar.key.account,
    calendar: calendar.key,
    scope: null,
  });

const calendarPathOf = (calendar: WritableCalendar): string =>
  `users/${calendar.key.account.value}/calendars/${calendar.key.calendar.value}`;

const eventsPathOf = (calendar: WritableCalendar): string => `${calendarPathOf(calendar)}/events`;

const eventPathOf = (calendar: WritableCalendar, event: string): string =>
  `${eventsPathOf(calendar)}/${event}`;

const mailboxesOf = (calendar: WritableCalendar): readonly string[] => [
  calendar.key.account.value,
];

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const isGraphEvent = (value: unknown): value is GraphEvent =>
  typeof value === "object" && value !== null;

const unreadableVersion: Result<WriteOutcome> = {
  ok: false,
  failure: { kind: "transport", status: null, disposition: "permanent" },
};

const versionOfEvent = (event: GraphEvent): RemoteVersion | null => {
  const reading = readIdentity(event);
  if (reading.kind !== "identified") {
    return null;
  }
  return reading.identity.version;
};

const valuesOf = (body: unknown): readonly unknown[] => {
  const held = readProperty(body, "value");
  if (!Array.isArray(held)) {
    return [];
  }
  return held;
};

const readRemoteEvent = async (
  calendar: WritableCalendar,
  target: RemoteEventId,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<RemoteRead> => {
  const answered = await surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOf(calendar),
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        {
          method: "get",
          path: eventPathOf(calendar, target.value),
          search: { $expand: expandKeeperProperties() },
          headers: preferHeaders(),
        },
        signal,
      ),
  });
  switch (answered.kind) {
    case "answered": {
      if (!isGraphEvent(answered.value)) {
        return { kind: "absent" };
      }
      return { kind: "found", event: answered.value };
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "gone") {
        return { kind: "absent" };
      }
      return { kind: "failed", failure: answered.failure };
    }
    case "notAttempted": {
      return { kind: "notAttempted", reason: answered.reason };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const candidateCeiling = microsoftLimits.idempotencyCandidateCeiling;

const carriesKey = (event: GraphEvent, key: IdempotencyKey): boolean =>
  extendedPropertyValue(event, mirroredUidPropertyName) === key.value;

const nonEmptyId = (event: GraphEvent): RemoteEventId | null => {
  if (typeof event.id !== "string" || event.id.length === 0) {
    return null;
  }
  return { kind: "remoteEventId", value: event.id };
};

const nextLinkOf = (body: unknown): string | null => {
  const link = readProperty(body, "@odata.nextLink");
  if (typeof link !== "string" || link.length === 0) {
    return null;
  }
  return link;
};

const keyedPage = (
  calendar: WritableCalendar,
  key: IdempotencyKey,
  link: string | null,
): GraphCall => {
  if (link !== null) {
    return { method: "get", path: link, headers: preferHeaders() };
  }
  return {
    method: "get",
    path: eventsPathOf(calendar),
    search: { $filter: matchesPropertyValue(mirroredUidPropertyName, key.value) },
    headers: preferHeaders(),
  };
};

const namedIdsOf = (items: readonly unknown[]): readonly RemoteEventId[] => {
  const named: RemoteEventId[] = [];
  for (const item of items) {
    if (!isGraphEvent(item)) {
      continue;
    }
    const id = nonEmptyId(item);
    if (id !== null) {
      named.push(id);
    }
  }
  return named;
};

const candidateIdsOf = (body: unknown): readonly RemoteEventId[] => namedIdsOf(valuesOf(body));

type CandidateSweep =
  | { readonly kind: "candidates"; readonly ids: readonly RemoteEventId[] }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

interface SweepStep {
  readonly calendar: WritableCalendar;
  readonly key: IdempotencyKey;
  readonly link: string | null;
  readonly found: readonly RemoteEventId[];
  readonly pagesWalked: number;
  readonly context: OperationContext;
  readonly surroundings: WriteSurroundings;
}

const sweptFrom = async (step: SweepStep): Promise<CandidateSweep> => {
  if (step.pagesWalked >= microsoftLimits.maxPages) {
    return { kind: "candidates", ids: step.found };
  }
  const call = keyedPage(step.calendar, step.key, step.link);
  const answered = await step.surroundings.requests.send<unknown>({
    operation: "write",
    mailboxes: mailboxesOf(step.calendar),
    context: step.context,
    send: (signal) => graphJson(step.surroundings.dependencies.graph, call, signal),
  });
  switch (answered.kind) {
    case "answered": {
      const found = [...step.found, ...candidateIdsOf(answered.value)];
      const following = nextLinkOf(answered.value);
      if (following === null || following === step.link || found.length >= candidateCeiling) {
        return { kind: "candidates", ids: found };
      }
      return sweptFrom({ ...step, link: following, found, pagesWalked: step.pagesWalked + 1 });
    }
    case "failed": {
      if (answered.failure.kind === "notFound" || answered.failure.kind === "gone") {
        return { kind: "candidates", ids: [] };
      }
      return { kind: "failed", failure: answered.failure };
    }
    case "notAttempted": {
      return { kind: "notAttempted", reason: answered.reason };
    }
    default: {
      return assertNever(answered);
    }
  }
};

const sweepForKey = (
  calendar: WritableCalendar,
  key: IdempotencyKey,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<CandidateSweep> =>
  sweptFrom({ calendar, key, link: null, found: [], pagesWalked: 0, context, surroundings });

const confirmedCandidate = async (
  calendar: WritableCalendar,
  key: IdempotencyKey,
  ids: readonly RemoteEventId[],
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<RemoteRead> => {
  for (const id of ids.slice(0, candidateCeiling).toReversed()) {
    const read = await readRemoteEvent(calendar, id, context, surroundings);
    if (read.kind === "failed" || read.kind === "notAttempted") {
      return read;
    }
    if (read.kind === "found" && carriesKey(read.event, key)) {
      return read;
    }
  }
  return { kind: "absent" };
};

const findByIdempotencyKey = async (
  calendar: WritableCalendar,
  key: IdempotencyKey,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<RemoteRead> => {
  const swept = await sweepForKey(calendar, key, context, surroundings);
  switch (swept.kind) {
    case "failed": {
      return { kind: "failed", failure: swept.failure };
    }
    case "notAttempted": {
      return { kind: "notAttempted", reason: swept.reason };
    }
    case "candidates": {
      return confirmedCandidate(calendar, key, swept.ids, context, surroundings);
    }
    default: {
      return assertNever(swept);
    }
  }
};

export {
  calendarPathOf,
  eventPathOf,
  eventsPathOf,
  findByIdempotencyKey,
  isGraphEvent,
  mailboxesOf,
  readRemoteEvent,
  remoteRefOf,
  unreadableVersion,
  versionOfEvent,
  writeFailure,
};
export type { RemoteRead };
