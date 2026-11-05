import type {
  CalendarKey,
  Capabilities,
  ChangeListing,
  Continuation,
  EditableContent,
  Instant,
  ListingScope,
  OperationContext,
  ProviderId,
  RemoteEvent,
  Result,
  SyncCursor,
  TimeWindow,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import type { ConformanceCaseId } from "../case-id";
import { ledgerEntryOf } from "../case-id";
import type { ConformanceEnvironment, ProviderUnderTest, WriteLogEntry } from "../options";
import { violated } from "../violation";
import type { CaseContext, ConformanceCase } from "../registry/case";
import { gateFor } from "../registry/gates";

const marchWindow: TimeWindow = {
  start: { kind: "instant", value: "2026-03-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2026-04-01T00:00:00.000Z" },
};

const decadeWindow: TimeWindow = {
  start: { kind: "instant", value: "2020-01-01T00:00:00.000Z" },
  end: { kind: "instant", value: "2030-01-01T00:00:00.000Z" },
};

const invertedWindow: TimeWindow = {
  start: marchWindow.end,
  end: marchWindow.start,
};

const conformanceCalendar = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): CalendarKey => ({
  provider: supports.provider,
  account: { kind: "accountId", value: "conformance-account" },
  calendar: { kind: "calendarId", value: "conformance-calendar" },
});

const scopeOver = (calendar: CalendarKey, window: TimeWindow): ListingScope => ({
  calendar,
  window,
  expandRecurrences: true,
});

const caseScope = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  window: TimeWindow = marchWindow,
): ListingScope => scopeOver(conformanceCalendar(context.supports), window);

interface ContextOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => Instant;
  readonly deadlineMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayCeilingMs?: number;
}

const neverAborts = (): AbortSignal => new AbortController().signal;

const operationContext = (
  environment: ConformanceEnvironment,
  options: ContextOptions = {},
): OperationContext => {
  const readNow = options.now ?? environment.clock.now;
  const now = readNow();
  const budget = options.deadlineMs ?? 250;
  return {
    signal: options.signal ?? neverAborts(),
    now: readNow,
    deadline: { kind: "instant", value: new Date(Date.parse(now.value) + budget).toISOString() },
    retryBudget: {
      maxAttempts: options.maxAttempts ?? 1,
      retryDelayCeilingMs: options.retryDelayCeilingMs ?? 1,
    },
  };
};

const listChanges = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  scope: ListingScope,
  resume: SyncCursor | Continuation | null = null,
  options: ContextOptions = {},
): Promise<Result<ChangeListing>> =>
  context.provider.contract.provider.listChanges(
    { scope, resume },
    operationContext(context.environment, options),
  );

const write = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  intent: WriteIntent<Provider>,
  options: ContextOptions = {},
): Promise<Result<WriteOutcome>> =>
  context.provider.contract.provider.write(
    intent,
    operationContext(context.environment, options),
  );

const insist = (id: ConformanceCaseId, held: boolean, message: string): void => {
  if (!held) {
    throw violated(id, message);
  }
};

const listingOf = (id: ConformanceCaseId, result: Result<ChangeListing>): ChangeListing => {
  if (!result.ok) {
    throw violated(id, `the listing failed as "${result.failure.kind}" where it had to succeed`);
  }
  return result.value;
};

const outcomeOf = (id: ConformanceCaseId, result: Result<WriteOutcome>): WriteOutcome => {
  if (!result.ok) {
    throw violated(id, `the write failed as "${result.failure.kind}" where it had to succeed`);
  }
  return result.value;
};

const failureKindOf = (result: Result<unknown>): string => {
  if (result.ok) {
    return "ok";
  }
  return result.failure.kind;
};

const uidsOf = (listing: ChangeListing): readonly string[] =>
  (listing.events ?? []).map((event) => event.uid.value);

const markedWith = (id: ConformanceCaseId, name: string): string => `${id}:${name}`;

interface EventDraft {
  readonly uid: string;
  readonly start: string;
  readonly end: string;
  readonly title?: string;
  readonly revision?: number;
  readonly description?: string | null;
  readonly location?: string | null;
}

const contentOf = (draft: EventDraft): EditableContent => ({
  title: draft.title ?? draft.uid,
  description: draft.description ?? null,
  location: draft.location ?? null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: draft.start },
    end: { kind: "instant", value: draft.end },
    zone: { kind: "zoneId", value: "UTC" },
  },
});

const foreignEvent = (calendar: CalendarKey, draft: EventDraft): RemoteEvent => {
  const revision = draft.revision ?? 1;
  return {
    id: { kind: "remoteEventId", value: `id-${draft.uid}` },
    deleteHandle: { kind: "deleteHandle", value: `handle-${draft.uid}` },
    uid: { kind: "eventUid", value: draft.uid },
    calendar,
    revision,
    version: { kind: "remoteVersion", value: `v${revision}-${draft.uid}` },
    content: contentOf(draft),
    fingerprint: { kind: "fingerprint", value: `fp-${draft.uid}-${revision}` },
  provenance: { kind: "foreign" },
  };
};

interface SeedOptions {
  readonly corruptKnownRows?: readonly string[];
  readonly cancelled?: readonly string[];
  readonly unattributableRemovals?: readonly string[];
}

const seedWith = <Provider extends ProviderId>(
  context: CaseContext<Provider>,
  events: readonly RemoteEvent[],
  options: SeedOptions = {},
): Promise<void> =>
  context.provider.seed({
    events,
    corruptKnownRows: options.corruptKnownRows ?? [],
    cancelled: (options.cancelled ?? []).map((uid) => ({ kind: "eventUid", value: uid })),
    unattributableRemovals: (options.unattributableRemovals ?? []).map((id) => ({
      kind: "remoteEventId",
      value: id,
    })),
  });

const writeLogSince = async <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  from: number,
): Promise<readonly WriteLogEntry[]> => {
  const inspection = await provider.inspect();
  return inspection.writeLog.slice(from);
};

const writeLogLength = async <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
): Promise<number> => {
  const inspection = await provider.inspect();
  return inspection.writeLog.length;
};

const objectsMarked = async <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  id: ConformanceCaseId,
): Promise<readonly RemoteEvent[]> => {
  const inspection = await provider.inspect();
  return inspection.objects.filter((event) => event.uid.value.startsWith(`${id}:`));
};

const instantAfter = (from: Instant, milliseconds: number): Instant => ({
  kind: "instant",
  value: new Date(Date.parse(from.value) + milliseconds).toISOString(),
});

const defineCase = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
  id: ConformanceCaseId,
  title: string,
  run: (context: CaseContext<Provider>) => Promise<void>,
): ConformanceCase<Provider> => ({
  id,
  title: `${id}: ${title}`,
  ledger: ledgerEntryOf(id),
  gate: gateFor(id, supports),
  run,
});

export {
  caseScope,
  defineCase,
  conformanceCalendar,
  contentOf,
  decadeWindow,
  failureKindOf,
  foreignEvent,
  insist,
  instantAfter,
  invertedWindow,
  listChanges,
  listingOf,
  marchWindow,
  markedWith,
  objectsMarked,
  operationContext,
  outcomeOf,
  scopeOver,
  seedWith,
  uidsOf,
  write,
  writeLogLength,
  writeLogSince,
};
export type { ContextOptions, EventDraft, SeedOptions };
