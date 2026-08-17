# sync-kit learnings ledger

One file, one ledger per package. `@keeper.sh/sync-protocol` is first (entries 1–60); the
`@keeper.sh/sync-ical` ledger follows it (entries `ICAL-I1`–`ICAL-I60`). Sibling packages append their own
section rather than renumbering anyone.

## sync-protocol

Every lesson mined from `packages/calendar`, `packages/sync` and their git history, mapped to the design
element in `@keeper.sh/sync-protocol` that honours it — or marked NOT APPLICABLE with the reason.

Entries 1–33 come from the existing code and its commit history. Entries 34–43 come from provider and RFC
research. Entries 44–49 are the explicit not-applicable set. Entries 50–55 are lessons that belong to
sibling sync-kit packages, recorded here so their absence from the protocol reads as a decision.
Entries 56–60 were added after adversarial review found them missing; 60 is not applicable.

Every **Proved by** citation names a file under `packages/sync-kit/protocol/tests` and the exact test name
inside it, so the ledger can be walked against the suite mechanically.

---

## Adopted

### 1. An empty listing must never mean "the calendar is empty"

**Lesson.** A body that never opened a VCALENDAR, a CalDAV collection where every resource failed to parse,
and a failed HTTP fetch all parsed to zero events, and the snapshot diff read zero events as "delete
everything the user has".
**Learned from.** `packages/calendar/src/ics/utils/parse-ics-calendar.ts`,
`providers/caldav/shared/ics.ts`, `ics/utils/fetch-adapter.ts`; commit `0184ea19` *fix(ics): don't wipe
existing events when remote fetch fails (#383)*; test *"propagates fetch errors instead of returning empty
events"*.
**Honoured by.** `ChangeListing` is a four-member discriminated union. Only `snapshot` carries a
`CoverageWindow`, and only a `snapshot` may be passed to `DeriveSnapshotRemovals`. `partial` and
`cursorLost` declare `coverage?: never` and `removals?: never`, so an unproven read is structurally
incapable of producing a deletion. A read that fails entirely is `Result.ok === false`, never an empty
listing. **Proved by.** `deletion.test-d.ts :: DeriveSnapshotRemovals rejects a partial listing`; `deletion.test-d.ts :: DeriveSnapshotRemovals rejects a cursorLost listing`; `change-listing.test-d.ts :: a partial listing can never carry removals`.

### 2. Deletion authority differs between snapshot and delta sources

**Lesson.** A delta feed reports only changes, so absence means "unchanged"; a snapshot feed re-reports its
whole coverage, so absence means "gone". Carried as an `isDeltaSync` boolean through every diff.
**Learned from.** `core/source/event-diff.ts` (`buildSourceEventStateIdsToRemove`),
`core/sync-engine/ingest.ts` (`getNonRecurringStoredEventIdsOutsideWindow`).
**Honoured by.** The distinction is the `kind` discriminant, not a flag. `delta` carries `removals` and has
no function that accepts it together with `KnownEvents`; `snapshot` carries `coverage` and derives absence
only within it. **Proved by.** `deletion.test-d.ts :: a delta listing cannot express delete-everything-not-listed`; `deletion.test-d.ts :: an outOfScope removal never drives a deletion`.

### 3. A deletion may only be inferred inside a proven coverage window

**Lesson.** Coverage is re-read under lock and only ever narrowed mid-run; a destination with no mapped
sources gets no window at all, or a freshly imported calendar deletes every Keeper-tagged event another row
put there.
**Learned from.** `packages/sync/src/sync-user.ts:218-224, 777-792`; `coverage` on `FetchEventsResult`.
**Honoured by.** `CoverageWindow` is a required, distinctly-shaped field
(`{ covered, calendar }` — deliberately not the same shape as the requested `TimeWindow`)
on `snapshot` and `delta`, absent from `partial` and `cursorLost`. `DeriveSnapshotRemovals` takes **no**
coverage argument at all: the only window in scope is `listing.coverage`, so a caller cannot hand it a
window wider than the one the provider proved. The membership predicate arrives as an argument
(`WindowMembership`, entry 17) rather than being re-implemented per call site. What the types cannot state
is that `listing.scope.calendar`, `listing.coverage.calendar` and `known.calendar` name one calendar —
two values of one type are indistinguishable to the compiler — so that agreement is a named runtime
obligation, `ProviderConformanceSuite.deletionInputsShareOneCalendar`. **Proved by.** `change-listing.test-d.ts :: a snapshot listing cannot omit its coverage window`; `change-listing.test-d.ts :: a requested window is not a proven coverage window`; `deletion.test-d.ts :: the only coverage window a snapshot removal can use is the one the listing proved`.

### 4. An unrepresentable event must be WITHHELD, not filtered out

**Lesson.** Filtering an unparseable VEVENT out of the feed made the diff treat it as absent and delete the
stored state the user still has. Same for a recurrence series over the occurrence budget.
**Learned from.** `ics/utils/fetch-adapter.ts:394-399`, `core/sync-engine/ingest.ts:323-327`,
`core/sync/operations.ts:567-573`; tests `ics-floating-date-telemetry` *"never deletes the stored row of the
event it withholds"*.
**Honoured by.** Every `ChangeListing` variant that carries events carries a required
`withheld: readonly WithheldEvent[]`, and `DeriveSnapshotRemovals` reads its input's `withheld` as present
ids. `cursorLost` declares `withheld?: never` for the same reason it declares `events?: never` — it
observed nothing, so it withheld nothing. Withholding is cheaper to write than filtering. A withheld event
is identified by its UID **or** by the provider's own id: `WithheldIdentity` is a union, so a publisher
that stripped one of the two before deleting still has a legal shape (entry 58) and never has to be
dropped silently. **Proved by.** `deletion.test-d.ts :: withheld ids are part of the deletion-inference input`; `diagnostics.test-d.ts :: a publisher that stripped the UID before deleting still has a withheld shape`.

### 5. One bad event must not stall the whole feed

**Lesson.** A single VEVENT with an hour-based all-day DURATION, a negative DURATION, a THISANDFUTURE
override, `tzone://Microsoft/Custom` or a malformed dateTime threw out of the fetch; nothing was applied,
the delta token never advanced, and the source never converged.
**Learned from.** commit `fdd9ba62` (#634); commit `43292a9f` (#606);
`tests/ics/utils/ics-malformed-vevent-telemetry.test.ts`.
**Honoured by.** Per-event failure is `WithheldEvent` inside a *successful* listing. `ProviderFailure` is
reserved for whole-listing failures. Adapters return `Result`, never throw. **Proved by.** `provider-shape.test-d.ts :: no awaiting method returns a bare value; every one returns a Result`; `provider-failure.test-d.ts :: normalization can refuse an event without throwing or mislabelling it`.

### 6. Every discard needs a counter

**Lesson.** Ingest silently deleted rows with zero telemetry: CalDAV hardcoded `unrepresentable: 0`, ICS
reported nothing, and Keeper's own mirrors were folded into `unrepresentable` so the counter was
permanently non-zero on mirrored calendars.
**Learned from.** commit `fdd9ba62` (#634); `DiscardedSourceEventCounts` in `core/sync-engine/ingest.ts`.
**Honoured by.** `ListingDiagnostics` is a required field on all four listing kinds, with `withheld`,
`selfAuthored` and `unrepresentable` as *separate* `BoundedSample` fields. Required, so every adapter
author must answer the question. **Proved by.** `diagnostics.test-d.ts :: the counters are required, not optional`; `diagnostics.test-d.ts :: selfAuthored and unrepresentable are separate counters`.

### 7. Self-authored events must be recognised at the source read

**Lesson.** Keeper tags its own mirrors (UID suffix, PRODID); without filtering them the mirror is
re-ingested as a source event and echoed around the loop.
**Learned from.** `core/events/identity.ts` (`isKeeperEvent`, `KEEPER_EVENT_SUFFIX`); `selfAuthoredCount`
in all four fetch adapters; `RemoteEvent.isKeeperEvent`.
**Honoured by.** `RemoteEvent` is a union over provenance: `ForeignEvent | OwnEvent | IndeterminateEvent`.
Only `ForeignEvent` is assignable to the write-intent builder type. `selfAuthored` is its own diagnostics
field. **Proved by.** `provenance.test-d.ts :: an OwnEvent is not assignable to a mirror write-intent builder`; `provenance.test-d.ts :: only a ForeignEvent is a mirror source`.

### 8. Echo must be three-state

**Lesson.** A successful push with no echo verdict counts as uncomparable; a zero divergence count that
silently meant "unchecked" hid a real drift class.
**Learned from.** `core/sync-engine/index.ts` (`tallyPushEcho`), `core/events/push-echo.ts`; tests
`push-echo-attribution`, `push-echo-length-attribution`.
**Honoured by.** `EchoVerdict = matched | diverged | notObserved`, required on `created`/`updated`
outcomes, never an optional boolean. **Proved by.** `write-outcome.test-d.ts :: echo is three-state and a boolean is not assignable`; `write-outcome.test-d.ts :: a created outcome must report what the echo showed`.

### 9. A conditional write needs a real precondition and a distinct conflict outcome

**Lesson.** `PushResult { success, remoteId, error }` was too weak; `conflictResolved` had to be bolted on
as a separate counter. CalDAV refuses to recreate an object with no ETag.
**Learned from.** `providers/caldav/destination/provider.ts:120-133`; `PushResult`/`DeleteResult` in
`core/types.ts`.
**Honoured by.** `precondition` is a required field on `update`, `delete` and `retire` intents, typed as
`ObservedPrecondition` (`matchesVersion | matchesFingerprint`) — `absent` is reachable only from `create`,
so "update it whether or not it changed" and "delete whatever is there" are both unspellable, not merely
discouraged. `WriteOutcome.conflict` and `ProviderFailure.conflict` carry the observed precondition, which
for the same reason cannot be `absent`. **Proved by.** `write-intent.test-d.ts :: an update WriteIntent without a precondition does not compile`; `write-intent.test-d.ts :: an update pinned to absent is not expressible`; `write-outcome.test-d.ts :: there is no outcome in which a mismatched precondition succeeded`.

### 10. A replayed create must be a typed no-op

**Lesson.** Mirrors are written under a deterministic UID so a retried push resolves to the same object;
CalDAV re-fetches `${uid}.ics` and returns early on a content-hash match.
**Learned from.** `core/events/identity.ts` (`generateDeterministicEventUid`);
`providers/caldav/destination/provider.ts:90-118`; tests *"re-reads an unchanged feed as no work at all"*.
**Honoured by.** `create` carries a required `idempotencyKey` and a `precondition` pinned to
`{ kind: "absent" }`. `WriteOutcome` has `alreadyExists` and `unchanged` members distinct from `created`.
**Proved by.** `write-intent.test-d.ts :: a create's precondition can only be absent`; `write-intent.test-d.ts :: a create without an idempotencyKey does not compile`.

### 11. Provider identifiers are not interchangeable

**Lesson.** Google's delete endpoint takes the event id, not the iCalUID; mappings that stored the UID cost
a second batch request per delete.
**Learned from.** `core/sync/operations.ts:482-488`; `RemoteEvent { uid, deleteId }`.
**Honoured by.** Every identity in the package is a tagged handle (`{ kind; value }`), not a string alias:
`RemoteEventId`, `DeleteHandle`, `EventUid`, `RemoteVersion`, `Fingerprint`, `IdempotencyKey`, and also
`AccountId`, `CalendarId`, `InstallationId`, `Instant`, `CalendarDate` and `ZoneId`. Delete/retire intents
take a `DeleteHandle`; update takes a `RemoteEventId`; `CalendarKey`'s three members cannot be permuted;
an `Instant` cannot land in a `CalendarDate` field (entry 44). `ProviderId` is the deliberate exception:
it is the literal domain (`"google"`, `"outlook"`) every generic in the package is parameterised over, and
tagging it would forbid `CalendarProvider<"google">`. `KnownEvents.ids` is a
`ReadonlyMap<string, RemoteEventId>` rather than a `ReadonlySet<string>`, so a set of UIDs — which would
match nothing in the listing and therefore delete everything — is not assignable. **Proved by.** `identifiers.test-d.ts :: a RemoteEventId and a DeleteHandle cannot be swapped`; `identifiers.test-d.ts :: an EventUid is not a RemoteEventId`; `identifiers.test-d.ts :: an AccountId is not a CalendarId, and the three parts of a key cannot be permuted`; `identifiers.test-d.ts :: an Instant is not a CalendarDate`.

### 12. A stale cursor forces a full resync and must clear the token

**Lesson.** Advancing a delta token over a dropped payload strands every event it named. Graph tombstones
can omit the deleted event type; a sparse id may name a series master while local state holds only
instances.
**Learned from.** `providers/outlook/source/utils/fetch-events.ts:382-388`;
`providers/google/source/utils/fetch-events.ts:149`; `ingest.ts` flushing `syncToken: null`.
**Honoured by.** `cursorLost` is its own listing kind carrying `events?: never`, `removals?: never`,
`cursor?: never`, `coverage?: never`. **Proved by.** `change-listing.test-d.ts :: a cursorLost listing carries no events, no removals, no cursor and no coverage`.

### 13. A stored-state parse failure must also force a full sync

**Lesson.** When stored rows fail to parse mid-delta the engine flushes the token; diffing against
partially-parsed local state computes bogus removals.
**Learned from.** `core/sync-engine/ingest.ts:298-304`, `core/source/stored-event-state.ts`.
**Honoured by.** `cursorLost` is constructible by the *consumer*, not only returned by the provider — it is
a plain object type with no provider-private fields, so the engine can synthesise it when its own state is
unusable.

### 14. Reconciliation identity must be canonical and complete

**Lesson.** The identity key stringifies recurrence rule, exception dates, duration, timezone,
availability, all-day flag and trimmed text with sorted structured values, because *"does not diff
equivalent recurrence payloads with different key order"* and *"adds and removes when timezone changes"*
were both production bugs.
**Learned from.** `core/source/event-diff.ts` (`buildSourceEventIdentityKey`); `ics/utils/diff-events.ts`;
`tests/ics/utils/diff-events.test.ts`.
**Honoured by.** `EditableContent` is a named sub-shape holding exactly the comparable fields, separate
from provider metadata, and `Fingerprint` is a tagged handle over it. Adding a field to `EditableContent`
is the single edit; nothing else compares events structurally.

### 15. Normalization runs before reconciliation, never in the serializer

**Lesson.** Otherwise the mapping, the content hash and the bytes on the server disagree and the
destination is replaced on every run forever. The rule survives today only as a JSDoc comment on the
provider interface.
**Learned from.** `core/sync-engine/types.ts:9-11`; `providers/google/destination/normalize-event.ts`;
commit `b057d2e0` (#616).
**Honoured by.** `normalize` is a declared phase returning `NormalizedContent<P>`, and `WriteIntent<P>`
accepts nothing else. Unnormalized `EditableContent` cannot reach `write`, and content normalized for one
provider is not assignable to another's write. The comment is deleted because the type says it. **Proved by.**
`write-intent.test-d.ts :: unnormalized EditableContent cannot reach a write`; `write-intent.test-d.ts :: content normalized for one provider cannot be written to another`.

### 16. Providers refuse ranges that RFC 5545 permits, and each refuses a different set

**Lesson.** A timed VEVENT with no DTEND ends at DTSTART (RFC 5545 §3.6.1); Google 400s an empty range,
Graph refuses end-before-start, CalDAV requires DTEND strictly later. Every rejected push recomputed the
same add on every run — one calendar failed ~50 times/hour — because a rejected push records no mapping.
**Learned from.** commit `b057d2e0` (#616); the four diverged `destination/normalize-event.ts` copies.
**Honoured by.** `Capabilities.representableRange` declares `minimumSpanSeconds`, `zeroDuration`,
`invertedRange` and `allDayGrid` as data, so the engine shapes once per destination.
`WriteOutcome.unrepresentable` carries the violated constraint, so a refusal is typed and recordable rather
than a repeating failure. **Proved by.** `capabilities.test-d.ts :: the representable range is a required declaration`; `provider-failure.test-d.ts :: normalization can refuse an event without throwing or mislabelling it`.

### 17. Window membership must be one predicate shared by every layer

**Lesson.** Copies of `overlapsWindow` diverged across six call sites, each judging a range by its end, so
a zero-duration event on `timeMin` was admitted by some layers and dropped by others — a permanent
add/delete cycle.
**Learned from.** commit `b057d2e0` sub-commits; `core/events/time-range.ts`.
**Honoured by.** The protocol owns `TimeWindow`, `CoverageWindow` and the single predicate *signature*
`type WindowMembership = (window: TimeWindow, time: EventTime) => boolean`, and the one place the protocol
expresses windowing — `DeriveSnapshotRemovals` — takes that predicate as an argument rather than implying
one. A caller therefore passes the shared predicate in; it has nowhere to declare a seventh copy.
Duplication, not the rule, was the defect.

### 18. Reauthentication must be first-class and non-ignorable

**Lesson.** Reauth is detected by an `oauthReauthRequired` marker, by string-matching `invalid_grant`, or
by 401/403 on CalDAV/ICS. Retrying it burns quota and never succeeds.
**Learned from.** `core/oauth/error-classification.ts`; `CalendarFetchError.authRequired`;
`BroadcastSyncStatus.needsReauthentication`.
**Honoured by.** `ProviderFailure` has a `reauthRequired` member carrying the `AccountId`. Consumers switch
with `assertNever`, so omitting the branch fails to compile. **Proved by.** `provider-failure.test-d.ts :: a ProviderFailure switch that omits reauthRequired fails to compile`.

### 19. Never classify failures by matching error message substrings

**Lesson.** A database error message inlines the SQL and its bound parameters, so customer data could match
the backoff patterns and put a healthy destination into exponential backoff.
**Learned from.** `packages/sync/src/destination-errors.ts` (`isDatabaseError`, `BACKOFF_ERROR_PATTERNS`).
**Honoured by.** `ProviderFailure` carries a typed `kind` plus structured fields (`status`, `retryAfter`,
`scope`). There is **no** free-text `message` field anywhere in the protocol. Nothing invites
`message.includes(...)`. Adapters log detail through their own telemetry, not through the contract.

### 20. An unattempted run is neither success nor failure

**Lesson.** Escalating backoff on a superseded run punishes a healthy destination; clearing the count lets
a broken one oscillate between 1 and 0 forever. The verdict is three-state.
**Learned from.** `destination-errors.ts` (`resolveDestinationAttemptVerdict`); `destination-backoff-*`
tests.
**Honoured by.** `notAttempted` is a member of **both** `WriteOutcome` and `ProviderFailure`, carrying
`reason: "superseded" | "aborted" | "budgetExhausted"`. **Proved by.** `write-outcome.test-d.ts :: an unattempted run is neither success nor failure`.

### 21. Retries need a ceiling, provider delays need a cap, sleeps must be abortable

**Lesson.** `withBackoff` caps at 5 retries and caps `Retry-After` at 64s; `abortableSleep` rejects
immediately on an already-aborted signal, removes its listener on timeout and clears its timer on abort.
**Learned from.** `core/utils/backoff.ts`, `core/utils/fetch-with-timeout.ts`; tests *"caps the delay at 64
seconds"*, *"aborts during backoff sleep when signal is triggered"*.
**Honoured by.** Providers do not own retries. `OperationContext` carries a required
`signal: AbortSignal`, a required `deadline: Instant` and a required
`RetryBudget { maxAttempts, retryDelayCeilingMs }` with no defaults — a caller cannot forget the ceiling,
and cancellation is no longer the only bound: a socket nobody aborts still has a wall clock to answer to.
The ceiling is named for what it caps, because `ceilingMs` beside `maxAttempts` reads as a call budget and
is not one. `rateLimited` carries `retryAfter` as data rather than inviting a sleep loop.
**Proved by.** `provider-shape.test-d.ts :: OperationContext.signal cannot be omitted or undefined`; `provider-shape.test-d.ts :: an operation cannot be started without a wall-clock deadline`; `provider-shape.test-d.ts :: a RetryBudget without maxAttempts does not compile`.

### 22. Wide-event identifier lists must be a capped sample beside an uncapped count

**Lesson.** An uncapped list pushes the log line past what the pipeline keeps and takes the counters with
it. Sample 20, 2048-char cap, true total adjacent.
**Learned from.** `core/sync-engine/ingest.ts:22-27`; `sync-user.ts:338-344`; test
`ingest-wide-event-list-bounds`.
**Honoured by.** `BoundedSample = { sample: readonly string[]; total: number }` is the only shape any
diagnostic identifier list may take. A bare `string[]` is not assignable, so the count can never be lost
with the list. The cap itself — 20 entries, 2048 characters — is a contract the type states no more than
the `Fingerprint` contract states RFC 8785 (entry 29): a `readonly string[]` cannot carry a length bound.
The cap is enforced where the sample is built, in the sync-kit telemetry package (entry 55's sibling), and
is stated here as prose because pretending otherwise is how a ledger claim becomes false. **Proved by.** `diagnostics.test-d.ts :: an identifier diagnostic is never a bare array`; `diagnostics.test-d.ts :: a bounded sample keeps the total beside the sample it truncated`.

### 23. Quota must be acquired inside the retried operation

**Lesson.** A batch retry re-sends every sub-request and providers charge per attempt. Google's quota is
per user however spent; Outlook throttles per mailbox. Graph reports throttling as 429 and, for
MailboxConcurrency, as 503 with Retry-After.
**Learned from.** `providers/google/shared/batch.ts:229-234`; `core/utils/redis-rate-limiter.ts`;
`providers/outlook/shared/throttle.ts`.
**Honoured by.** `Capabilities.quotaScope` (`perUser | perMailbox | perCollection`) and
`Capabilities.throttleSignals` (`{ status, hasRetryAfter }[]`) are declarative data, so the engine picks a
limiter key with no provider-specific branch. Rate limiting itself is out of scope (see 52).

### 24. Storage bounds and mirror bounds are different windows

**Lesson.** ICS storage is deliberately unbounded; filtering the feed by the sync window would make the
snapshot diff delete every historic event's stored state on the next ingest.
**Learned from.** `ics/utils/fetch-adapter.ts:388-393`; test *"returns events far outside the sync window
so stored history stays unbounded"*.
**Honoured by.** `ListingScope.window` (requested) and `CoverageWindow` (covered) are separate fields with
different shapes. Nothing in the types encourages pre-filtering a snapshot to the requested window.

### 25. Retiring a mirror is not deleting a source event

**Lesson.** A mirror the window no longer covers stops receiving updates; the source event is retained.
Both window edges retire mappings.
**Learned from.** `core/sync/operations.ts:550-556`.
**Honoured by.** `WriteIntent` has separate `delete` (`reason: sourceDeleted | sourceUnmapped`) and
`retire` (`reason: outsideWindow | destinationDisconnected`) members.

### 26. An empty enumeration is not proof that everything was deleted

**Lesson.** Rediscovery suppresses a plan entirely when the provider returned zero calendars but rows
exist, and skips discovered calendars belonging to another account.
**Learned from.** `core/source/calendar-rediscovery.ts:149-150`; commit `877245dc` *scope provider account
identity to the owning user*.
**Honoured by.** `CalendarEnumeration` is the same shape of union: `snapshot` (authoritative) or `partial`
(retires nothing). The retire-deriving signature accepts only the `snapshot` variant. `CalendarKey` is
`{ provider, account, calendar }`, so two accounts' calendars cannot collide. The commit's actual lesson is
narrower and sharper than "add the account to the key": a *provider-issued* account id is unique only
within one Keeper user, which is why the index had to be widened to `(userId, provider, accountId)`.
`CalendarKey.account` is therefore Keeper's own account row id — already user-scoped — and never the
provider's identifier for the mailbox. That is now unforgeable rather than conventional: `AccountId` is a
tagged handle, so the provider-issued string an adapter reads off an API response is not assignable to it,
and only whoever loads the account row can mint one. **Proved by.** `change-listing.test-d.ts :: a partial calendar enumeration cannot retire calendars`; `change-listing.test-d.ts :: a calendar key is a composite that includes the owning account`.

### 27. Ordering must be decided by a stable signature, not feed order

**Lesson.** Revision ties break on the lowest slot signature; a UID whose newest revision is unbuildable
must withhold that UID entirely, because letting the superseded revision win syncs the instance to a time
the publisher already moved away from.
**Learned from.** `ics/utils/parse-ics-events.ts:156-159, 412-415`; `ics-superseded-slot-telemetry`,
`ics-stale-revision-telemetry`, `ics-revision-collapse-telemetry`.
**Honoured by.** Only the second half is honoured here. `RemoteEvent.revision` is required, so "newest
wins" is decidable from the type, and `WithholdReason` includes `supersededRevisionUnbuildable` so a UID is
suppressed rather than downgraded. The tie-break — equal revisions resolved by the lowest slot signature —
is **not** in the protocol and deliberately so: the protocol keys events by the provider's own
`RemoteEventId`, so two same-UID masters at different slots are already two distinct events and no
merge decision arises. The tie-break belongs to the ICS adapter, which is the only reader that collapses
a UID-keyed feed into events; it owns the `parse-ics-events.ts` ordering rule and the tests
*"keeps duplicate UIDs and preserves adversarial time ranges"* and *"does not merge recurring masters that
reuse a UID at different slots"*.

### 28. Our own writes come back on the next poll

**Lesson.** A destination that widened its mirror must not read as a source change.
**Learned from.** `tests/ics/degenerate-range-source-ingest.test.ts`; commit `b057d2e0`.
**Honoured by.** Same as 7, plus `Capabilities.provenanceChannel` — an adapter with no place to store a
marker must declare `"none"`, which forces `IndeterminateEvent`, which the compiler forces the consumer to
handle. The safe answer (do not echo) becomes a compiler-forced decision.

### 29. Change detection must survive key order, Date-vs-string and undefined-vs-null

**Lesson.** Otherwise every poll churns and rewrites the remote.
**Learned from.** `ics/utils/diff-events.ts` (`toStableComparableValue`); *"settles without churning the
surviving row over repeated polls"*.
**Honoured by.** `Fingerprint` is a tagged handle with a stated contract (stable under key reordering,
ISO/Date equivalence, `undefined ≡ absent`). The protocol types it and does not compute it; production
belongs to a sibling package (see 55). An `Instant` is a tagged handle over an RFC 3339 string, so a `Date`
is not assignable anywhere in the contract and the Date-vs-string comparison cannot arise.

### 30. Re-ingesting the same input twice must be no work

**Lesson.** Idempotence is tested explicitly, not assumed.
**Learned from.** `interpret-full-day-recurrence.test.ts`, `degenerate-range-source-ingest.test.ts`,
commit `a7c4be88`.
**Honoured by.** `WriteOutcome.unchanged` and `WriteOutcome.alreadyExists` make "the replay did nothing" a
typed result rather than an inferred one.

### 31. Remote I/O stays outside database transactions

**Lesson.** Telemetry emitted from inside a pooled driver's callback lands on another source's wide event.
**Learned from.** commit `1c5171d2`; `ingest.ts:191-197`.
**Honoured by.** `CalendarProvider` accepts no transaction, no database handle and no logger. Its only
ambient input is `OperationContext { signal, now, retryBudget }`. Persistence is the engine's concern.

### 32. Comments have been used to express what types should

**Lesson.** The `sync-lock` holder-prefix JSDoc is six lines explaining what a naming convention means.
**Learned from.** `packages/sync/src/sync-lock.ts`.
**Honoured by.** The package ships with zero explanatory comments. The one admissible form — an external
constraint with a citation — is reserved for provider quirks like entry 36.

### 33. A `success: boolean` is never enough

**Lesson.** Every boolean result in the existing code grew a second field within months
(`conflictResolved`, `needsReauthentication`, `fullSyncRequired`).
**Learned from.** `core/types.ts` `PushResult`, `DeleteResult`, `BroadcastSyncStatus`.
**Honoured by.** No boolean appears in any outcome or failure type — `ProviderFailure.transport` reports
`disposition: "transient" | "permanent"`, not `retryable: boolean`, so the day it needs to say
*retryable after what* it grows a member rather than a second field. Booleans survive only in
`Capabilities`, where each one is a standing declaration about a provider rather than the result of an
attempt. `Result` is a two-member union and `WriteOutcome`
has nine named members.

### 34. Graph's removal signal is ambiguous

**Lesson.** `calendarView` delta returns `@removed: { reason: "deleted" }` both for events genuinely
deleted inside the range **and** for events outside the range that were added, deleted or updated. A Graph
removal is therefore not proof of deletion.
**Learned from.** <https://learn.microsoft.com/en-us/graph/delta-query-events>.
**Honoured by.** `delta` carries `removals: readonly Removal[]` where
`Removal = { kind: "deleted"; id; uid } | { kind: "outOfScope"; id }`. Only `deleted` is assignable to the
deletion driver. Every adapter must classify — Google pays a small tax for a guard Outlook cannot live
without. `Capabilities.removalsAreAmbiguous` records which providers need the classification. **Proved by.** `deletion.test-d.ts :: an outOfScope removal never drives a deletion`; `deletion.test-d.ts :: a cancellation is deletion evidence in its own right`.

### 35. A post-410 resync carries no tombstones

**Lesson.** After `syncStateNotFound`, Graph's fresh delta cycle returns current state without tombstones
for items removed during the gap; Google's docs say the same for its 410.
**Learned from.** <https://learn.microsoft.com/en-us/graph/delta-query-overview>,
<https://developers.google.com/workspace/calendar/api/guides/sync>.
**Honoured by.** `cursorLost` carries nothing, and recovery is a `snapshot` whose removals are derivable
only within `coverage`. **Proved by.** `deletion.test-d.ts :: DeriveSnapshotRemovals rejects a cursorLost listing`.

### 36. RFC 6578 truncation is a state, not an error

**Lesson.** A truncated `sync-collection` response is 207 with 507 for the request URI and
`DAV:number-of-matches-within-limits`; it is resumed with the same sync-token. Removed members appear as a
`DAV:response` with 404 and no `DAV:propstat`.
**Learned from.** <https://www.rfc-editor.org/rfc/rfc6578.html>.
**Honoured by.** `partial` is exactly this state and carries a `Continuation`. Three independent providers
producing the same shape is the evidence that the four-member union is not over-generalisation. This is
also the archetype for the one admissible comment style: an external constraint with a citation.

### 37. Every provider has a different concurrency token

**Lesson.** Google and Graph use ETag/changeKey with `If-Match` (412 on mismatch); CalDAV uses `If-Match`
for replace and `If-None-Match: *` for create.
**Learned from.** RFC 4791, RFC 9110 §13, Graph and Google event references.
**Honoured by.** `Precondition = matchesVersion | matchesFingerprint | absent`. `absent` maps to
`If-None-Match: *` and to Google's deterministic-id create. `Capabilities.precondition` declares which
kind a provider compares against, and its type is `ObservedPrecondition["kind"]` — derived from the union
itself, so the vocabulary an adapter declares and the preconditions the engine can build are the same set
by construction. There is no separate hand-written list of kinds to drift, and no `"none"`: a provider
that compares nothing has no way to say so, because an unconditional write is the thing this entry exists
to forbid. An optional `etag?: string` is rejected for the same reason: optionality is the hole silent
overwrites arrive through.

### 38. Use provider-native idempotency

**Lesson.** Google accepts a client-supplied event id on `events.insert` and returns 409 on replay; Graph
has a write-once `transactionId`; CalDAV gets it from client-chosen paths plus `If-None-Match: *`.
**Learned from.** <https://developers.google.com/workspace/calendar/api/v3/reference/events/insert>,
<https://learn.microsoft.com/en-us/graph/api/resources/event>.
**Honoured by.** `create.idempotencyKey` is required, and `alreadyExists` is a success outcome, not an
error. The key is a tagged handle because Google's id format is constrained, so the adapter validates it.

### 39. Pagination state is not sync state

**Lesson.** Google returns `nextSyncToken` only on the final page; Graph distinguishes `@odata.nextLink`
from `@odata.deltaLink`. Confusing them silently skips changes.
**Learned from.** Google sync guide; Graph delta overview.
**Honoured by.** `SyncCursor` and `Continuation` are distinct tagged handles, mutually unassignable.
`partial` carries only a `Continuation`; `delta` carries only a `SyncCursor`. **Proved by.** `identifiers.test-d.ts :: a Continuation is not assignable to a SyncCursor and vice versa`; `change-listing.test-d.ts :: a partial listing carries neither a cursor nor a coverage window`.

### 40. A cursor is valid only for the request shape that minted it

**Lesson.** Google rejects an incremental request whose query parameters differ from the original; Graph
bakes `startDateTime`/`endDateTime` into the delta token so widening the window silently does nothing.
This directly threatens the configurable sync-window feature.
**Learned from.** Google sync guide; Graph delta-query-events.
**Honoured by.** `SyncCursor` and `Continuation` both carry a required `scope: ListingScope`. A cursor
cannot exist without the calendar and window it was minted against. The compiler cannot compare two
windows, so the engine-side rule — a widened window discards the cursor and forces a snapshot — is recorded
here as entry 53 and tested where it is implemented. **Proved by.** `change-listing.test-d.ts :: a cursor cannot exist without the scope that minted it`.

### 41. Provider representational limits must be declared, not discovered at write time

**Lesson.** Windows timezone ids, zero-duration events Google refuses, Outlook's VTIMEZONE expectations.
**Learned from.** `outlook-windows-timezone.test.ts`; commits `0111e5de`, `ac6fa18c`, `7c276d8e`,
`b057d2e0`.
**Honoured by.** `Capabilities` is a declarative record; `WriteOutcome.unrepresentable` is a typed refusal
rather than a lossy coercion. Same design element as entry 16.

### 42. Adapters must return failures, not throw them

**Lesson.** A thrown error erases the discriminated union, and reauth ends up in a generic `catch`.
**Learned from.** `core/oauth/error-classification.ts` reconstructing categories from caught errors.
**Honoured by.** Every awaiting method returns `Promise<Result<T>>`. `Result` has no `throw` variant.
**Proved by.** `provider-shape.test-d.ts :: a provider whose write resolves a bare outcome does not satisfy the contract`.

### 43. Provenance may be undetectable, and that must be sayable

**Lesson.** Google offers `extendedProperties.private`, Graph offers extensions — with current reports of
them being dropped silently. An adapter that cannot carry a marker must be able to say so.
**Learned from.** Google extended-properties guide; Graph event resource docs.
**Honoured by.** `Capabilities.provenanceChannel: "extendedProperty" | "uidSuffix" | "none"` and the
`indeterminate` provenance variant, which no write-intent builder accepts. **Proved by.** `provenance.test-d.ts :: an IndeterminateEvent is not assignable either`; `provenance.test-d.ts :: a provenance switch that omits indeterminate fails to compile`.

---

## Not applicable to this package

### 44. All-day anchoring to UTC midnight

Leaving an all-day event on a local-midnight instant, or writing a range not snapped to whole UTC days,
makes the read-back narrower than the write and the mirror is recreated every run
(`interpret-full-day-timed-events.ts`, commits `82799c5b`, `b057d2e0`).
**Not applicable.** Time-representation semantics belong to the calendar model, not the transport contract.
The protocol honours it only structurally: `EventTime` is
`{ kind: "allDay"; startDate; endDateExclusive } | { kind: "timed"; start; end; zone }`, so a DATE and a
DATE-TIME cannot be mixed and `isAllDay: boolean` beside two instants is unrepresentable. That separation
is real rather than nominal now that `Instant` and `CalendarDate` are distinct tagged handles: an RFC 3339
timestamp is not assignable to `startDate`. The anchoring
rule stays with whoever builds the events. `Capabilities.allDay` records which grid a provider expects so
the adapter, not the protocol, applies it.

### 45. DST fold and gap resolution

A wall time plus a zone does not name an instant during a fold, and RFC 5545 cannot say which pass; ts-ics
drops the time of day from a projected VTIMEZONE onset (`resolve-zoned-instants.ts`, `wall-time-*.test.ts`).
**Not applicable.** The protocol carries instants as RFC 3339 UTC strings with the zone alongside as
metadata. It never carries a bare wall time a consumer would have to resolve, so the ambiguity cannot enter
the contract. Resolution stays in `@keeper.sh/calendar`. This is a deliberate non-adoption, not an
omission.

### 46. The CalDAV BOM

`Response.text()` strips a leading UTF-8 BOM while decoding, but CalDAV `calendar-data` arrives as an XML
text node with the BOM intact, turning `BEGIN:VCALENDAR` into an unparseable property line
(`ics/utils/apply-patches.ts`).
**Not applicable.** A byte-level transport quirk with no expression in a type. Recorded because it is the
canonical example of the one admissible comment: an external constraint plus its citation.

### 47. Google's conference block

Google owns the region between its two conference delimiters and deletes its contents on write, so a
mirrored copy carrying no conference strips the region and diverges every run
(`providers/google/destination/conference-block.ts`).
**Not applicable.** A Google-adapter normalization concern. Honoured indirectly by entry 15: normalization
is a declared phase and its output is the only thing hashed and written.

### 48. Windows/CLDR timezone identifier mapping

Outlook requires Windows zone identifiers and Microsoft-shaped observances (`ac6fa18c`, `7c276d8e`).
**Not applicable.** A mapping table belonging to the Outlook adapter. The protocol carries an IANA `ZoneId`
and nothing else; `Capabilities` states the constraint exists (entry 41) without encoding the table.

### 49. Recurrence expansion and occurrence budgets

Materializing a series is expensive and bounded (`core/events/recurrence-materializer.ts`).
**Not applicable as behaviour.** The protocol carries recurrence as an opaque `RecurrencePayload`
(dialect + value + exceptions) and never expands it. Importing `rrule` or `ts-ics` here would leak a
parser's data model into the contract — exactly why today's `EventTimeSlot` cannot be reused across Google
and Graph. The budget itself surfaces only as `WithholdReason.recurrenceBudgetExceeded` (entry 4).

---

## Inherited by sibling sync-kit packages

Recorded so the review does not read their absence from a types-only package as an omission.

### 50. Single-flight coordination

The in-flight entry must be deleted in `finally`, guarded by identity so a later task is not evicted; the
losing waiter must receive the leader's failure rather than hanging; telemetry must not be written inside
the shared body, because only the joining branch runs in the joiner's async context
(`core/oauth/refresh-coordinator.ts`). **Owner:** the sync-kit coalescing package. **Required tests:**
leader throws → follower rejects; leader settles → map entry gone; concurrent calls for one key do not
interleave.

### 51. Lock and lease discipline

Locks are taken in a deterministic global order inside one transaction so a crash releases them, with both
`statement_timeout` and `idle_in_transaction_session_timeout` set; work outside the locked set supersedes
the run rather than acquiring nested locks (`core/source/ingest-lock.ts`, `packages/sync/src/sync-lock.ts`).
**Owner:** the sync-kit lease package. **Required tests:** lease released when the body throws;
deterministic acquisition order; no nested acquisition; renewal blip does not strand a run.

### 52. Rate limiting and backoff

Quota acquired inside the retried operation, `Retry-After` capped, sleeps abortable and timer-clearing
(entries 21, 23). **Owner:** the sync-kit engine. **Required tests:** provable ceiling on every retry path;
abort mid-flight rejects and cleans up; a stub that never resolves still hits a deadline. Timers use
`setTimeout` — `Bun.sleep` is native and `vi.useFakeTimers` cannot patch it, which cost this team real CI
time.

### 53. Cursor invalidation on window change

A widened sync window must discard the stored cursor and force a snapshot (entry 40). **Owner:** the
engine, because it compares the stored `ListingScope` with the requested one. The protocol makes the
comparison possible by requiring `scope` on every cursor.

### 54. Consumer-side full resync

A stored-state parse failure forces `cursorLost` from the consumer side (entry 13). **Owner:** the engine.

### 55. Fingerprint computation

RFC 8785 (JCS) is the standard answer for deterministic JSON: lexicographic key sort by UTF-16 code unit,
whitespace stripped, Ryū number normalisation. `packages/calendar` currently hand-rolls a subset in
`diff-events.ts` *and* depends on `fast-json-stable-stringify` — two implementations of one idea.
**Owner:** a single sibling package. The protocol declares the `Fingerprint` contract (entry 29) and
exports a conformance suite as types; it cannot enforce the contract at compile time and says so.

---

## Added after adversarial review

### 56. A cancelled event is not an absent event

**Lesson.** Google's incremental sync reports a deletion as an event whose `status` is `cancelled`, not as
a separate removals collection, and an ICS feed can carry a cancelled VEVENT inside an otherwise complete
body. The ICS parser turns a cancelled recurrence override into a master exception and drops a cancelled
master together with all of its detached overrides — meaning a cancellation is a first-class input to the
diff, never something to filter out.
**Learned from.** `packages/calendar/tests/ics/utils/parse-ics-events.test.ts` *"turns a cancelled
recurrence override into a master exception"*, *"drops a cancelled master and all of its detached
overrides"*; <https://developers.google.com/workspace/calendar/api/guides/sync>.
**Honoured by.** `Removal` has a third member, `{ kind: "cancelled"; id; uid }`, and both authoritative
listing kinds — `snapshot` as well as `delta` — carry a required `removals`. Before this, a snapshot
containing a cancelled event had no legal encoding: an adapter had to either publish it as a live event
(mirroring a cancellation forever) or filter it out, which entry 4 identifies as the direct cause of a
wrongful deletion. `AuthoritativeRemoval = deleted | cancelled` is what drives a deletion; `outOfScope`
still drives nothing.
**Proved by.** `deletion.test-d.ts :: a cancellation is deletion evidence in its own right`;
`change-listing.test-d.ts :: a cancelled event has somewhere to go in both authoritative listing kinds`.

### 57. A recurring master is wall time plus a zone, and its duration may be nominal

**Lesson.** RFC 5545 durations in weeks and days are *nominal* — added in wall time and re-resolved
through the zone, so a "one day" occurrence is 23 or 25 hours across a DST transition — while hours,
minutes and seconds are exact. A master pinned to two absolute instants with an optional zone cannot be
expanded correctly, and an exact 24-hour duration is indistinguishable from a nominal one-day duration.
**Learned from.** `packages/calendar/src/ics/utils/recurrence-duration.ts`; `parse-ics-events.test.ts`
*"distinguishes exact DTEND duration from nominal DURATION"*; the `wall-time-*` sweeps;
`build-vtimezone.test.ts` *"does not let an old event truncate timezone rules for current and future
events"*.
**Honoured by.** `EditableContent` is a union rather than a record with a nullable `recurrence`. A
recurring event carries a `RecurrenceAnchor` and no `time`; its timed variant requires a non-null `zone`
and an explicit `OccurrenceDuration` (`exact` seconds or `nominal` days), and its all-day variant admits
only a nominal duration. A one-off event carries `time` and no anchor. Entry 45 keeps wall-time
*resolution* out of the protocol; this entry keeps the wall time and zone *in* it, because for a master
they are the payload rather than a derived view.
**Proved by.** `content-time.test-d.ts :: a series cannot be pinned to instants alone`;
`content-time.test-d.ts :: a timed series anchor cannot omit its zone`;
`content-time.test-d.ts :: a nominal duration is not an exact one`.

### 58. A discarded event may be missing the very identifier you would log it by

**Lesson.** Feed publishers strip DTSTART, and sometimes UID, from an event immediately before deleting
it, so the discard telemetry has to count events that cannot be named the usual way.
**Learned from.** `packages/calendar/tests/ics/utils/ics-discard-telemetry.test.ts` *"counts an event the
feed publisher stripped DTSTART from before deleting it"*, *"counts an event the feed publisher stripped
UID from before deleting it"*.
**Honoured by.** `WithheldEvent`'s identity is a union: UID present with the provider id optional, or the
provider id present with the UID explicitly null. Neither is individually required and neither may be
absent at once, so a UID-less discard is constructible and an unidentifiable one is not — an adapter is
never forced into the silent drop of entry 4. `withholdReasons` gains `missingIdentity` and
`unsupportedRecurrenceRange`, the latter for the THISANDFUTURE case entry 5 cites in its own lesson text
but had no reason code for.
**Proved by.** `diagnostics.test-d.ts :: a publisher that stripped the UID before deleting still has a
withheld shape`; `diagnostics.test-d.ts :: a recurrence range an adapter refuses to reinterpret is a named
reason`.

### 59. Discovered access must survive to the write

**Lesson.** Enumeration learns whether a calendar is writable and the fact was then discarded; a write to
a read-only calendar is expressible everywhere downstream.
**Learned from.** Adversarial review of this package's own first draft, where `CalendarRef.access` was
carried through enumeration and then had no consumer; the same shape as entry 26's "discovered, then
discarded" family. No prior commit is cited because the existing engine never attempts a write to a
calendar it enumerated as read-only — the protocol should not be the first place that becomes possible.
**Honoured by.** Every `WriteIntent` variant takes a `WritableCalendar` (`{ key, access: "readWrite" }`),
not a bare `CalendarKey`. Constructing one from a `CalendarRef` requires narrowing `access`, which is a
guard the compiler forces rather than an assertion the author may skip — the package contains no type
assertions, so there is no other way to obtain one.
**Proved by.** `write-intent.test-d.ts :: a calendar we only ever read cannot be written to`.

### 60. Lenient parsing and property-level repair

Publishers ship all-day events without `VALUE=DATE`, EXDATE lists without it, folded property lines, and
8-digit strings that are not real dates; the parser repairs conservatively, leaves compliant feeds
byte-identical, and rejects what it cannot repair
(`ics/utils/lenient-parser.ts`, `ics/utils/apply-patches.ts`, the `coerce-compliant-date` patch).
**Not applicable.** Repair happens strictly below the contract: it is how an adapter turns bytes into a
`RemoteEvent` at all. The protocol's only surface for the outcome is `WithholdReason.unparseable` — what
could not be repaired is withheld, never filtered (entry 4) and never thrown (entry 42). Encoding the
repair rules here would pull one publisher's malformations into every provider's contract, the same
mistake as entry 49.

---
---

# sync-ical learnings ledger

`@keeper.sh/sync-ical` at `packages/sync-kit/ical`: RFC 5545 parsing, canonical projection and hashing.

Entry 60 of the protocol ledger above says lenient parsing happens "strictly below the contract". This is
that place, and this is its ledger. Numbering is prefixed `I` so sibling packages can append without
renumbering anyone. Every entry states the lesson, where it was learned, and the module plus the named test
that honours it — or NOT APPLICABLE with the reason.

`ICAL-I1` through `ICAL-I45` are adopted. `ICAL-I46` through `ICAL-I52` are not applicable and say why.
`ICAL-I53` through `ICAL-I60` are the dependency and process decisions, recorded because "what we rejected"
is a learning that is otherwise lost the moment the branch merges. `ICAL-I61` through `ICAL-I71`, at the
end, are what adversarial review found the entries above claiming and the code not doing; each names the
entry it belongs to. The test id scheme those entries cite — and the `ICAL-O` (overwrite) and `ICAL-L`
(lockup) indexes — is documented in the same closing section.

## Module map referenced below

```
src/text/       bytes → content lines: bom, fold (75 octets), property-line, component-walk, patch, patches/*
src/zone/       identifiers, offsets, wall time, transitions, VTIMEZONE read + synthesis, zone-cache
src/parse/      document → per-VEVENT outcomes: identity, revision order, duration, end-time, floating,
                cancellation, recurrence-support, self-authored, diagnostics
src/canonical/  projection + encoding + hashing + the one window predicate
src/listing/    feed → protocol ChangeListing (snapshot only), present vs usable
src/serialise/  canonical → one VCALENDAR resource per recurrence set
```

## Adopted

### ICAL-I1. An unreadable body is not an empty calendar

**Lesson.** A failed fetch, an unreadable body and a body that never opened a `VCALENDAR` all parsed to zero
events, and the snapshot diff read zero events as "the user deleted everything".
**Learned from.** commit `0184ea19` *fix(ics): don't wipe existing events when remote fetch fails (#383)*;
`ics/utils/parse-ics-calendar.ts`; `ics/utils/fetch-adapter.ts`.
**Honoured by.** `src/parse/parse-calendar.ts` returns `IcsDocument = readable | unreadable`, and
`unreadable` carries no events field at all. `src/listing/project-feed.ts` maps `unreadable` to
`Result.ok === false` (`ProviderFailure.transport`), never to a listing. The only `ChangeListing` this
package can build is `snapshot`, and it is built only from `readable`.
**Proved by.**
`tests/listing/no-wipe.test.ts :: ICAL-O1: a body with no BEGIN:VCALENDAR never produces a listing`;
`tests/listing/no-wipe.test.ts :: ICAL-O1: an HTML error page is refused rather than read as a calendar with no events`;
`tests/listing/no-wipe.test.ts :: ICAL-O2: an empty body is unreadable, not an empty snapshot`;
`tests/listing/no-wipe.test.ts :: ICAL-O2: a truncated response is unreadable rather than an authoritative deletion`;
`tests/listing/no-wipe.test.ts :: ICAL-O3: a well-formed VCALENDAR with zero VEVENTs is an authoritative empty snapshot`.

### ICAL-I2. Per-VEVENT parsing is total

**Lesson.** An all-day `DURATION` expressed in hours, a negative `DURATION` and a `THISANDFUTURE` override
each threw out of the whole parse, so ingest failed before the diff and the feed never converged. On CalDAV
every `href` is merged into one calendar first, so one bad resource took the user's whole collection.
**Learned from.** commit `fdd9ba62` (#634); `parse-ics-events.ts` `resolveEventEndTime`
("Total by design: throwing here would drop the whole calendar, not the one VEVENT").
**Honoured by.** `src/parse/parse-vevent.ts` returns
`VeventOutcome = parsed | withheld | selfAuthored`. No feed value can make it throw: durations are bounded
in `src/parse/duration.ts`, impossible dates and clock times are refused in `src/parse/date-value.ts`, and
years the platform renders outside four digits are read by the widened wall-clock reader in
`src/zone/offset.ts`. The only throw it can raise is `IcsInternalDataError` on a broken invariant of our own
(ICAL-I42). Only `src/parse/parse-calendar.ts` refuses a document, and only a structurally unreadable one
(I1).
**Proved by.**
`tests/parse/per-vevent-isolation.test.ts :: ICAL-I2: ${shape.name} never fails the whole feed`;
`tests/parse/per-vevent-isolation.test.ts :: ICAL-I2: parseVevent is total and has no throw path`;
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd nominal duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd exact duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O47: a year outside the four-digit range in a zoned event does not abort the feed`.

### ICAL-I3. Present and usable are different sets

**Lesson.** Every data-loss incident here had one shape: something excluded from writes was also excluded
from presence, so the snapshot diff read it as deleted and destroyed the stored row.
**Learned from.** `ics/utils/fetch-adapter.ts` `unsupportedEventUids`; tests *"never deletes the stored row
of the event it withholds"*, *"applies a real deletion arriving in the same feed"*.
**Honoured by.** `IcsFeedProjection` carries `present: readonly EventIdentity[]` and
`usable: readonly EventIdentity[]` as separate fields, and `src/listing/project-feed.ts` populates the
protocol's `snapshot.withheld` from `present \ usable` — every identity that is present without being
mirrorable, whatever kept it out. That set has three members: a withheld outcome (its own reason), one of
our own mirrors (`reason: "selfAuthored"`, added to the protocol's `withholdReasons` for this), and a slot a
versioned master superseded (`reason: "supersededRevisionUnbuildable"`). Withheld entries carry the precise
identity key as their `RemoteEventId`, so a slot and a master of one UID are distinguishable downstream. The
only present identities absent from `withheld` are the ones named by `events` or by a `cancelled` removal
(ICAL-I9), which the presence test asserts exhaustively.
**Proved by.**
`tests/listing/withheld-is-present.test.ts :: ICAL-O4: a withheld event is present and is never named by a removal`;
`tests/listing/withheld-is-present.test.ts :: ICAL-O4: presence and usability are separate sets, not one filtered list`;
`tests/listing/withheld-is-present.test.ts :: ICAL-O4: the withheld identity is keyed the same way the diagnostics key it`;
`tests/listing/withheld-is-present.test.ts :: ICAL-O5: a real deletion arriving in the same feed as a malformed VEVENT is still applied`;
`tests/listing/present-not-usable.test.ts :: ICAL-O50: two distinct unversioned slots both survive rather than one silently winning`;
`tests/listing/present-not-usable.test.ts :: ICAL-O50: a slot a versioned master supersedes is named on the listing, not merely absent`;
`tests/listing/present-not-usable.test.ts :: ICAL-O51: a cancelled event reaches the listing as a removal, never as a silent absence`;
`tests/listing/present-not-usable.test.ts :: ICAL-O51: every present identity is an event, a removal or a withheld entry`;
`tests/listing/diagnostics-bounds.test.ts :: ICAL-I3: capping the diagnostic sample never caps the presence set`.

### ICAL-I4. Every drop needs a counter, and self-authored is not unrepresentable

**Lesson.** A dropped VEVENT reads downstream as a deletion. Folding Keeper's own mirrors into the
unrepresentable counter left it permanently non-zero on mirrored calendars, so it stopped meaning anything.
**Learned from.** commit `fdd9ba62`; `parse-ics-events.ts` `countDiscardedIcsEvents`;
`ics-discard-telemetry.test.ts`.
**Honoured by.** `src/parse/diagnostics.ts` builds the protocol's `ListingDiagnostics` with `withheld`,
`selfAuthored` and `unrepresentable` as three separate `BoundedSample`s.
**Proved by.**
`tests/parse/self-authored.test.ts :: ICAL-O12: a feed of purely self-authored events yields zero usable events`;
`tests/parse/self-authored.test.ts :: ICAL-O12: the self-authored count matches the event count and is separate from unrepresentable`.

### ICAL-I5. Diagnostics are per-identity and idempotent across polls

**Lesson.** Counting per-VEVENT rather than per-identity made a stable feed report a different number every
run and churned the surviving stored row. This regression has been fixed at least three times.
**Learned from.** tests *"keeps reporting the discard on every later run and never churns the row"*,
*"converges over repeated polls of the same malformed feed"*.
**Honoured by.** Every counter in `src/parse/diagnostics.ts` is a `Set` keyed on
`eventIdentityKey(identity)`, net of identities that still produced a canonical event.
**Proved by.**
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-O22: the second poll reports identical diagnostics`;
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-O22: the second poll produces an empty diff against the first`;
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-I5: diagnostics are keyed on the event identity, not counted per VEVENT occurrence`;
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-I5: repeating the identical malformed VEVENT does not inflate the total`.

### ICAL-I6. Duplicate-UID collision is resolved by a deterministic total order, never by feed order

**Lesson.** An unordered publisher deleted and re-created the stored row on every poll. Revision order is
SEQUENCE, then LAST-MODIFIED, then DTSTAMP, then CREATED, tie-broken on the lowest slot signature.
**Learned from.** `parse-ics-events.ts` `selectGroupRevision` / `isNewerEventRevision`;
`ics-revision-collapse-telemetry`.
**Honoured by.** `src/parse/revision-order.ts` exports `compareEventRevisions`, a pure total-order
comparator whose final tiebreak is the canonical fingerprint itself, so even equal-SEQUENCE,
equal-timestamp duplicates order deterministically. `src/listing/project-feed.ts` is its only caller and is
order-independent by construction (a sort over that comparator, not a scan); the revision race runs *within*
one identity key, so two distinct slots of one UID never race each other (ICAL-I8). A non-integer `SEQUENCE`
is read as absent rather than as `NaN`, because `NaN` compares false against everything and that is how a
stale write slips past a version check. The `RemoteEvent.revision` we export is deliberately the SEQUENCE
alone (0 when the publisher states none): the four-key order is resolved here, inside sync-ical, and the
exported number is only the publisher's own claim.
**Proved by.**
`tests/parse/identity.test.ts :: ICAL-O8: a later versioned master does not resurrect an unversioned slot`;
`tests/parse/identity.test.ts :: ICAL-O8: the two slots are superseded, not merged into the master`;
`tests/parse/revision-order.test.ts :: ICAL-O7: every permutation of the colliding revisions selects the same survivor`;
`tests/parse/revision-order.test.ts :: ICAL-O7: exactly one canonical event survives, so a poll cannot delete and re-create the row`;
`tests/parse/revision-order.test.ts :: ICAL-I6: the tiebreak is the canonical fingerprint, so equal revisions still order totally`.

### ICAL-I7. An unbuildable NEWEST revision withholds its whole UID

**Lesson.** Dropping the unbuildable newest revision let the superseded one win, so the event synced at the
time the publisher had already moved it away from — silently, with no counter.
**Learned from.** commit `fdd9ba62`; `parse-ics-events.ts` `collectStaleRevisions` (line 413).
**Honoured by.** `src/parse/select-revision.ts` collects unbuildable candidates *before* selection and
compares them against the winner; a newer unbuildable candidate yields
`{ kind: "withheld", reason: "supersededRevisionUnbuildable" }` (the protocol's own reason code) for the
whole identity.
**Proved by.**
`tests/parse/stale-revision.test.ts :: ICAL-O6: the UID is withheld rather than reverted to the time the publisher moved it away from`;
`tests/parse/stale-revision.test.ts :: ICAL-O6: no canonical event carries the superseded 09:00 start`;
`tests/parse/stale-revision.test.ts :: ICAL-O6: the withheld UID is still present, so the stored row is not deleted`;
`tests/parse/stale-revision.test.ts :: ICAL-O6: reordering the two revisions in the feed does not let the older one win`.

### ICAL-I8. Identity has three shapes and none of them is the bare UID

**Lesson.** Publishers reuse one UID for genuinely distinct events at different slots. Unversioned events
key on `uid|slot|start|end`, versioned masters on `uid|master`, overrides on `uid|<RECURRENCE-ID instant>`.
A later versioned master supersedes unversioned slots but must not resurrect them.
**Learned from.** `parse-ics-events.ts` `buildEventRevisionIdentity` / `survivesAuthoritativeMaster`; tests
*"does not merge recurring masters that reuse a UID at different slots"*, *"does not resurrect an
unversioned slot beside a later versioned restore"*.
**Honoured by.** `src/parse/identity.ts` exports `EventIdentity` as a three-member discriminated union with
an `as const` kind. The current code sniffs `identity?.includes("|slot|")`; nothing in this package parses a
key string to learn what an identity is.
**Proved by.**
`tests/listing/present-not-usable.test.ts :: ICAL-O50: two distinct unversioned slots both survive rather than one silently winning`;
`tests/listing/present-not-usable.test.ts :: ICAL-O50: a slot a versioned master supersedes is named on the listing, not merely absent`;
`tests/parse/identity.test.ts :: ICAL-O8: a later versioned master does not resurrect an unversioned slot`;
`tests/parse/identity.test.ts :: ICAL-O8: the two slots are superseded, not merged into the master`;
`tests/parse/identity.test.ts :: ICAL-I8: the identity key is derived from the three-member union, never sniffed from a UID string`;
`tests/parse/identity.test.ts :: ICAL-I8: a UID that literally contains the slot separator does not collide with a real slot`.

### ICAL-I9. STATUS:CANCELLED is a first-class input, not a filter

**Lesson.** A cancelled master drops the master and all detached overrides; a cancelled `RECURRENCE-ID`
override must become a master `EXDATE`, or RRULE expansion resurrects the occurrence. A newer revision can
un-cancel.
**Learned from.** `parse-ics-events.ts` `collectCancellationState` / `mergeExceptionDates`; protocol ledger
entry 56.
**Honoured by.** `src/parse/cancellation.ts` is a named pass over the selected revisions producing an
explicit `cancellations` value that `src/canonical/project.ts` consumes; cancellations reach the protocol
listing as `Removal { kind: "cancelled" }`, never as a filtered-out event.
**Proved by.**
`tests/listing/present-not-usable.test.ts :: ICAL-O51: a cancelled event reaches the listing as a removal, never as a silent absence`;
`tests/listing/present-not-usable.test.ts :: ICAL-O51: every present identity is an event, a removal or a withheld entry`;
`tests/parse/cancellation.test.ts :: ICAL-O23: a cancelled RECURRENCE-ID override becomes a master exception at the exact instant`;
`tests/parse/cancellation.test.ts :: ICAL-O23: the cancelled day cannot reappear from an RRULE expansion`;
`tests/parse/cancellation.test.ts :: ICAL-O24: a cancelled master drops its detached overrides`;
`tests/parse/cancellation.test.ts :: ICAL-O24: a newer revision un-cancels the series`;
`tests/parse/cancellation.test.ts :: ICAL-I9: cancellations reach the canonical projection as a value, not as an absence`.

### ICAL-I10. THISANDFUTURE is reported, not reinterpreted

**Lesson.** Applying `RANGE=THISANDFUTURE` as a single-instance override silently changes the meaning of the
series; throwing fails the feed.
**Learned from.** `parse-ics-events.ts` `collectRangedOverrideEvents`.
**Honoured by.** `src/parse/recurrence-support.ts` yields the protocol's
`WithholdReason "unsupportedRecurrenceRange"` for that UID only.
**Proved by.**
`tests/parse/unsupported-recurrence.test.ts :: ICAL-O9: it is reported unsupported rather than applied as a single-instance override`;
`tests/parse/unsupported-recurrence.test.ts :: ICAL-O9: the two healthy events beside it still project`;
`tests/parse/unsupported-recurrence.test.ts :: ICAL-O9: the withheld series UID is present, so its stored row is not deleted`;
`tests/parse/unsupported-recurrence.test.ts :: ICAL-I10: the range override is detected by the property that declares it`.

### ICAL-I11. RDATE must be attributed to the VEVENT that declared it

**Lesson.** A naive line scan leaks an `RDATE` onto the next adjacent event, withholding the wrong UID. A
mismatched `BEGIN`/`END` can hide an event-level `RDATE` inside what looks like a `VTIMEZONE`.
**Learned from.** `ics/utils/validate-recurrence-input.ts`; tests *"does not leak RDATE onto the next event
when components are adjacent"*, *"fails closed when a mismatched component boundary tries to hide event
RDATE"*.
**Honoured by.** `src/text/component-walk.ts` carries a `componentInstancePath` (a unique id per component
*occurrence*) beside the component path, because two sibling VEVENTs share a path. A boundary mismatch is
`unreadable/componentBoundaryMismatch` — it fails closed. Attribution is only half of it: an `RDATE` we
cannot expand would mirror the series short, so `src/parse/parse-vevent.ts` withholds any VEVENT declaring
one, with the protocol reason `unsupportedRecurrenceDates` (added for this), and it is counted like every
other drop (ICAL-I4). `detectEventLevelRecurrenceDates` remains the body-level pre-scan for callers that
want the UIDs before parsing.
**Proved by.**
`tests/text/component-walk.test.ts :: ICAL-O10: an RDATE does not leak onto the next adjacent event`;
`tests/text/component-walk.test.ts :: ICAL-O10: an RDATE inside a VTIMEZONE observance is not attributed to any event`;
`tests/text/component-walk.test.ts :: ICAL-O10: two sibling VEVENTs are distinguished by their component instance path`;
`tests/parse/hostile-values.test.ts :: ICAL-O49: an event-level RDATE is withheld and counted, never mirrored short`.

### ICAL-I12. Identifier lists in diagnostics are a capped sample beside an uncapped count

**Lesson.** A feed publishing `RDATE` on every event produced an unsupported-uid list too large to log,
taking the counters with it.
**Learned from.** test *"keeps the unsupported-uid field loggable when a feed publishes RDATE everywhere"*.
**Honoured by.** The protocol's `BoundedSample` is the only shape any list takes; the cap is
`IcsLimits.maxDiagnosticSample`, a named field on an explicitly-passed limits record.
**Proved by.**
`tests/listing/diagnostics-bounds.test.ts :: ICAL-I12: the identifier list is capped at maxDiagnosticSample`;
`tests/listing/diagnostics-bounds.test.ts :: ICAL-I12: the uncapped total sits beside the capped sample`;
`tests/listing/diagnostics-bounds.test.ts :: ICAL-I12: at the boundary the sample is complete and the total agrees`;
`tests/listing/diagnostics-bounds.test.ts :: ICAL-I12: the sample is stable across two identical polls`;
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-O22: the second poll reports identical diagnostics`;
`tests/parse/idempotent-diagnostics.test.ts :: ICAL-O22: the second poll produces an empty diff against the first`.

### ICAL-I13. Unfold before parsing; re-emit untouched lines byte-for-byte; emit CRLF

**Lesson.** Parsing a folded property line reads a truncated value. Rewriting every line churns the content
hash even when nothing changed. RFC 5545 §3.1 mandates CRLF terminators.
**Learned from.** `ics/utils/apply-patches.ts`; tests *"unfolds RFC 5545 line continuations before parsing
the property line"*, *"preserves the folded form of properties no patch modifies"*, *"accepts LF line
endings and emits CRLF"*.
**Honoured by.** `src/text/patch.ts` groups continuations, unfolds, offers the group to each patch, and
emits the **original** raw lines unless a patch actually changed the params or the value.
**Proved by.** `tests/text/patch.test.ts :: ICAL-I13: lines no patch touches are re-emitted byte for byte`;
`tests/text/patch.test.ts :: ICAL-I13: LF input is accepted and CRLF is emitted`;
`tests/text/patch.test.ts :: ICAL-I13: a folded property is unfolded before the patch sees its value`;
`tests/text/patch.test.ts :: ICAL-I13: a folded property no patch modifies keeps its original folded form`;
`tests/text/patch.test.ts :: ICAL-I13: a patch returning null leaves an earlier patch`;
`tests/text/patch.test.ts :: ICAL-I13: a line without a colon is returned verbatim rather than dropped`;
`tests/text/fold.test.ts :: ICAL-I13: a continuation may begin with SPACE or HTAB, and the whitespace is removed`;
`tests/text/fold.test.ts :: ICAL-I13: a line short enough to stand alone is not folded`.

### ICAL-I14. Folding is measured in UTF-8 octets, not characters

**Lesson.** RFC 5545 §3.1 folds at 75 **octets** and warns explicitly that naive implementations split a
multi-octet sequence. `String.length` folds emoji in half and produces a body that reparses to different
text — a hash change with no semantic change.
**Learned from.** RFC 5545 §3.1; the existing unfolder is octet-agnostic because it never re-folds.
**Honoured by.** `src/text/fold.ts` measures with `TextEncoder` and never splits a code point.
**Proved by.**
`tests/text/fold.test.ts :: ICAL-I14: every emitted line is at most 75 UTF-8 octets, excluding the line break`;
`tests/text/fold.test.ts :: ICAL-I14: folding is measured in octets, not characters, for a multi-byte value`;
`tests/text/fold.test.ts :: ICAL-I14: an astral-plane code point is never split across a fold`;
`tests/text/fold.test.ts :: ICAL-I14: unfold is the exact inverse of fold across an adversarial alphabet`.

### ICAL-I15. Strip the UTF-8 BOM explicitly

**Lesson.** Only the ICS-over-HTTP path is accidentally BOM-safe (`Response.text()` drops it). CalDAV
`calendar-data` arrives as an XML text node with the BOM intact, turning `BEGIN:VCALENDAR` into an
unparseable property line and failing the whole resource.
**Learned from.** `apply-patches.ts` `stripIcsByteOrderMark`; commit `2657805b` (#604).
**Honoured by.** `src/text/byte-order-mark.ts`, called at the very front of `parseIcsDocument`.
**Proved by.**
`tests/text/byte-order-mark.test.ts :: ICAL-I15: the BOM is stripped so BEGIN:VCALENDAR is recognised`;
`tests/text/byte-order-mark.test.ts :: ICAL-I15: a body without a BOM is returned untouched`;
`tests/text/byte-order-mark.test.ts :: ICAL-I15: only a leading BOM is stripped, never one inside a value`;
`tests/text/byte-order-mark.test.ts :: ICAL-I15: a CalDAV calendar-data body carrying a BOM parses as readable`.

### ICAL-I16. Bare 8-digit dates are coerced, with three guards

**Lesson.** Real feeds emit `DTSTART:20260515` with no `VALUE=DATE`. The coercion must fire only when the
property has no parameters (never overwriting a TZID), must reject digit strings that are not real calendar
dates (`20261301`, `20260230` — `Date.UTC` rolls them into a plausible phantom event on the wrong day), and
must handle `EXDATE`'s comma-separated list, refusing mixed lists.
**Learned from.** `ics/patches/coerce-compliant-date.ts`; commit `62d6e8fa` (#392).
**Honoured by.** `src/text/patches/coerce-compliant-date.ts`, ported with all three guards and the
round-trip real-date reconstruction check.
**Proved by.**
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O35: a genuine calendar date is coerced to VALUE=DATE and round-trips`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O35: a 13th month is declined rather than rolled over into a phantom day`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O35: a 30th of February is declined rather than rolled over into March`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O35: a leap day that does not exist in that year is declined`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O35: the VEVENT carrying an impossible date is withheld, never written`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O36: a property carrying a TZID is never rewritten`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O36: a property carrying any parameter at all is emitted unchanged`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O36: a mixed EXDATE list is refused rather than half-coerced`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-O36: an all-date EXDATE list is coerced as one value`;
`tests/text/patches/coerce-compliant-date.test.ts :: ICAL-I16: a value that is already a date-time is left alone`;
`tests/parse/hostile-values.test.ts :: ICAL-O46: an impossible calendar date is refused rather than rolled into the next month`;
`tests/parse/hostile-values.test.ts :: ICAL-O46: an impossible clock time is refused rather than rolled into the next day`.

### ICAL-I17. Windows timezone identifiers map to IANA from the full CLDR table

**Lesson.** Microsoft/Exchange emit `Eastern Standard Time`; Google rejects non-IANA TZIDs outright. A
partial map was shipped first and had to be completed.
**Learned from.** commits `7c276d8e` (#242) then `ac6fa18c` (#244); `normalize-timezone.ts`;
`outlook-windows-timezone.test.ts`.
**Honoured by.** `src/zone/windows-zones.ts` is an `as const` record with a derived union type, applied as
the first rung of resolution at every zone entry point.
**Proved by.**
`tests/zone/windows-zones.test.ts :: ICAL-O30: every mapped IANA name is known to Intl.supportedValuesOf`;
`tests/zone/windows-zones.test.ts :: ICAL-O30: the backward-linked zones the table still carries resolve to live names`;
`tests/zone/windows-zones.test.ts :: ICAL-O29: a Windows identifier never survives into the canonical projection`;
`tests/zone/windows-zones.test.ts :: ICAL-I17: an identifier already in IANA form passes through unchanged`;
`tests/zone/windows-zones.test.ts :: ICAL-I17: an identifier in neither table is reported as unmapped, never guessed`.

### ICAL-I18. Zone resolution is a documented ladder that ends in a refusal

**Lesson.** Feeds legitimately name TZIDs Intl has never heard of: Thunderbird's
`/mozilla.org/<ver>/America/Denver`, Exchange's `Customized Time Zone`. The zone info is in the file —
recover it. But a VTIMEZONE *with* DST transitions must never be flattened onto a fixed offset: half the
year would be an hour wrong, which is worse than reporting the event unsupported.
**Learned from.** `resolve-timezone-identifier.ts`; commit `43292a9f` (#606).
**Honoured by.** `src/zone/resolve-zone-identifier.ts` returns
`ZoneResolution = resolved(via: rung) | unsupported(reason)`, with the rungs as an `as const` tuple:
`ianaDirect`, `windowsCldr`, `embeddedIanaSegment`, `declaredFixedOffset`. `Etc/GMT±N` sign inversion is the
one place an admissible comment cites its source (POSIX sign convention, tzdata `etcetera`).
**Proved by.**
`tests/zone/resolve-identifier.test.ts :: ICAL-I18: an IANA identifier resolves on the first rung`;
`tests/zone/resolve-identifier.test.ts :: ICAL-I18: a Windows identifier resolves through the CLDR table`;
`tests/zone/resolve-identifier.test.ts :: ICAL-I18: a tzurl-style identifier resolves through its embedded IANA segment`;
`tests/zone/resolve-identifier.test.ts :: ICAL-I18: an unknown TZID whose declared block never changes offset resolves to that offset`;
`tests/zone/resolve-identifier.test.ts :: ICAL-O28: a VTIMEZONE that changes offset is refused rather than flattened`;
`tests/zone/resolve-identifier.test.ts :: ICAL-O28: the ladder ends in a typed refusal, never in a guessed zone`.

### ICAL-I19. Where the platform knows the zone, IANA rules decide the instant

**Lesson.** The single most important correctness rule in the package. ts-ics projects a VTIMEZONE
observance carrying an RRULE by expanding the rule and **drops the time of day from the onset** — every
projected transition applies from local midnight instead of the observance DTSTART hour. A wall time in the
hours before a transition lands on the wrong side. Because Keeper reads its own CalDAV writes back, the
mirrored event looked moved and was deleted and re-created every run, forever.
**Learned from.** `resolve-zoned-instants.ts` header; commit `b057d2e0`.
**Honoured by.** `src/zone/authority.ts`: where the TZID names a zone the platform knows **and** the
declared VTIMEZONE uses a projected (RRULE) observance, IANA decides. A VTIMEZONE with no RRULE states every
onset outright and stays authoritative, as RFC 5545 §3.6.5 intends.
**Proved by.**
`tests/zone/observance-authority.test.ts :: ICAL-O26: a wall time in the hour before a projected transition takes the instant IANA names`;
`tests/zone/observance-authority.test.ts :: ICAL-O26: the time of day survives the RRULE onset rather than being dropped`;
`tests/zone/observance-authority.test.ts :: ICAL-O27: an explicit observance set with no projection stays authoritative`;
`tests/zone/observance-authority.test.ts :: ICAL-I19: IANA is authoritative for a zone the platform knows whose block projects`;
`tests/zone/observance-authority.test.ts :: ICAL-I19: an explicit observance set is authoritative even for a zone IANA knows`;
`tests/zone/observance-authority.test.ts :: ICAL-I19: with no declared block at all, IANA decides`.

### ICAL-I20. Wall-time resolution has exactly three cases, and each has a fixed rule

**Lesson.** Unique is trivial; a **fold** chooses the EARLIER instant; a **gap** shifts forward by the size
of the transition. Anything else throws. Both fold and gap are arbitrary choices — unpinned, the hash flaps.
**Learned from.** `timezone-instant.ts` `wallTimeToInstant`; `zoned-instant-resolution.test.ts`.
**Honoured by.** `src/zone/wall-time.ts` returns
`WallTimeResolution = unique | fold | gap`, so which branch fired is data and a hash change is
attributable — not a `Date` whose provenance is lost.
**Proved by.**
`tests/zone/wall-time.test.ts :: ICAL-I20: a wall time the zone renders once resolves uniquely`;
`tests/zone/wall-time.test.ts :: ICAL-I20: a fall-back hour resolves to the earlier instant and names the one it discarded`;
`tests/zone/wall-time.test.ts :: ICAL-I20: a spring-forward gap shifts forward by the size of the gap that removed it`;
`tests/zone/wall-time.test.ts :: ICAL-I20: a half-hour gap in Lord Howe shifts by thirty minutes, not by an hour`;
`tests/zone/wall-time.test.ts :: ICAL-I20: an instant rendered to wall time and back returns the instant that rendered it`;
`tests/zone/sweeps/instant-roundtrip.test.ts :: ICAL-I20: every instant resolves back to itself or to an earlier instant, never a later one`;
`tests/zone/sweeps/fold-earlier-instant.test.ts :: ICAL-I20: the fold resolves to the earlier of the two instants and names the discarded one`;
`tests/zone/sweeps/gap-shift-forward.test.ts :: ICAL-I20: the gap shifts forward by the size of the transition that removed it`.

### ICAL-I21. The two-probe premise is falsifiable, and it is tested

**Lesson.** Resolution uses the offsets one day before and one day after because no IANA zone transitions
twice within two days. That premise is asserted, not assumed. The two-probe form replaced a 13-sample sweep
costing ~19µs per DTSTART with one costing ~2.8µs, verified against the sweep over 415k wall times spanning
every transition of all 445 IANA zones 2015–2032 plus the ragged historical half of tzdata back to 1925.
**Learned from.** commit `b057d2e0`; `wall-time-bracket-premise.test.ts`, `wall-time-zone-sweep-*`.
**Honoured by.** `src/zone/wall-time.ts` keeps the two-probe form. The premise ships as an executable
specification.
**Proved by.**
`tests/zone/sweeps/bracket-premise.test.ts :: ICAL-I21: no IANA zone transitions twice within two days`.

### ICAL-I22. Offsets are whole minutes, and the emitter cannot say otherwise

**Lesson.** Offsets are not always whole hours, and historically not always whole minutes (LMT). RFC 5545's
common `UTC-OFFSET` form cannot express seconds.
**Learned from.** `wall-time-zone-sweep-whole-minute-offsets.test.ts`,
`wall-time-historical-differential.test.ts`.
**Honoured by.** `src/zone/offset.ts` `formatUtcOffset` emits `±HHMM`; a sub-minute offset is a typed
refusal (`ZoneRefusal "subMinuteOffset"`), never a silent truncation.
**Proved by.** `tests/zone/offset.test.ts :: ICAL-I22: a positive offset is formatted as +HHMM`;
`tests/zone/offset.test.ts :: ICAL-I22: a negative offset is formatted as -HHMM`;
`tests/zone/offset.test.ts :: ICAL-I22: zero is formatted as a positive offset`;
`tests/zone/offset.test.ts :: ICAL-I22: a quarter-hour offset survives, because minutes are not rounded to hours`;
`tests/zone/offset.test.ts :: ICAL-I22: a sub-minute offset is refused rather than truncated into a wrong offset`;
`tests/zone/offset.test.ts :: ICAL-I22: every offset the zone layer reports is a whole number of minutes`;
`tests/zone/resolve-identifier.test.ts :: ICAL-I22: a declared sub-minute offset is refused rather than truncated`;
`tests/zone/sweeps/whole-minute-offsets.test.ts :: ICAL-I22: every reported offset is a whole number of minutes`.

### ICAL-I23. DURATION has nominal units and exact units

**Lesson.** Weeks and days are NOMINAL — walk the wall clock, so they survive a DST transition as the same
local time. Hours, minutes and seconds are EXACT. Adding `P1D` as 86_400_000 ms across a DST boundary lands
an hour off, and an exact 24-hour duration is not the same value as a nominal one-day duration.
**Learned from.** `recurrence-duration.ts` `addIcsDuration`; test *"distinguishes exact DTEND duration from
nominal DURATION"*.
**Honoured by.** `src/parse/duration.ts` splits the two and routes the nominal part through wall-clock
conversion in the event's zone. The protocol's `OccurrenceDuration = exact | nominal` carries the
distinction into the canonical form, so it cannot be flattened downstream. The RFC's combined `P1DT2H` form
is refused for the same reason rather than summed into seconds: it is both units at once, and flattening it
is exactly the DST-boundary bug above. Magnitudes are bounded (`maxRepresentableDays`), because an
unbounded `P200000000D` used to reach `Date` arithmetic and throw `RangeError` out of the whole feed.
**Proved by.**
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd nominal duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd exact duration is withheld, and its healthy sibling survives`;
`tests/parse/duration.test.ts :: ICAL-I23: a day-based duration is nominal, so it survives a DST boundary as wall clock`;
`tests/parse/duration.test.ts :: ICAL-I23: an hour-based duration is exact, measured in seconds on the instant line`;
`tests/parse/duration.test.ts :: ICAL-I23: a mixed nominal and exact duration is not silently flattened to one of them`.

### ICAL-I24. RFC 5545 §3.6.1 end-time defaults, and unbuildable means dropped-and-counted

**Lesson.** A DATE-valued DTSTART with no DTEND/DURATION ends one day later; a timed DTSTART with no DTEND
ends AT its DTSTART — a zero-duration event is legal source data, not corruption. An all-day event with an
hour-based DURATION, and any negative DURATION, are unbuildable.
**Learned from.** `parse-ics-events.ts` `resolveEventEndTime`; commit `b057d2e0` (#616).
**Honoured by.** `src/parse/end-time.ts` returns `EndTimeResolution = resolved | unbuildable(reason)`.
Each default is a named test citing its RFC clause in the test name rather than in a comment.
**Proved by.**
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd nominal duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd exact duration is withheld, and its healthy sibling survives`;
`tests/parse/duration.test.ts :: ICAL-I24: a negative duration is refused rather than repaired into a zero-length event`;
`tests/parse/duration.test.ts :: ICAL-I24: a syntactically invalid duration is refused, never guessed`;
`tests/parse/end-time.test.ts :: ICAL-I24: a date-only DTSTART with no DTEND and no DURATION lasts exactly one day`;
`tests/parse/end-time.test.ts :: ICAL-I24: a date-time DTSTART with no DTEND and no DURATION is zero length, not a guessed hour`;
`tests/parse/end-time.test.ts :: ICAL-I24: a DTEND before DTSTART is unbuildable, never repaired into a plausible range`;
`tests/parse/end-time.test.ts :: ICAL-I24: an all-day DTSTART with an hour-based DURATION is unbuildable`.

### ICAL-I25. Degenerate ranges are preserved, and one predicate judges every window

**Lesson.** Zero-duration and inverted ranges are legal in ICS; the range the feed states is kept. Four
diverged copies of `end > windowStart` each independently dropped such events, causing permanent add/delete
cycles.
**Learned from.** commit `b057d2e0` (#616); `core/events/time-range.ts` `overlapsTimeWindow`.
**Honoured by.** `src/canonical/window.ts` exports exactly one predicate, typed
`satisfies WindowMembership` against the protocol. The package contains no second copy. Provider-side
widening belongs to the destination packages and never feeds back into the fingerprint.
**Proved by.**
`tests/canonical/provider-roundtrip.test.ts :: ICAL-O16: a destination widening a degenerate range does not change the source fingerprint`;
`tests/canonical/window.test.ts :: ICAL-I25: a degenerate zero-length event inside the window is a member`;
`tests/canonical/window.test.ts :: ICAL-I25: an event straddling the window start is a member`;
`tests/canonical/window.test.ts :: ICAL-I25: an event entirely before the window is not a member`;
`tests/canonical/window.test.ts :: ICAL-I25: an all-day event is judged on its exclusive end date`;
`tests/canonical/window.test.ts :: ICAL-I25: an event touching only the exclusive window end is not a member`.

### ICAL-I26. All-day is a pair of UTC midnights

**Lesson.** Every destination reads an all-day instant as UTC midnight. An all-day range not on the UTC day
grid reads back narrower than it was written, so the mirror is judged changed on every run — a delete and
re-create per event per run, forever, on all three providers. A local-midnight-to-local-midnight timed event
interpreted as all-day must be re-anchored onto UTC midnight of the *local* calendar day and must drop the
originating timezone, or expansion walks its wall clock and re-introduces DST drift.
**Learned from.** commit `82799c5b` (#602); `interpret-full-day-timed-events.ts`.
**Honoured by.** The protocol's `EventTime` already makes all-day a separate variant carrying
`CalendarDate`s and no zone, so a timezone cannot leak into an all-day fingerprint.
`src/canonical/all-day.ts` owns the re-anchor, and `src/parse/parse-vevent.ts` calls it on exactly the
events `src/parse/event-time.ts` reclassifies — the resolution reports the zone it reclassified out of
(`fullDayZone`), so EXDATE and RECURRENCE-ID move with DTSTART instead of being left on the instants the
publisher stated. `src/parse/event-time.ts` performs the recognition itself: a timed range that starts and ends on
local midnight in its own stated zone is read as the pair of calendar dates it names, so an all-day event
authored in a zone ahead of UTC hashes as the UTC day grid the destination will read back.
**Proved by.**
`tests/canonical/provider-roundtrip.test.ts :: ICAL-O15: an all-day event a provider re-emits on the UTC day grid hashes identically`;
`tests/canonical/provider-roundtrip.test.ts :: ICAL-O15: an all-day event authored in a zone ahead of UTC hashes as a pair of UTC midnights`;
`tests/canonical/anchoring.test.ts :: ICAL-O58: a range reclassified as all-day moves its cancelled days with its DTSTART`;
`tests/canonical/anchoring.test.ts :: ICAL-O58: the reanchored cancellation is the same value on a re-poll`.

### ICAL-I27. Re-anchoring moves the whole recurrence identity set together

**Lesson.** `EXDATE`, `RECURRENCE-ID` and `RRULE UNTIL` are matched by exact instant. Moving DTSTART and
leaving them behind silently un-cancels a cancelled day or detaches an override from the slot it replaces.
**Learned from.** `interpret-full-day-timed-events.ts`; tests *"keeps a cancelled day cancelled"*, *"lets a
detached instance replace the day it was moved from"*, *"stops on the day the series says it stops"*.
**Honoured by.** `src/canonical/all-day.ts` exposes one function taking the whole `RecurrenceIdentitySet`
and returning a new one; there is no exported way to move DTSTART alone. The type makes the partial move
unrepresentable rather than merely discouraged, and `src/parse/parse-vevent.ts` is the caller that uses it
on the live path (ICAL-I26) — a helper nothing calls proves nothing.
**Proved by.**
`tests/canonical/reanchor.test-d.ts :: ICAL-O25: DTSTART cannot be moved without its recurrence identities`;
`tests/canonical/reanchor.test-d.ts :: ICAL-I27: the re-anchored value is the whole set, never a bare instant`;
`tests/canonical/reanchor.test.ts :: ICAL-O25: a cancelled day stays cancelled in a zone ahead of UTC`;
`tests/canonical/reanchor.test.ts :: ICAL-O25: a detached instance still replaces the day it was moved from`;
`tests/canonical/reanchor.test.ts :: ICAL-O25: UNTIL moves with the series, so it stops on the day the series says it stops`;
`tests/canonical/reanchor.test.ts :: ICAL-O25: a zone behind UTC re-anchors onto the UTC midnight of its own local day`;
`tests/canonical/reanchor.test.ts :: ICAL-I27: re-anchoring twice is a fixed point, so a second poll does not shift the series`;
`tests/canonical/reanchor.test.ts :: ICAL-I27: a series with no exceptions, overrides or UNTIL is re-anchored without inventing any`;
`tests/canonical/anchoring.test.ts :: ICAL-O58: a range reclassified as all-day moves its cancelled days with its DTSTART`;
`tests/canonical/anchoring.test.ts :: ICAL-O58: the reanchored cancellation is the same value on a re-poll`.

### ICAL-I28. Floating values are anchored by a stated precedence, never guessed

**Lesson.** Floating `DTSTART`/`DTEND`/`EXDATE`/`RDATE`/`RECURRENCE-ID` and `RRULE UNTIL` anchor to the TZID
on the event's own DTSTART first, then `X-WR-TIMEZONE`; with no zone context at all the event is reported
unsupported. Because a TZID parameter applies to every value on a property, a mixed multi-value `EXDATE`
(some floating, some Z-suffixed) must be split across two lines rather than reinterpreting the absolute
entries. An all-day series is exempt: a DATE DTSTART makes a date-time UNTIL a date comparison anyway.
**Learned from.** commit `43292a9f` (#606); `fetch-adapter.ts` `normalizeFloatingDateProperty`.
**Honoured by.** `src/parse/floating.ts` applies one precedence function per *value* — including the
`RRULE UNTIL`, which `src/canonical/recurrence-rule.ts` canonicalises through an `UntilAnchor` the parser
supplies rather than by stamping a bare `Z` on a wall clock (an all-day series keeps the plain `Z`, per the
exemption above) — with per-VEVENT failure isolation — a `RangeError` inside one block is attributed to that UID and the block is emitted
unchanged, so an unanchorable event reports rather than ending the pass.
`src/text/patches/split-mixed-exdate.ts` performs the line split in the patch layer where all leniency
lives.
**Proved by.**
`tests/parse/floating.test.ts :: ICAL-O32: only the floating entries of a mixed multi-value EXDATE are resolved`;
`tests/parse/floating.test.ts :: ICAL-O32: the mixed property is split across two lines rather than rewritten as one`;
`tests/parse/floating.test.ts :: ICAL-O33: a floating EXDATE with no zone context is unsupported, not guessed`;
`tests/parse/floating.test.ts :: ICAL-O34: a TZID-qualified value ignores a contradicting X-WR-TIMEZONE`;
`tests/parse/floating.test.ts :: ICAL-I28: X-WR-TIMEZONE anchors a genuinely floating value when the event states no TZID`;
`tests/parse/floating.test.ts :: ICAL-I28: floating anchoring is isolated per VEVENT, so one event`;
`tests/canonical/anchoring.test.ts :: ICAL-O56: a floating UNTIL is anchored to the series zone, not stamped as UTC`.

### ICAL-I29. X-WR-TIMEZONE never overrides an explicit TZID

**Lesson.** Parsers that let the calendar-level `X-WR-TIMEZONE` win over a VTIMEZONE-qualified value put
every event an hour early for half the year. This is the most commonly reported iCalendar parsing defect
across implementations, and it is the same class of bug as ICAL-I19.
**Learned from.** `u01jmg3/ics-parser#245` *"With X-WR-TIMEZONE set wrong time is returned"*;
`ical4j#230`; corroborated by the precedence already encoded in `fetch-adapter.ts`.
**Honoured by.** `X-WR-TIMEZONE` is the **second** rung of `src/parse/floating.ts` and applies only to
values that carry no zone of their own. It is never consulted for a TZID-qualified value.
**Proved by.**
`tests/parse/floating.test.ts :: ICAL-O34: a TZID-qualified value ignores a contradicting X-WR-TIMEZONE`.

### ICAL-I30. A referenced-but-undefined TZID gets a synthesised VTIMEZONE

**Lesson.** Without one, ts-ics falls back to reading the wall-clock value as if it were the UTC instant —
wrong on the wrong side of every DST transition. The synthesised block must keep the identifier the
properties actually reference (a Windows name included), or nothing links to it.
**Learned from.** `synthesize-vtimezones.ts`; commit `2657805b` (#604).
**Honoured by.** `src/zone/synthesize-vtimezones.ts` runs before the strict parse; the generated observances
describe the *resolved* IANA zone while the emitted `TZID` is the *referenced* string. Its reference year is
the earliest year the body's own dated properties name, never a constant: a block projected from a fixed
year would not cover a feed of 2019 events, and an event whose DTSTART precedes every observance resolves
against the wrong offset or falls through entirely.
**Proved by.**
`tests/serialise/write-fidelity.test.ts :: ICAL-O52: the VTIMEZONE covers the year the event itself occurs in`;
`tests/zone/synthesize-vtimezones.test.ts :: ICAL-I30: a VTIMEZONE is synthesised under the referenced identifier`;
`tests/zone/synthesize-vtimezones.test.ts :: ICAL-I30: the event`;
`tests/zone/synthesize-vtimezones.test.ts :: ICAL-I30: a document that already defines the zone is returned unchanged`;
`tests/zone/synthesize-vtimezones.test.ts :: ICAL-I30: synthesising twice is a fixed point`;
`tests/zone/synthesize-vtimezones.test.ts :: ICAL-I30: a referenced identifier that resolves to nothing is left alone rather than invented`.

### ICAL-I31. VTIMEZONE synthesis is validate-then-emit, and its cache is passed in

**Lesson.** An annual RRULE is emitted only after validating that the full projection (reference year − 1
through max(reference, current) + 100) groups into exactly two stable patterns occurring in every year.
Africa/Casablanca's moving Ramadan transitions must fall back to explicit per-transition observances. A
baseline STANDARD observance is always emitted (commit `cecd4024` exists because it was once dropped). A
projection keyed on an old event must not truncate rules for current and future events. Southern-hemisphere
direction and non-hour transition sizes (Lord Howe's 30 minutes) must survive. Outlook needs the RRULE form
to render at all, which is the only reason to attempt it.
**Learned from.** `build-vtimezone.ts`; commits `cecd4024` (#420), `0111e5de` (#423).
**Honoured by.** `src/zone/build-vtimezone.ts` ports the validation gate whole. Its cache is **not**
module-level mutable state: `createZoneCache()` returns a cache the caller passes in, satisfying the
package's no-module-side-effects rule; both the wall-clock and the weekday formatter are memoised in it,
since `Intl.DateTimeFormat` construction dominates the projection. `IcsLimits.zoneProjectionYears` bounds
the projection, and `findZoneTransitions` clamps any window a caller hands it to the same bound. An
identifier that does not normalise returns `{ kind: "unresolvableZone" }` and the serialiser refuses the
write (`constraint: "zoneIdentifier"`); it is never silently projected as UTC, which would emit
plausible-looking observances for the wrong zone. A weekday the platform renders outside the table throws
`IcsInternalDataError` rather than defaulting to Sunday, which would write the wrong `BYDAY`.
**Proved by.**
`tests/serialise/write-fidelity.test.ts :: ICAL-O53: a Windows identifier is written as the same zone the VTIMEZONE declares`;
`tests/serialise/write-fidelity.test.ts :: ICAL-O53: an identifier we cannot resolve refuses the write instead of substituting UTC`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: Morocco`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: exactly zoneProjectionYears are projected, not more and not adaptively widened`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: a narrower ceiling projects fewer years, so the bound is the named limit`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: the validate-then-emit loop terminates inside a scheduler tick`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: a zone whose rule does stabilise still emits an annual rule under the same ceiling`;
`tests/zone/cache-memoisation.test.ts :: ICAL-L9: a second projection for the same zone and reference year does no further Intl work`;
`tests/zone/cache-memoisation.test.ts :: ICAL-L9: a different reference year is a different memo entry, not a stale hit`;
`tests/zone/cache-memoisation.test.ts :: ICAL-L9: the weekday formatter is memoised too, so a second projection builds none`;
`tests/zone/cache-memoisation.test.ts :: ICAL-L9: the formatter for a zone is constructed once across many wall-time resolutions`;
`tests/zone/cache-memoisation.test.ts :: ICAL-I31: two caches are isolated, so one caller cannot poison another`;
`tests/zone/cache-memoisation.test.ts :: ICAL-I31: the cache is created by createZoneCache and never shared at module level`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: a stable annual rule is emitted only after the full projection round-trips`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: a southern-hemisphere zone keeps its transition direction`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: a non-hour transition size survives synthesis`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: a fixed-offset zone emits one baseline STANDARD observance and no rule`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: a Windows identifier is normalised before the zone is projected`;
`tests/zone/build-vtimezone.test.ts :: ICAL-O44: an identifier we cannot resolve refuses, rather than silently projecting UTC`;
`tests/zone/build-vtimezone.test.ts :: ICAL-I31: an old reference year does not truncate the rules current events need`.

### ICAL-I32. The second pass of a fall-back hour is written in UTC

**Lesson.** A wall clock repeats an hour at a fall-back transition and RFC 5545 has no way to say which pass
is meant. An instant in the second pass cannot survive being written as a local time — the read-back moves
it to the first pass and the mirror churns.
**Learned from.** `build-zoned-date.ts` (round-trip check before emitting `local`).
**Honoured by.** `src/serialise/zoned-date.ts` round-trips its own output before choosing a representation:
if `resolveWallTime(instantToWallTime(x)) !== x`, it emits UTC. The choice is returned as
`ZonedDateRendering = localWithTzid | utc`, so it is inspectable rather than implied.
**Proved by.**
`tests/serialise/zoned-date.test.ts :: ICAL-O31: the first pass keeps its TZID and local wall time`;
`tests/serialise/zoned-date.test.ts :: ICAL-O31: the second pass is written in UTC, because a TZID rendering would move it`;
`tests/serialise/zoned-date.test.ts :: ICAL-O31: serialise then parse returns the same instant for both passes`;
`tests/serialise/zoned-date.test.ts :: ICAL-I32: an unambiguous instant is written with its TZID rather than flattened to UTC`;
`tests/serialise/zoned-date.test.ts :: ICAL-I32: the writer round-trips its own output before choosing the rendering`.

### ICAL-I33. The content hash is computed over a canonical form, never over object key order

**Lesson.** Two structurally identical recurrence payloads with different key order produced a diff,
deleting and re-creating the event.
**Learned from.** `core/events/content-hash.ts`; `diff-events.ts` `toStableComparableValue`.
**Honoured by.** `src/canonical/encode.ts` defines the canonical form outright: a fixed field **order**
(`canonicalFieldOrder`, an `as const` tuple, so adding a field is a compile-time decision), instants as
RFC 3339 UTC, exception dates sorted and deduplicated, absent collapsed to one sentinel, text normalised
(CRLF→LF, trimmed), joined with a separator no value can contain. The sort and the dedupe live in the
encoder itself, not only in the parser, so a `CanonicalEvent` rehydrated by `parseStoredCanonicalEvent`
hashes the same as one freshly parsed. `src/canonical/hash.ts` hashes the UTF-8 bytes. The field map is
built through `satisfies Record<(typeof canonicalFieldOrder)[number], string>`, so a new field cannot be
silently omitted from the hash.
**Proved by.**
`tests/canonical/hash-invariance.test.ts :: ICAL-O18: VEVENT order does not change the set of fingerprints`;
`tests/canonical/hash-invariance.test.ts :: ICAL-O18: exception-date order does not change the fingerprint`;
`tests/canonical/hash-invariance.test.ts :: ICAL-O18: a duplicated exception date does not change the fingerprint`;
`tests/canonical/hash-invariance.test.ts :: ICAL-O18: object key order in a stored canonical event does not change the fingerprint`;
`tests/canonical/hash-invariance.test.ts :: ICAL-I33: the encoding is one field per canonical slot, with a separator no value can contain`;
`tests/canonical/hash-pins.test.ts :: ICAL-O43: the timed reference event hashes to a sha256 digest of the pinned length`;
`tests/canonical/hash-pins.test.ts :: ICAL-O43: the all-day reference event hashes to a different pinned digest`;
`tests/canonical/hash-pins.test.ts :: ICAL-O43: the feed content hash is sha256 of the body and is stable across calls`.

### ICAL-I34. The hash excludes exactly what providers rewrite

**Lesson.** Providers normalise what we write. RFC 4791 §5.3.4 goes further: a strong ETag MUST NOT be
returned when the server rewrote the data, so an ETag round-trip cannot answer "did my write land
unchanged" — only a semantic hash can. Google and iCloud routinely rewrite DTSTAMP, SEQUENCE and property
order.
**Learned from.** RFC 4791 §5.3.4; `core/events/push-echo.ts` `isSameSerializedSecond`; commit `b057d2e0`.
**Honoured by.** The canonical projection excludes `DTSTAMP`, `SEQUENCE`, `PRODID`, `VERSION`, `CALSCALE`,
`CREATED`, `LAST-MODIFIED`, property and parameter ordering, line folding, and our own `X-` provenance
stamp. `SEQUENCE` is used for revision **ordering** (ICAL-I6) and kept out of the **content** hash; those
are two jobs and conflating them causes both echo-writes and stale-revision overwrites.
**Proved by.**
`tests/canonical/provider-roundtrip.test.ts :: ICAL-O14: ${rewrite.name} does not change the fingerprint`;
`tests/canonical/provider-roundtrip.test.ts :: ICAL-O17: sub-second precision a provider truncated does not change the fingerprint`;
`tests/canonical/rfc7986.test.ts :: ICAL-O42: adding ${decoration.split(`;
`tests/canonical/anchoring.test.ts :: ICAL-O57: the canonical rule is stable when a provider reorders a BYDAY list`.

### ICAL-I35. RFC 7986 decoration is not content

**Lesson.** `COLOR`, `IMAGE` and `CONFERENCE` (RFC 7986) are carried by some publishers and dropped by
Google's own ICS export, which stays on RFC 5545. A hash that includes them is a hash that changes when a
provider round-trips the event.
**Learned from.** RFC 7986 §5.9; Google Calendar's documented omission of COLOR from ICS export.
**Honoured by.** `canonicalFieldOrder` is a closed tuple; RFC 7986 properties are not in it. Google's
conference block remains a destination-adapter normalization concern (protocol ledger entry 47).
**Proved by.** `tests/canonical/rfc7986.test.ts :: ICAL-O42: adding ${decoration.split(`;
`tests/canonical/rfc7986.test.ts :: ICAL-I35: all three decorations together still hash as the undecorated event`.

### ICAL-I36. Descriptions are projected to plain text exactly once

**Lesson.** A second pass reads escaped entities (`Set &lt;timeout&gt;30&lt;/timeout&gt;`) as markup and
deletes the sentence — an unrecoverable content loss on a real calendar. Deep nesting must not throw either:
a throwing projection costs the calendar its mirror.
**Learned from.** `core/events/plain-text-description.ts`.
**Honoured by.** `src/canonical/plain-text.ts` is idempotent by construction and bounded by
`IcsLimits.maxDescriptionDepth`. Two details make the idempotence hold at the bound rather than only below
it: markup retained past the depth limit is escaped, so a second pass has no `<` left to strip, and the
double-encoding pass unwraps exactly one layer (`&amp;lt;` → `&lt;`) instead of decoding entities outright,
so it cannot un-escape what the first pass escaped.
**Proved by.**
`tests/canonical/plain-text.test.ts :: ICAL-L10: a 50k-deep tag nest returns a value instead of throwing or recursing`;
`tests/canonical/plain-text.test.ts :: ICAL-L10: maxDescriptionDepth is the bound that stopped it, not an incidental one`;
`tests/canonical/plain-text.test.ts :: ICAL-L10: the projection is idempotent, so a re-poll cannot re-strip the same text`;
`tests/canonical/plain-text.test.ts :: ICAL-L10: a nest deeper than the bound strips the same on a re-poll`;
`tests/canonical/plain-text.test.ts :: ICAL-I36: an entity is decoded exactly once, never twice`;
`tests/canonical/plain-text.test.ts :: ICAL-I36: plain text with no markup is returned unchanged`;
`tests/canonical/plain-text.test.ts :: ICAL-L10: the depth bomb completes well inside a scheduler tick`.

### ICAL-I37. Our own events are never echoed back

**Lesson.** Keeper-authored events carry a deterministic UID suffix and must be skipped at parse and counted
separately — but they must still be *present* (ICAL-I3), or skipping them deletes them.
**Learned from.** `core/events/identity.ts`; `parse-ics-events.ts` `isKeeperEvent`.
**Honoured by.** `src/parse/self-authored.ts` is a named predicate over the `X-` stamp and the UID suffix,
taking the `InstallationId` as an argument. The predicate runs on **every** VEVENT; the policy decides what
becomes of the answer, never whether the question is asked. Under `"exclude"` the event is a `selfAuthored`
outcome — present, counted, and carried onto `listing.withheld` (ICAL-I3) so the diff cannot delete our own
mirror. Under `"includeForRoundTrip"` it is emitted with `provenance: { kind: "ours", installation }`, the
shape the protocol models for exactly this; laundering it to `foreign` would hand the caller back its own
write as a source event. `src/serialise/serialise-resource.ts` writes the `X-KEEPER-INSTALLATION` stamp the
predicate looks for, so the recognition does not depend on the caller choosing our UID convention. The
provenance stamp is excluded from the fingerprint (ICAL-I34), so a provider that strips or preserves it
hashes the same either way.
**Proved by.**
`tests/serialise/write-fidelity.test.ts :: ICAL-O55: a resource we write is recognised as ours when it comes back in a feed`;
`tests/parse/self-authored.test.ts :: ICAL-O12: a feed of purely self-authored events yields zero usable events`;
`tests/parse/self-authored.test.ts :: ICAL-O12: the self-authored count matches the event count and is separate from unrepresentable`;
`tests/parse/self-authored.test.ts :: ICAL-O13: a self-authored event is still present, so the next diff cannot delete our own mirror`;
`tests/parse/self-authored.test.ts :: ICAL-O13: a foreign event beside ours is usable, so the skip is not a whole-feed refusal`;
`tests/parse/self-authored.test.ts :: ICAL-I37: another installation`;
`tests/parse/self-authored.test.ts :: ICAL-O13: a self-authored event is named on the listing a deletion is derived from`;
`tests/parse/self-authored.test.ts :: ICAL-I37: an event carrying our provenance is emitted as ours, never laundered into foreign`;
`tests/parse/self-authored.test.ts :: ICAL-I37: includeForRoundTrip makes our own events usable without changing presence`.

### ICAL-I38. Unchanged still reparses

**Lesson.** The unchanged short-circuit must not skip projection: `fetch-adapter` deliberately reparses
unchanged snapshot content so stored-state validation can recover from a bad previous write. Otherwise a
corrupt stored row can never heal.
**Learned from.** commit `a7c4be88` (#366); `create-snapshot.ts`.
**Honoured by.** Two distinct, distinctly-named hashes: `feedContentHash(body)` over the raw bytes, and
`canonicalEventFingerprint(event)` over the projection. `freshness: "changed" | "unchanged"` is a **field on
the result**, not an early return.
**Proved by.**
`tests/listing/unchanged.test.ts :: ICAL-O38: an unchanged body still yields the full projection`;
`tests/listing/unchanged.test.ts :: ICAL-O38: freshness is a field beside a complete listing, never an early return`;
`tests/listing/unchanged.test.ts :: ICAL-I38: the feed content hash and the canonical event fingerprint are different jobs`.

### ICAL-I39. The whole feed is retained; windowing is the caller's problem

**Lesson.** Filtering by the sync window inside the source adapter makes the snapshot diff delete the stored
state of every historic event on the next ingest, which is why the existing adapter's
`outsideSyncWindow` count is deliberately zero.
**Learned from.** `fetch-adapter.ts`; test *"returns events far outside the sync window so stored history
stays unbounded"*.
**Honoured by.** No entry point takes a sync window. The snapshot's `CoverageWindow` is built by
`coverageForWholeFeed(calendar)` and states that an ICS body is a complete statement of its collection. The
protocol has no "unbounded" coverage value, so the window is stated as the sentinel range
1800-01-01..2400-01-01 — wide enough that no calendar we mirror falls outside it, and erring in the safe
direction if one ever did (an event outside a declared coverage window is never deleted, protocol entry 3).
**Proved by.**
`tests/listing/no-window-argument.test-d.ts :: ICAL-O39: projectIcsFeed takes one request and nothing that could narrow the feed`;
`tests/listing/no-window-argument.test-d.ts :: ICAL-I39: coverageForWholeFeed is not parameterised by a window`;
`tests/listing/coverage.test.ts :: ICAL-O39: a 1998 event survives parsing even though the scope window starts in 2026`;
`tests/listing/coverage.test.ts :: ICAL-O39: coverage is the whole feed, so a snapshot diff can never infer a historic deletion`.

### ICAL-I40. Recurring events are one master plus RECURRENCE-ID overrides in one resource

**Lesson.** Emitting each override as a standalone VEVENT with a fresh UID made clients render **both** the
RRULE-expanded occurrence and the override — a visible duplicate on the user's calendar. CalDAV mandates the
same thing from the other direction: RFC 4791 §4.1 requires every component sharing a UID to live in one
calendar object resource, permits only one component type plus VTIMEZONEs, and forbids `METHOD`; violations
surface as `no-uid-conflict` and `valid-calendar-object-resource`.
**Learned from.** commit `71ac9ee1` (#387); RFC 4791 §4.1.
**Honoured by.** `serialiseCalendarResource` takes a `RecurrenceSet { master, overrides }` — a *set*, not a
component — so a caller physically cannot split a series across resources or mix two UIDs. There is no
`METHOD` field anywhere in the type.
**Proved by.**
`tests/serialise/resource.test.ts :: ICAL-O37: an override carrying a different UID is refused, never written`;
`tests/serialise/resource.test.ts :: ICAL-O37: an unrepresentable master is refused with a typed constraint`;
`tests/serialise/resource.test.ts :: ICAL-I40: a master with no overrides is still one resource`;
`tests/serialise/resource.test-d.ts :: ICAL-O37: the writer takes a recurrence set, not a component list`;
`tests/serialise/resource.test-d.ts :: ICAL-I40: a set names exactly one master and its overrides`.

### ICAL-I41. The fixture corpus is the canonicalisation regression net

**Lesson.** A corpus of real provider feeds (Google holidays, gov.uk, Hebcal, Meetup with VTIMEZONE+RRULE,
Outlook/Exchange Windows timezones, CalendarLabs, university feeds) is checked in, and every one is asserted
to parse **and** to produce an empty diff when re-diffed against its own parse output.
**Learned from.** `packages/fixtures/ics/*`; `ics-fixtures.test.ts`.
**Honoured by.** `@keeper.sh/fixtures` is a devDependency and the sweep is
parse → fingerprint → serialise → reparse → fingerprint, asserted equal per fixture.
**Proved by.**
`tests/fixtures/roundtrip.test.ts :: ICAL-O21: parse then serialise then parse is a fixed point for ${source.id}`;
`tests/fixtures/roundtrip.test.ts :: ICAL-I41: the corpus is non-empty and every fixture yields at least one canonical event`.

### ICAL-I42. Internal data fails loud; feed data fails soft

**Lesson.** A stored JSON recurrence payload that failed validation fell back to `null`, silently degrading a
recurring event into a one-off VEVENT — exactly the bug the change was meant to fix. One bad row failing the
endpoint loudly is preferable to wrong output.
**Learned from.** commit `71ac9ee1` (#387) sub-commit *"throw on invalid stored ICS recurrence/exception
data"*; user memory *fail loud on internal data*.
**Honoured by.** The two policies are distinguished by the function's **input type**, not by a flag:
`parseVevent(component: VeventComponent, …)` (external, total, never throws) versus
`parseStoredCanonicalEvent(value: unknown): CanonicalEvent` (internal, throws `IcsInternalDataError`).
**Proved by.**
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd nominal duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O45: an absurd exact duration is withheld, and its healthy sibling survives`;
`tests/parse/hostile-values.test.ts :: ICAL-O46: an impossible calendar date is refused rather than rolled into the next month`;
`tests/parse/hostile-values.test.ts :: ICAL-O46: an impossible clock time is refused rather than rolled into the next day`;
`tests/parse/hostile-values.test.ts :: ICAL-O47: a year outside the four-digit range in a zoned event does not abort the feed`;
`tests/parse/hostile-values.test.ts :: ICAL-O48: a non-numeric SEQUENCE never reaches the listing as a NaN revision`;
`tests/canonical/stored-event.test.ts :: ICAL-O41: ${payload.name} throws rather than degrading to a one-off`;
`tests/canonical/stored-event.test.ts :: ICAL-O41: the same malformation arriving from a feed is withheld and never throws`;
`tests/canonical/stored-event.test.ts :: ICAL-I42: the policy split is by input type, never by a leniency flag`.

### ICAL-I43. Unbounded work is this package's form of the missing ceiling

**Lesson.** The product has repeatedly shipped hangs. A pure parser cannot deadlock, but it can wedge: a
million-EXDATE VEVENT, a fold bomb, a `COUNT=2000000000` rule, a 400-year zone projection. The binary-search
transition finder is already bounded (log of the window) and must not regress to a linear scan.
**Learned from.** `timezone-instant.ts` `findTransitionInstant`; the brief's lockup obsession; commit
`1c5171d2`.
**Honoured by.** Every input-driven loop is bounded by a named field on `IcsLimits`, which arrives as an
argument. Exceeding a bound is a typed outcome — `unreadable/limitExceeded` at the document level,
`withheld/recurrenceBudgetExceeded` at the event level — never a slow success. The bound names state what
they bound: `maxComponentDepth` is the nesting depth of the open-component stack, which is what the walker
actually checks. `findZoneTransitions` clamps a caller-supplied window to `zoneProjectionYears` rather than
trusting it, so the ceiling is enforced rather than conventional.
**Proved by.**
`tests/limits/transition-search-ceiling.test.ts :: ICAL-L6: the search makes O(log window) probes per transition, not O(window)`;
`tests/limits/transition-search-ceiling.test.ts :: ICAL-L6: doubling the window does not square the probe count`;
`tests/limits/transition-search-ceiling.test.ts :: ICAL-L6: a fixed-offset zone finds no transitions and still terminates`;
`tests/limits/transition-search-ceiling.test.ts :: ICAL-L6: the whole projection window is searched inside a scheduler tick`;
`tests/limits/transition-search-ceiling.test.ts :: ICAL-L6: a caller-supplied window wider than the projection ceiling is clamped, not scanned`;
`tests/limits/exdate-flood.test.ts :: ICAL-L3: more EXDATEs than maxExceptionDates yields a single withheld outcome, not an expansion`;
`tests/limits/exdate-flood.test.ts :: ICAL-L3: the withheld event is not a silent drop, so its stored row survives`;
`tests/limits/exdate-flood.test.ts :: ICAL-L3: both healthy events beside it still project`;
`tests/limits/exdate-flood.test.ts :: ICAL-L3: an event exactly at the ceiling is still built`;
`tests/limits/exdate-flood.test.ts :: ICAL-L3: the flood is refused inside the ingest budget rather than consuming it`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: a body one octet over maxBytes is refused`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: a body exactly at maxBytes is not refused for size`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: the size check happens before the unfolding pass, so the work is bounded by the check`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: the refusal reaches the caller as a failed Result, never as an empty snapshot`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: the refusal is synchronous and arms no timer`;
`tests/limits/oversized-body.test.ts :: ICAL-L2: octets, not characters, decide the limit`;
`tests/limits/fold-bomb.test.ts :: ICAL-L4: more continuations than maxContentLines terminates with a refusal`;
`tests/limits/fold-bomb.test.ts :: ICAL-L4: the document refuses rather than completing the parse`;
`tests/limits/fold-bomb.test.ts :: ICAL-L4: a body just under the ceiling still unfolds`;
`tests/limits/fold-bomb.test.ts :: ICAL-L4: the unfold is linear in the number of lines, not quadratic`;
`tests/limits/fold-bomb.test.ts :: ICAL-L4: a body that is small on the wire but folds enormously is still refused`;
`tests/limits/component-nesting.test.ts :: ICAL-L5: nesting deeper than maxComponentDepth is refused`;
`tests/limits/component-nesting.test.ts :: ICAL-L5: the document refuses rather than overflowing the stack`;
`tests/limits/component-nesting.test.ts :: ICAL-L5: the walker never recurses, so the bound is structural rather than incidental`;
`tests/limits/component-nesting.test.ts :: ICAL-L5: nesting at the ceiling is walked without refusal`;
`tests/limits/component-nesting.test.ts :: ICAL-L5: the deep refusal returns inside a scheduler tick`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: Morocco`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: exactly zoneProjectionYears are projected, not more and not adaptively widened`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: a narrower ceiling projects fewer years, so the bound is the named limit`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: the validate-then-emit loop terminates inside a scheduler tick`;
`tests/limits/vtimezone-validation-bounds.test.ts :: ICAL-L8: a zone whose rule does stabilise still emits an annual rule under the same ceiling`;
`tests/limits/wall-time-probe-count.test.ts :: ICAL-L7: ${zone} resolves with at most two probes plus two verifications`;
`tests/limits/wall-time-probe-count.test.ts :: ICAL-L7: resolving a thousand wall times does not grow the per-resolution probe count`;
`tests/limits/wall-time-probe-count.test.ts :: ICAL-L7: a full feed`.

### ICAL-I44. Never `Bun.sleep`, and split the sweeps one test per file

**Lesson.** `Bun.sleep` is a native primitive `vi.useFakeTimers` cannot patch; polling sleeps had to be
rewritten onto `setTimeout`. Heavy sweep suites had to be split one-test-per-file so vitest could
parallelise them.
**Learned from.** commit `e39851df` *perf(ci): cut the test critical path (#808)*; commit `34dc5079`.
**Honoured by.** No `Bun.sleep` in `src/` or `tests/`; `tests/zone/sweeps/` is one test per file from the
start; the sweeps run against a fixed adversarial zone list (Australia/Lord_Howe, Pacific/Chatham,
Asia/Kathmandu, Africa/Casablanca, America/St_Johns, Pacific/Apia, Australia/Adelaide, Antarctica/Troll)
plus a seeded sample of the full tzdb, not the whole cross-product.
**Proved by.**
`tests/hygiene/no-bun-sleep.test.ts :: ICAL-L11: no file under src references the unfakeable sleep primitive`;
`tests/hygiene/no-bun-sleep.test.ts :: ICAL-L11: no file under tests references the unfakeable sleep primitive`;
`tests/hygiene/no-bun-sleep.test.ts :: ICAL-L11: the top-level entry point is synchronous, so no timing path exists to fake`;
`tests/hygiene/sweeps-are-split.test.ts :: ICAL-L12: every file under tests/zone/sweeps declares exactly one test`;
`tests/hygiene/sweeps-are-split.test.ts :: ICAL-L12: each sweep builds its own zone cache, so workers cannot share or poison state`.

### ICAL-I45. The ambient timezone is never read

**Lesson.** `packages/calendar`'s test script pins `TZ=UTC`; without it, wall-time tests pass or fail
depending on the developer's machine. The pin should be belt-and-braces, not load-bearing.
**Learned from.** `packages/calendar/package.json`.
**Honoured by.** Every zone-sensitive function takes an explicit `ZoneId`. The test script is
`TZ=UTC bun x --bun vitest run`, and one suite re-runs the projection under a non-UTC ambient zone.
**Proved by.** `tests/zone/wall-time.test.ts :: ICAL-I45: the resolution never reads the ambient timezone`;
`tests/zone/ambient-timezone.test.ts :: ICAL-I45: the projection is identical under UTC and under a zone fourteen hours ahead`;
`tests/zone/ambient-timezone.test.ts :: ICAL-I45: the projection is identical under a zone behind UTC`;
`tests/zone/ambient-timezone.test.ts :: ICAL-I45: the projection is non-empty, so the comparison is not vacuous`.

---

## Not applicable to sync-ical

### ICAL-I46. Deadlines, merged abort signals and lock release on throw

Every outbound await needs a deadline and a composed abort signal; listeners must be cleaned up when one
signal fires; `RequestTimeoutError` is distinguished from a caller abort by asking the timeout signal
itself, because both surface as the same `DOMException`
(`core/utils/fetch-with-timeout.ts`, `core/oauth/refresh-coordinator.ts`, commit `1c5171d2`).
**Not applicable.** sync-ical is pure and synchronous: it takes strings and values and returns values. It
performs no I/O, holds no lock, coalesces nothing, retries nothing and awaits nothing. Rather than invent an
async surface to satisfy the lockup brief, the guarantee is enforced structurally — no export is `async` or
returns a thenable, asserted by `ICAL-L1`. Deadlines and lease discipline belong to `sync-protocol`'s
`OperationContext` and to the sync-kit engine (protocol ledger entries 21, 50–52).
**Re-open condition.** If any streaming or incremental parse API is added here, it must take an
`AbortSignal`, must reject mid-flight, and this entry moves to Adopted. `ICAL-L1` is the tripwire that makes
that impossible to do quietly.

### ICAL-I47. Redirect ceilings and Authorization withholding

`MAX_REDIRECTS = 10`, and the `Authorization` header is withheld on a cross-origin redirect
(`utils/safe-fetch.ts`).
**Not applicable.** Transport belongs to a different sync-kit package. sync-ical parses text it is handed.
Recorded so the transport package inherits the lesson rather than rediscovering it.

### ICAL-I48. Rate limiting, backoff and quota scope

Quota acquired inside the retried operation; `Retry-After` capped; sleeps abortable.
**Not applicable.** Engine concern (protocol ledger entries 21, 23, 52). No network call exists here.

### ICAL-I49. Preconditions and typed conflicts on write

An update or delete without a precondition must be unspellable, and a stale precondition must yield a typed
conflict rather than a silent overwrite.
**Not applicable as a type here — honoured as an input.** The protocol already makes it unspellable
(`ObservedPrecondition` on `update`/`delete`/`retire`, ledger entry 9). What sync-ical owes that design is
the value `matchesFingerprint` compares: a fingerprint stable across a provider round trip (ICAL-I34). A
fingerprint that flapped would turn every conditional write into a spurious conflict, which is why
`tests/canonical/provider-roundtrip.test.ts` is listed as an overwrite test rather than a hashing test.

### ICAL-I50. Deletion authority, coverage windows and cursor semantics

RFC 6578 truncation, Google's 410, Graph's `@odata.deltaLink` versus `@odata.nextLink`, and the rule that
absence proves nothing outside a proven coverage window.
**Not applicable as behaviour.** sync-ical never sees a token and can only ever return `snapshot`. What it
must not do is offer an API that lets a caller confuse a partial read with a complete one — hence I1 and
I39, and the type test `tests/listing/listing-kind.test-d.ts :: ICAL-O40: a partial, cursorLost or delta
listing is not assignable to the projection`.

### ICAL-I51. Recurrence expansion

Materializing a series is expensive and bounded.
**Not applicable.** sync-ical hashes the recurrence **rule as written** (canonicalised: uppercase parts,
fixed part order, `UNTIL` normalised to UTC `Z` per RFC 5545 §3.3.10) and never expands it. Hashing an
expansion would inherit every expander's defects and every tzdb update — the hash would change under the
product's feet on a tzdata release with no calendar having changed.

### ICAL-I52. Destination representability

Google refuses a zero-duration event; Graph refuses end-before-start; CalDAV requires a strictly later
DTEND.
**Not applicable.** The canonical hash is computed over the **source** projection only; destination-side
widening is a different package and must not feed back (ICAL-I25). The protocol carries the constraint as
`Capabilities.representableRange` and the refusal as `WriteOutcome.unrepresentable`.

---

## Dependencies taken and rejected

### ICAL-I53. Rejected: ts-ics, because we now own the reader

The plan was to keep ts-ics (`^2.4.6`, latest as of 2026-08) for the encode/decode layer and own every
semantic above it. The implementation did not: `src/text/fold.ts`, `src/text/property-line.ts`,
`src/text/component-walk.ts` and `src/parse/parse-calendar.ts` are the reader, and they exist because the
lessons above demand things a strict reader will not do — attribute a property to a component *instance*
(ICAL-I11), fail closed on a boundary mismatch, re-emit untouched lines byte-for-byte through the patch
layer (ICAL-I13), and never throw for one bad VEVENT (ICAL-I2). With the reader owned, the dependency was
dead weight that a reader would nonetheless take as the description of the parse layer, so it is gone from
`package.json`. Nothing in `src/` or `tests/` imports it.

### ICAL-I54. Rejected: ical.js

The most complete implementation (libical's successor, Thunderbird's engine) and its `RecurExpansion` is
better than ours. Rejected because it brings a parallel timezone service and object model — a second source
of zone truth that can disagree with Intl, making the fingerprint depend on which path resolved the
instant — and because it would not fix ICAL-I19 while invalidating every existing patch fixture.

### ICAL-I55. Rejected: node-ical, rrule as a runtime dependency, rSchedule

node-ical bundles fetching and its own timezone handling — precisely the coupling this package exists to
avoid. rrule.js has long-standing UNTIL/DST defects (jkbrzt/rrule #65, #253, #452, #453, #480, #550:
series shifting an hour after a transition, `Invalid Date` for some zone strings) and stays confined to
`core/events/recurrence-materializer.ts` where it already lives; it never touches the hashing path.
rSchedule has a better timezone story but is effectively unmaintained and drags in luxon.

### ICAL-I56. Rejected: Temporal and temporal-polyfill

Temporal reached Stage 4 in March 2026 and ships in Chrome 144 / Firefox 139 / Node 26, but
`bun -e 'typeof Temporal'` prints `undefined` on this repo's Bun 1.3.14 — re-verified on 2026-08-15, not
taken on trust from the previous phase. The polyfill is ~50KB and ships its own view of zone rules that can
disagree with Intl. The Intl two-probe path is verified against 415k wall times and is ~7x faster than the
sweep it replaced. **Revisit only when** Bun ships Temporal natively **and** a sweep proves Temporal and
Intl name the same instant for every transition in the tzdb; `ZonedDateTime` disambiguation `"earlier"` and
`"compatible"` already match the fold and gap rules of ICAL-I20.

### ICAL-I57. Rejected: RFC 8785 (JCS) and fast-json-stable-stringify

JCS is designed for cross-language JSON interop and drags in ECMAScript number-serialisation rules this
package does not need; `packages/calendar` currently hand-rolls a subset **and** depends on
`fast-json-stable-stringify`, which is two implementations of one idea. sync-ical defines its own canonical
form instead (ICAL-I33) — a closed field-order tuple is a stronger guarantee than a key sort, because it
turns "someone added a field and forgot the hash" from a silent behaviour change into a compile error.

### ICAL-I58. Taken: Bun.CryptoHasher. Rejected: Bun.hash and crypto.subtle

`new Bun.CryptoHasher("sha256").update(x).digest("hex")` is synchronous, hardware-accelerated via BoringSSL,
already the repo idiom, and — decisively — lets every export stay synchronous, which is what makes ICAL-L1
enforceable. `crypto.subtle.digest` is Web-standard but async and would force the whole projection API into
promises for no benefit. `Bun.hash` (wyhash/xxHash3/rapidhash) is much faster but non-cryptographic and
seed/version-sensitive: a digest that changed across a Bun upgrade would re-sync every event in the product.
A test pins known digests so a runtime swap is caught rather than deployed.
**Proved by.**
`tests/canonical/hash-pins.test.ts :: ICAL-I58: the digest matches Bun.CryptoHasher sha256, so a primitive swap is visible here`.

### ICAL-I59. Rejected: fast-check

Property tests are driven by hand-rolled seeded permutations, matching the deterministic sweeps the repo
already writes. A generator library would add a devDependency and non-reproducible failures for marginal
gain over enumerating all permutations of a small feed, which is what the invariance tests actually need.

### ICAL-I60. Process

`bun install` in the worktree first. Tests run as `TZ=UTC bun x --bun vitest run` — never bare `bun test`,
which is the wrong runner and produces bogus *"vi.hoisted is not a function"* errors. turbo caches, so the
only real verdict is `bunx turbo run test lint types --force`. oxlint runs with the restriction category on:
no console, no ternaries anywhere, `eqeqeq`. No defect claim without a test that fails first — static reads
of this code have been wrong repeatedly.


## The test id scheme

Every test in this package is named `ICAL-<series><n>: <what it proves>`, and the "Proved by" lines above
cite that exact string, so the ledger can be walked against the suite by grep.

- `ICAL-I<n>` — the entry of this ledger the test honours, one for one.
- `ICAL-O<n>` — an **overwrite** obligation: a write, a deletion or a fingerprint that must not move. Each
  one fails before its guard exists; several of them below were written red against this implementation.
- `ICAL-L<n>` — a **lockup** obligation: a bound, a ceiling, or the absence of a timer or a promise.

### ICAL-O index — the overwrite family

- `ICAL-O1` (2) — tests/listing/no-wipe.test.ts — a body with no BEGIN:VCALENDAR never produces a listing
- `ICAL-O2` (2) — tests/listing/no-wipe.test.ts — an empty body is unreadable, not an empty snapshot
- `ICAL-O3` (1) — tests/listing/no-wipe.test.ts — a well-formed VCALENDAR with zero VEVENTs is an authoritative empty snapshot
- `ICAL-O4` (3) — tests/listing/withheld-is-present.test.ts — a withheld event is present and is never named by a removal
- `ICAL-O5` (1) — tests/listing/withheld-is-present.test.ts — a real deletion arriving in the same feed as a malformed VEVENT is still applied
- `ICAL-O6` (4) — tests/parse/stale-revision.test.ts — the UID is withheld rather than reverted to the time the publisher moved it away from
- `ICAL-O7` (2) — tests/parse/revision-order.test.ts — every permutation of the colliding revisions selects the same survivor
- `ICAL-O8` (2) — tests/parse/identity.test.ts — a later versioned master does not resurrect an unversioned slot
- `ICAL-O9` (3) — tests/parse/unsupported-recurrence.test.ts — it is reported unsupported rather than applied as a single-instance override
- `ICAL-O10` (3) — tests/text/component-walk.test.ts — an RDATE does not leak onto the next adjacent event
- `ICAL-O11` (3) — tests/text/component-walk.test.ts — a mismatched component boundary fails closed
- `ICAL-O12` (2) — tests/parse/self-authored.test.ts — a feed of purely self-authored events yields zero usable events
- `ICAL-O13` (3) — tests/parse/self-authored.test.ts — a self-authored event is still present, so the next diff cannot delete our own mirror
- `ICAL-O14` (1) — tests/canonical/provider-roundtrip.test.ts — ${rewrite.name} does not change the fingerprint
- `ICAL-O15` (2) — tests/canonical/provider-roundtrip.test.ts — an all-day event a provider re-emits on the UTC day grid hashes identically
- `ICAL-O16` (1) — tests/canonical/provider-roundtrip.test.ts — a destination widening a degenerate range does not change the source fingerprint
- `ICAL-O17` (1) — tests/canonical/provider-roundtrip.test.ts — sub-second precision a provider truncated does not change the fingerprint
- `ICAL-O18` (4) — tests/canonical/hash-invariance.test.ts — VEVENT order does not change the set of fingerprints
- `ICAL-O19` (2) — tests/canonical/hash-sensitivity.test.ts — changing ${mutation.name} moves the fingerprint
- `ICAL-O20` (1) — tests/canonical/hash-invariance.test.ts — hashing the canonical form twice is a fixed point through serialise and reparse
- `ICAL-O21` (1) — tests/fixtures/roundtrip.test.ts — parse then serialise then parse is a fixed point for ${source.id}
- `ICAL-O22` (2) — tests/parse/idempotent-diagnostics.test.ts — the second poll reports identical diagnostics
- `ICAL-O23` (2) — tests/parse/cancellation.test.ts — a cancelled RECURRENCE-ID override becomes a master exception at the exact instant
- `ICAL-O24` (2) — tests/parse/cancellation.test.ts — a cancelled master drops its detached overrides
- `ICAL-O25` (5) — tests/canonical/reanchor.test-d.ts, tests/canonical/reanchor.test.ts — DTSTART cannot be moved without its recurrence identities
- `ICAL-O26` (2) — tests/zone/observance-authority.test.ts — a wall time in the hour before a projected transition takes the instant IANA names
- `ICAL-O27` (1) — tests/zone/observance-authority.test.ts — an explicit observance set with no projection stays authoritative
- `ICAL-O28` (2) — tests/zone/resolve-identifier.test.ts — a VTIMEZONE that changes offset is refused rather than flattened
- `ICAL-O29` (1) — tests/zone/windows-zones.test.ts — a Windows identifier never survives into the canonical projection
- `ICAL-O30` (2) — tests/zone/windows-zones.test.ts — every mapped IANA name is known to Intl.supportedValuesOf
- `ICAL-O31` (3) — tests/serialise/zoned-date.test.ts — the first pass keeps its TZID and local wall time
- `ICAL-O32` (2) — tests/parse/floating.test.ts — only the floating entries of a mixed multi-value EXDATE are resolved
- `ICAL-O33` (1) — tests/parse/floating.test.ts — a floating EXDATE with no zone context is unsupported, not guessed
- `ICAL-O34` (1) — tests/parse/floating.test.ts — a TZID-qualified value ignores a contradicting X-WR-TIMEZONE
- `ICAL-O35` (5) — tests/text/patches/coerce-compliant-date.test.ts — a genuine calendar date is coerced to VALUE=DATE and round-trips
- `ICAL-O36` (4) — tests/text/patches/coerce-compliant-date.test.ts — a property carrying a TZID is never rewritten
- `ICAL-O37` (3) — tests/serialise/resource.test.ts, tests/serialise/resource.test-d.ts — an override carrying a different UID is refused, never written
- `ICAL-O38` (2) — tests/listing/unchanged.test.ts — an unchanged body still yields the full projection
- `ICAL-O39` (3) — tests/listing/no-window-argument.test-d.ts, tests/listing/coverage.test.ts — projectIcsFeed takes one request and nothing that could narrow the feed
- `ICAL-O40` (3) — tests/listing/listing-kind.test-d.ts — the projection
- `ICAL-O41` (2) — tests/canonical/stored-event.test.ts — ${payload.name} throws rather than degrading to a one-off
- `ICAL-O42` (1) — tests/canonical/rfc7986.test.ts — adding ${decoration.split(
- `ICAL-O43` (3) — tests/canonical/hash-pins.test.ts — the timed reference event hashes to a sha256 digest of the pinned length
- `ICAL-O44` (1) — tests/zone/build-vtimezone.test.ts — an identifier we cannot resolve refuses, rather than silently projecting UTC
- `ICAL-O45` (2) — tests/parse/hostile-values.test.ts — an absurd nominal duration is withheld, and its healthy sibling survives
- `ICAL-O46` (2) — tests/parse/hostile-values.test.ts — an impossible calendar date is refused rather than rolled into the next month
- `ICAL-O47` (1) — tests/parse/hostile-values.test.ts — a year outside the four-digit range in a zoned event does not abort the feed
- `ICAL-O48` (1) — tests/parse/hostile-values.test.ts — a non-numeric SEQUENCE never reaches the listing as a NaN revision
- `ICAL-O49` (1) — tests/parse/hostile-values.test.ts — an event-level RDATE is withheld and counted, never mirrored short
- `ICAL-O50` (2) — tests/listing/present-not-usable.test.ts — two distinct unversioned slots both survive rather than one silently winning
- `ICAL-O51` (2) — tests/listing/present-not-usable.test.ts — a cancelled event reaches the listing as a removal, never as a silent absence
- `ICAL-O52` (1) — tests/serialise/write-fidelity.test.ts — the VTIMEZONE covers the year the event itself occurs in
- `ICAL-O53` (2) — tests/serialise/write-fidelity.test.ts — a Windows identifier is written as the same zone the VTIMEZONE declares
- `ICAL-O54` (1) — tests/serialise/write-fidelity.test.ts — an all-day EXDATE is written as a DATE value, matching its DTSTART
- `ICAL-O55` (1) — tests/serialise/write-fidelity.test.ts — a resource we write is recognised as ours when it comes back in a feed
- `ICAL-O56` (1) — tests/canonical/anchoring.test.ts — a floating UNTIL is anchored to the series zone, not stamped as UTC
- `ICAL-O57` (1) — tests/canonical/anchoring.test.ts — the canonical rule is stable when a provider reorders a BYDAY list
- `ICAL-O58` (2) — tests/canonical/anchoring.test.ts — a range reclassified as all-day moves its cancelled days with its DTSTART

### ICAL-L index — the lockup family

- `ICAL-L1` (4) — tests/hygiene/purity.test.ts — no export is declared async
- `ICAL-L2` (6) — tests/limits/oversized-body.test.ts — a body one octet over maxBytes is refused
- `ICAL-L3` (5) — tests/limits/exdate-flood.test.ts — more EXDATEs than maxExceptionDates yields a single withheld outcome, not an expansion
- `ICAL-L4` (5) — tests/limits/fold-bomb.test.ts — more continuations than maxContentLines terminates with a refusal
- `ICAL-L5` (5) — tests/limits/component-nesting.test.ts — nesting deeper than maxComponentDepth is refused
- `ICAL-L6` (5) — tests/limits/transition-search-ceiling.test.ts — the search makes O(log window) probes per transition, not O(window)
- `ICAL-L7` (3) — tests/limits/wall-time-probe-count.test.ts — ${zone} resolves with at most two probes plus two verifications
- `ICAL-L8` (5) — tests/limits/vtimezone-validation-bounds.test.ts — Morocco
- `ICAL-L9` (4) — tests/zone/cache-memoisation.test.ts — a second projection for the same zone and reference year does no further Intl work
- `ICAL-L10` (5) — tests/canonical/plain-text.test.ts — a 50k-deep tag nest returns a value instead of throwing or recursing
- `ICAL-L11` (3) — tests/hygiene/no-bun-sleep.test.ts — no file under src references the unfakeable sleep primitive
- `ICAL-L12` (2) — tests/hygiene/sweeps-are-split.test.ts — every file under tests/zone/sweeps declares exactly one test

## Added after review

The three review lenses that read this package found guards the entries above claimed and the code did not
have. Each one is recorded here with the entry it belongs to, so the claim and the code agree.

### ICAL-I61. A policy decides what to do with an answer, never whether to ask the question

Provenance recognition was gated behind `selfAuthored === "exclude"`, so under `includeForRoundTrip` our own
VEVENTs were emitted stamped `{ kind: "foreign" }` — the protocol's `ours` arm existed and nothing could
reach it. Belongs to ICAL-I37. Proved by
`tests/parse/self-authored.test.ts :: ICAL-I37: an event carrying our provenance is emitted as ours, never
laundered into foreign`.

### ICAL-I62. Everything present must be sayable on the listing itself, not on a field beside it

`IcsFeedProjection.present` is a sync-ical field; `DeriveSnapshotRemovals` only ever sees the
`ChangeListing`. Anything present but not in `events`, `removals` or `withheld` therefore reads as deleted no
matter what `present` says. Self-authored events, superseded slots and cancelled events all sat in that gap.
Belongs to ICAL-I3 and ICAL-I9; it is why `withholdReasons` gained `selfAuthored` and `Removal`s of kind
`cancelled` are now emitted. Proved by the four `ICAL-O50`/`ICAL-O51` tests and
`tests/parse/self-authored.test.ts :: ICAL-O13: a self-authored event is named on the listing a deletion is
derived from`.

### ICAL-I63. A revision race must run inside one identity, never across two

Every non-override event of a UID went into one race and only the last survived, so two genuinely distinct
unversioned slots collapsed to one — the loser silently gone. Belongs to ICAL-I8 and ICAL-I6: masters race
masters, slots race only the same slot key, and a versioned master supersedes slots without deleting them.
Proved by `tests/listing/present-not-usable.test.ts :: ICAL-O50: two distinct unversioned slots both survive
rather than one silently winning`.

### ICAL-I64. A feed value must never reach arithmetic that can throw

`DURATION:P200000000D` and `DURATION:PT999999999999H` reached `Date` arithmetic and threw `RangeError` out of
`projectIcsFeed`, taking every healthy sibling with them; a year outside 1000–9999 did the same through the
`sv-SE` wall-clock reader. Belongs to ICAL-I2 and ICAL-I43. Proved by `ICAL-O45` and `ICAL-O47`.

### ICAL-I65. Rolling over an impossible value is a wrong write, not leniency

`DTSTART:20260231T120000Z` became 3 March and `...T250000Z` became the next day, because the DATE-TIME branch
fed `Date.UTC` unchecked while the DATE branch guarded itself. The event was then mirrored at a time the
publisher never stated. Belongs to ICAL-I16, which had only covered half the value space. Proved by
`ICAL-O46`.

### ICAL-I66. A magic reference year is a wrong VTIMEZONE

Both the serialiser and the synthesiser projected observances from a hardcoded 2026, so a 2019 event was
written beside a VTIMEZONE whose observances did not cover its own DTSTART. Belongs to ICAL-I30 and
ICAL-I31. Proved by `ICAL-O52`.

### ICAL-I67. The TZID we write must be the TZID we declare

`DTSTART;TZID=W. Europe Standard Time` was written beside `BEGIN:VTIMEZONE / TZID:Europe/Berlin` — a dangling
reference in a resource we PUT to a real calendar — and an unresolvable identifier silently became UTC.
Belongs to ICAL-I17 and ICAL-I31. Proved by the two `ICAL-O53` tests.

### ICAL-I68. A value type must match the property it excepts

All-day series wrote `EXDATE:20260312T000000Z` against a `VALUE=DATE` DTSTART. RFC 5545 §3.8.5.1 requires the
value types to match, and providers commonly ignore a mismatched EXDATE, so cancelled days resurrect on the
mirror. Belongs to ICAL-I26. Proved by `ICAL-O54`.

### ICAL-I69. We must be able to recognise our own writes

`serialiseCalendarResource` never emitted the `X-KEEPER-INSTALLATION` stamp `isSelfAuthored` looks for, even
though it was handed the `InstallationId`, so a resource we wrote came back as a foreign event unless the
caller happened to use our UID convention. Belongs to ICAL-I37. Proved by `ICAL-O55`.

### ICAL-I70. A canonical value is only canonical if the provider's rewrite of it is too

A floating `UNTIL` was stamped `Z` rather than anchored to the series zone — a two-hour-longer series written
back to the destination, not merely a hash artefact — and `BYDAY=MO,TU` hashed differently from
`BYDAY=TU,MO`, which is precisely the reordering ICAL-I34 says providers perform. Belongs to ICAL-I28 and
ICAL-I34. Proved by `ICAL-O56` and `ICAL-O57`.

### ICAL-I71. Refusing a legal-but-ambiguous input is not the same as parsing it wrong

Review asked for the RFC's combined `P1DT2H` duration to be accepted. It is refused, deliberately: it is one
nominal unit and one exact unit in a single value, and `OccurrenceDuration` models exactly that distinction
because flattening it lands an hour off across a DST boundary (ICAL-I23). The event is withheld with a
reason and counted, which is the outcome this ledger asks for, not a silent wrong time.


---

# sync-reconcile learnings ledger

`@keeper.sh/sync-reconcile` at `packages/sync-kit/reconcile`: pure planning. One function,
`planReconciliation(observed, known, mappings, policy) -> Plan`. No I/O, no clock, no provider, no database,
no `await`. This is the package that decides whether an event disappears from a real calendar, so the
overwrite obligations concentrate here and the lockup obligations are almost entirely structural.

Numbering is prefixed `RECON-` so it appends to the protocol (1–71) and sync-ical (`ICAL-I1`–`ICAL-I71`)
ledgers above without renumbering anyone. `RECON-I1`–`RECON-I44` are adopted. `RECON-I45`–`RECON-I54` are
not applicable and say why. `RECON-I55`–`RECON-I62` are the dependency and process decisions. The module
map, the public API and the `RECON-O` / `RECON-L` test indexes are the closing sections.

Every **Proved by** line names a file under `packages/sync-kit/reconcile/tests` and the exact test name
inside it, so the ledger can be walked against the suite by grep. This document is written **before** the
implementation: it is the specification the implementation and the review are held to.

## Module map

```
src/index.ts                        the public surface and nothing else
src/errors.ts                       ReconcileInternalDataError — our own broken invariants only
src/policy.ts                       ReconciliationPolicy, PlanLimits, defaultPlanLimits,
                                    defaultWindowMembership (the ONLY import of sync-ical in src/)
src/coverage.ts                     ProvenCoverage (unproven | proven), per-axis, per-source-calendar;
                                    insideProvenCoverage
src/identity/source-identity.ts     SourceIdentity + sourceIdentityKey — the one key builder, NUL-joined
src/identity/calendar-key.ts        calendarKeyString — NUL-joined provider/account/calendar
src/identity/fingerprints.ts        SourceFingerprint and MirrorFingerprint wrappers; sameSource, sameMirror
src/state/observed.ts               ObservedState = sourceOnly | bothSides
src/state/known.ts                  KnownState, KnownEvent, CorruptKnownRow
src/state/mappings.ts               Mapping, MappingSet and its two indexes
src/state/dedupe.ts                 at most one observed item per identity, chosen by revision order
src/presence/presence-basis.ts      the PRESENCE basis — withheld items included
src/presence/write-basis.ts         the WRITE basis — withheld items excluded
src/presence/authority.ts           ListingAuthority: what a listing kind may claim (whole scope, named
                                    removals only, nothing) — the one gate on every deletion path
src/presence/removals.ts            the exhaustive switch over listing.kind -> authoritative removals
src/plan/plan.ts                    Plan, PlannedWrite, Tombstone, Unresolved, Conflict, CursorDecision
src/plan/plan-reconciliation.ts     the entry point: guard clauses, no nesting, no else-after-return
src/plan/echo.ts                    the provenance guard, applied before anything else
src/plan/writes.ts                  create / update / replace derivation, each carrying its precondition
src/plan/tombstones.ts              the two deletion causes, each gated on its own window
src/plan/conflicts.ts               precondition divergence -> a typed, classified Conflict
src/plan/reassignment.ts            occurrence re-identification, bounded pairing
src/plan/cursor.ts                  advance | hold | reset, decided independently of the writes
src/plan/order.ts                   the total order over writes: instant, then retire-before-write, then key
src/plan/diagnostics.ts             BoundedSample builders capped by count AND bytes
```

## Public API

```ts
const planReconciliation = (
  observed: ObservedState,
  known: KnownState,
  mappings: MappingSet,
  policy: ReconciliationPolicy,
): Plan
```

Synchronous, total, and pure. Everything else the package exports is a type, an `as const` reason set, or a
named pure helper (`sourceIdentityKey`, `calendarKeyString`, `insideProvenCoverage`, `comparePlannedWrites`,
`sourceFingerprintOf`, `mirrorFingerprintOf`, `defaultPlanLimits`, `defaultWindowMembership`).

---

## Adopted

### RECON-I1. An empty or failed listing is not an authoritative empty calendar

**Lesson.** The ICS fetch adapter caught its own failure and returned `{ events: [] }`; ingest read that as
"the source has zero events" and deleted every stored row for the calendar. "Listed and empty", "unchanged"
and "failed/unknown" must be three different values, never one empty array.
**Learned from.** commit `0184ea19` *fix(ics): don't wipe existing events when remote fetch fails (#383)*;
`packages/calendar/src/ics/utils/fetch-adapter.ts`; tests *"does not delete stored source events when the
fetch throws"*, *"propagates fetch errors instead of returning empty events"*.
**Honoured by.** `sync-protocol` already made this a type: `ChangeListing` is
`snapshot | delta | partial | cursorLost`, and only `snapshot` and `delta` carry a `coverage` field at all —
`partial` and `cursorLost` declare `coverage?: never`. `src/presence/removals.ts` reaches
`listing.coverage` on exactly two arms, so a tombstone derived from a `partial` listing does not typecheck.
A failure never becomes a listing: it is `Result.ok === false`, which never reaches `planReconciliation`.
**Proved by.**
`tests/deletion/no-wipe.test.ts :: RECON-O1: a partial listing omitting every known event tombstones none of them`;
`tests/deletion/no-wipe.test.ts :: RECON-O1: a partial listing whose scope is not the mirror window still retires nothing`;
`tests/deletion/no-wipe.test.ts :: RECON-O2: a cursorLost listing whose scope is not the mirror window retires nothing either`;
`tests/deletion/listing-kind.test-d.ts :: RECON-I1: a partial listing declares no coverage and no removals`.

### RECON-I2. Absence implies deletion only for a snapshot; a delta deletes only what it names

**Lesson.** For a delta listing, removal is computed only from explicitly reported deleted/cancelled ids; an
event merely absent from a delta page is untouched. RFC 6578 says the same thing normatively — only a
resource reported with `404` is a confirmed deletion, and §3.6 lets a server truncate the report while
returning a still-valid sync token, so absence in that response is indistinguishable from omission.
**Learned from.** `packages/calendar/src/core/source/event-diff.ts` `buildSourceEventStateIdsToRemove`
(`isDeltaSync` branch); RFC 6578 §3.6, §3.8; Google's sync guide (`410 GONE` invalidates a token); Graph's
`event: delta` (`410 resyncRequired`).
**Honoured by.** `src/presence/removals.ts` is the switch the brief mandates, exhaustive via
`assertNever`: `delta` -> `listing.removals` narrowed to `AuthoritativeRemoval` (`deleted | cancelled`, never
`outOfScope`); `snapshot` -> `absentWithinCoverage(listing, known, policy)`; `partial` and `cursorLost` ->
`[]`. There is no set-difference path anywhere else in the package. An `outOfScope` removal is **not**
silently discarded, which is what RECON-I29 would forbid: it is carried on the basis as
`outOfScope: readonly RemoteEventId[]` and surfaces as `Unresolved{ reason: "removalOutOfScope" }` — the
provider told us it stopped listing the event, which is not a claim that the event stopped existing.
**Proved by.**
`tests/deletion/delta-authority.test.ts :: RECON-O3: a delta naming every known event does remove every one of them`;
`tests/deletion/delta-authority.test.ts :: RECON-O3: one cancelled occurrence retires only the occurrence it names`;
`tests/deletion/delta-authority.test.ts :: RECON-O3: an outOfScope removal is not an authoritative deletion`;
`tests/deletion/removals-switch.test.ts :: RECON-I2: every listing kind is answered, none falls through`.

### RECON-I3. Deletion is never inferred outside a PROVEN coverage window, and the proof is per source

**Lesson.** Reconciliation carried `authoritativeWindow: SyncWindow | null` plus per-source windows; `null`
meant "coverage unverified" and suppressed every inferred delete. A mapping inside the requested window but
outside its own source's verified coverage was skipped entirely — neither deleted nor re-added.
**Learned from.** `packages/calendar/src/core/sync/operations.ts` `getSourceAuthoritativeWindow`,
`isInsideSourceAuthoritativeWindow`; tests *"does not reconcile a mapping inside the requested window but
outside source coverage"*, *"does not re-add an event whose mapping sits between recorded coverage and the
requested edge"*.
**Honoured by.** `ProvenCoverage` is a union, not a nullable: `{ kind: "unproven" }` has no window fields to
read. The policy carries `coverageBySource: ReadonlyMap<string, ProvenCoverage>` keyed by
`calendarKeyString`, so coverage is per source calendar. A mapping whose source has `unproven` coverage, or
whose time falls outside proven coverage, becomes `Unresolved{ reason: "outsideProvenCoverage" }` — never a
tombstone and never a rewrite.
**Proved by.**
`tests/coverage/proven-coverage.test.ts :: RECON-O4: the identical inputs under proven coverage tombstone exactly one`;
`tests/coverage/proven-coverage.test.ts :: RECON-O5: an event in the gap between recorded coverage and the requested edge is neither deleted nor re-added`;
`tests/coverage/proven-coverage.test.ts :: RECON-O4: the same absence is reported as unresolved rather than silently dropped`;
`tests/coverage/proven-coverage.test-d.ts :: RECON-I3: the unproven arm carries no windows to read by accident`.

### RECON-I4. Coverage is per axis — historic and future are separate ranges

**Lesson.** A narrow destination must not prune a shared source baseline, and a wide future range must not
leak into the historic axis. The engine needed `coverage { historicRange, futureRange, window }` to stop it.
**Learned from.** `packages/calendar/src/core/sync-engine/ingest.ts` coverage shape; tests *"does not let a
narrow destination prune the shared source baseline"*, *"does not let a wide future range leak into the
historic axis"*.
**Honoured by.** `ProvenCoverage.proven` carries `historic: TimeWindow` and `future: TimeWindow` as two
fields, not one min/max pair, and `insideProvenCoverage` requires membership of the axis the event's own
instant falls on. The planner never unions coverage across sources or destinations.
**Proved by.**
`tests/coverage/axes.test.ts :: RECON-O6: proving only the future axis deletes only the future absence`;
`tests/coverage/axes.test.ts :: RECON-O6: the historic absence is reported unresolved, not silently ignored`;
`tests/coverage/axes.test.ts :: RECON-O6: the historic absence is reported unresolved, not silently ignored`.

### RECON-I5. The requested window and the proven window are different windows with different powers

**Lesson.** Both edges of the *requested* window legitimately retire a mirror — the source event is retained
in our own store, so retiring narrows scope rather than losing data. Absence-based deletion is gated on the
*authoritative* window instead. Confusing the two is how mass deletion happens.
**Learned from.** `operations.ts` `buildRemoveOperations` (`outsideCleanupWindow` vs
`insideAuthoritativeWindow`); tests *"does not remove mapped events from before the sync window"*, *"a window
that moves between runs"*, `degenerate-range-sliding-window-convergence.test.ts`.
**Honoured by.** `ReconciliationPolicy.mirrorWindow: TimeWindow` and `policy.coverageBySource` are separate
named fields of different types. The two causes are distinct members of `tombstoneCauses`:
`outsideMirrorWindow` (requested-window-gated, retires the mirror, keeps our row) and `absentFromSnapshot`
(coverage-gated). A reviewer can see which rule fired from the plan alone.
**Proved by.**
`tests/deletion/two-windows.test.ts :: RECON-O7: an event inside proven coverage but outside the mirror window retires the mirror`;
`tests/deletion/two-windows.test.ts :: RECON-O7: the source baseline row is never dropped by a mirror-window retirement`;
`tests/deletion/two-windows.test.ts :: RECON-O7: no identity ever carries both an absence cause and a window cause`.

### RECON-I6. Presence and writability are two different sets

**Lesson.** Ingestion filtered withheld uids out of the insert basis but computed removals against the
*unfiltered* feed. Getting this wrong mass-deletes a stalled series and mass-re-adds it the moment the window
moves. Every data-loss incident in this codebase had that one shape.
**Learned from.** `ingest.ts` (*"Removal is computed against the unfiltered fetch"*);
`ReconciliationScope.withheldSourceEventStateIds`; tests *"never deletes the stored row of the event it
withholds"*, *"settles: an unsupported uid is never inserted and never deleted"*.
**Honoured by.** Two modules with two names: `src/presence/presence-basis.ts` builds the identity set that
counts as present (observed events **plus** `listing.withheld`), and `src/presence/write-basis.ts` builds the
set eligible for a write (observed events only). Tombstones are computed against the presence basis; writes
against the write basis. `sync-ical` already separates `present` from `usable` for the same reason
(ICAL-I3), and the protocol carries `withheld` on the listing itself so this planner does not have to trust
a field beside it.
**Proved by.**
`tests/presence/withheld-is-present.test.ts :: RECON-O8: the withheld identity is reported once, as withheldBySource`;
`tests/presence/withheld-is-present.test.ts :: RECON-O8: ten consecutive polls that withhold the same item plan nothing at all`;
`tests/presence/withheld-is-present.test.ts :: RECON-O8: the withheld identity is reported once, as withheldBySource`;
`tests/presence/withheld-is-present.test.ts :: RECON-O28: one withheld item does not suppress a real deletion in the same payload`.

### RECON-I7. Only our own provenance may be deleted from a destination

**Lesson.** An unmapped remote event is deleted only if it is ours, and source ingestion applies the mirror
of the rule so a mirrored calendar never re-ingests its own writes. Keeper reads its own CalDAV writes back;
a mirror near a DST boundary looked moved and was deleted and re-created on every run, forever.
**Learned from.** `packages/calendar/src/core/events/identity.ts`; `operations.ts`
(`if (!remoteEvent.isKeeperEvent) continue`); commit `b057d2e0` (#616); test *"parses external events and
skips keeper-managed events"*.
**Honoured by.** Provenance is a typed property of the observed event (`ForeignEvent | OwnEvent |
IndeterminateEvent`), resolved at the provider boundary, never a string check at the call site.
`src/plan/echo.ts` is a guard clause at the top of planning: a source event whose provenance is `ours` is
mirrored nowhere and tombstoned nowhere. Only a destination event that is `ours` **and** carries our own
`InstallationId` may be retired as an orphan — but **retiring destination orphans is out of scope for this
package**. The planner only ever proposes deletions of mirrors it holds a `Mapping` for; an unmapped
destination event is either reported (`provenanceIndeterminate`) or left entirely alone. `isRetirable` is
exported as the single predicate an orphan-sweeping caller must use, and is unit-tested here so that the
rule is pinned before anything consumes it; nothing inside `src/` calls it, deliberately.
**Proved by.**
`tests/provenance/echo.test.ts :: RECON-O13: an event in the source stamped as ours is never mirrored back`;
`tests/provenance/echo.test.ts :: RECON-O13: our own echo is not read as an absence either`;
`tests/provenance/echo.test.ts :: RECON-O14: a mirror stamped with another installation is never retired as an orphan`;
`tests/provenance/echo.test.ts :: RECON-O15: an indeterminate destination event with no mapping is never deleted`.

### RECON-I8. Provenance may be undetectable, and that must be sayable

**Lesson.** A provider with no provenance channel returns events we cannot attribute. Treating unattributable
as foreign deletes our own mirrors; treating it as ours abandons real user events.
**Learned from.** protocol ledger entry 43; `Capabilities.provenanceChannel: "extendedProperty" | "uidSuffix"
| "none"`.
**Honoured by.** `IndeterminateEvent` is a third arm and reaches `Unresolved{ reason:
"provenanceIndeterminate" }`. It is never a delete target and never a mirror source.
**Proved by.** `tests/provenance/echo.test.ts :: RECON-O15: an indeterminate event is classified distinctly from a foreign one`;
`tests/provenance/echo.test.ts :: RECON-O14: our own orphaned mirror IS retirable`.

### RECON-I9. Identity is (UID, recurrence identity) and nothing mutable

**Lesson.** `packages/calendar`'s `eventIdentityKey` folds start, end, timezone, RRULE, EXDATE and
availability into the key, so every content edit diffs as remove + add. On a read-only mirror that is churn.
On write-back it is a DELETE of a real calendar event followed by a CREATE, which loses attendee RSVPs,
conferencing links and provider event ids, and is unrecoverable.
**Learned from.** `ics/utils/diff-events.ts` `eventIdentityKey`; tests *"detects time change as add + remove
for same uid"*, *"adds and removes when timezone changes"*, *"adds and removes when recurrence payload
changes"*.
**Honoured by.** `SourceIdentity` reuses `sync-ical`'s three-shape `EventIdentity` (`master`, `override`,
`slot`) — RFC 5545 §3.8.4.7 UID plus §3.8.4.4 RECURRENCE-ID — and carries no content. Content lives in the
fingerprint. Identity match + fingerprint divergence emits an **update**; a delete is emitted only when an
identity disappears from a listing with the authority to say so. The corollary review found missing: an
`AuthoritativeRemoval` names `(id, uid)`, and **the bare UID is not an identity**. Resolving a removal
through `byUid` fans a single cancelled occurrence out over every sibling of the series — Microsoft Graph
occurrences share the series `iCalUId`, so that is a whole-series wipe from one instance. `KnownEvent` now
carries the `RemoteEventId` it was ingested under, `KnownIndex.byRemoteId` is the primary lookup, and the
uid is consulted only when it names exactly one row. A uid naming several rows whose id matches none is
`Unresolved{ reason: "unmatchedRemoval" }`, never a fan-out.
**Proved by.**
`tests/identity/identity-is-not-content.test.ts :: RECON-O33: editing ${field} plans zero deletes and zero creates`;
`tests/identity/identity-is-not-content.test.ts :: RECON-O33: editing every content field at once is still one update`;
`tests/identity/identity-is-not-content.test.ts :: RECON-O33: editing ${field} plans exactly one update`.

### RECON-I10. One canonical key builder, joined on a delimiter the data cannot contain

**Lesson.** Identity keys are built by joining fields, so the delimiter must be one that cannot occur in the
data. `packages/calendar` moved to NUL after event text containing the delimiter merged two identities.
**Learned from.** `operations.ts` `getSerializedSlotKey`, `getRemoteIdentity` (`${uid}\0${deleteId}`); test
*"does not confuse field boundaries when event text contains identity delimiters"*.
**Honoured by.** `sourceIdentityKey` and `calendarKeyString` join on `String.fromCodePoint(0)`. RFC 5545
§3.1 forbids control characters in a TEXT value, so NUL cannot appear in a UID; `|` and `:` provably can.
**Open item raised, not silently inherited.** `sync-ical`'s exported `eventIdentityKey`
(`packages/sync-kit/ical/src/parse/identity.ts`) joins on `|`, and a UID containing `|` can be made to
collide a `slot` identity with a different `slot` identity. `sync-reconcile` therefore builds its own keys
and never re-derives identity from that string. This is filed here rather than fixed across a package
boundary in this branch.
**Proved by.**
`tests/identity/delimiter.test.ts :: RECON-O29: two identities that collide under a pipe join stay distinct under ours`;
`tests/identity/delimiter.test.ts :: RECON-O29: two identities that collide under a pipe join stay distinct under ours`;
`tests/identity/delimiter.test.ts :: RECON-O29: the latent collision in sync-ical's pipe-joined key is real, which is why it is not reused`.

### RECON-I11. Source-side and mirror-side fingerprints must not be comparable

**Lesson.** A destination widening a zero-duration mirror made the stored source row look changed, and the
planner flipped add/remove forever. Window membership and equality must be judged on the representable
(published) span, and the two sides' hashes must never be compared to each other.
**Learned from.** `core/events/time-range.ts` `overlapsRepresentableTimeWindow`; commit `b057d2e0` (#616);
tests *"does not oscillate between adding and retiring a zero-duration event"*, *"does not treat a stored
source row as changed after a destination widened its mirror"*.
**Honoured by.** `src/identity/fingerprints.ts` wraps the protocol's `Fingerprint` in two distinct
interfaces, `SourceFingerprint` and `MirrorFingerprint`, each with its own `kind` discriminant. They are
structurally incompatible, so comparing them is a compile error — achieved with wrapper objects and named
constructors, not a type assertion. `sameSource` and `sameMirror` are the only equality functions.
**Proved by.**
`tests/fingerprints/two-sided.test-d.ts :: RECON-O21: a source fingerprint is not assignable to a mirror fingerprint`;
`tests/fingerprints/two-sided.test-d.ts :: RECON-O21: a mirror fingerprint is not assignable to a source fingerprint`;
`tests/fingerprints/two-sided.test.ts :: RECON-O21: the mirror comparator is a separate relation with the same discipline`;
`tests/fingerprints/two-sided.test.ts :: RECON-O21: two source fingerprints with the same value compare equal`.

### RECON-I12. Normalisation happens before the fingerprint, never in the serializer

**Lesson.** Shaping must happen before the content hash is taken, so the mapping, the content hash and the
pushed resource agree on one range. Content hashing must also normalise what providers legitimately rewrite:
CRLF to LF, trim, default availability, whole-second truncation, sorted exception dates.
**Learned from.** `core/events/content-hash.ts` `normalizeText`/`normalizeAvailability`; `operations.ts`
`isSameSerializedSecond`; commit `b057d2e0`; tests *"does not churn when a destination serializes timestamps
to whole seconds"*, *"does not churn when a provider coerces unsupported OOO availability to busy"*.
**Honoured by.** `sync-reconcile` computes no hash. `MirrorFingerprint` is produced by
`CalendarProvider.normalize` -> `NormalizedContent.fingerprint` (the shaped, destination-representable
content); `SourceFingerprint` is produced by `sync-ical`'s `canonicalEventFingerprint` over the canonical
source projection. Both arrive as inputs. The planner's only equality operation is comparing two values of
the same brand, which is exactly the discipline that keeps shaping upstream of comparison.
**Proved by.**
`tests/fingerprints/provider-rewrite.test.ts :: RECON-O21: a genuine mirror edit, carrying a different mirror fingerprint, IS a conflict`;
`tests/fingerprints/provider-rewrite.test.ts :: RECON-O21: a genuine mirror edit, carrying a different mirror fingerprint, IS a conflict`;
`tests/fingerprints/provider-rewrite.test.ts :: RECON-O21: ${name} does not make the source row look changed`.

### RECON-I13. An update or a delete without a precondition must be unspellable

**Lesson.** A write without a precondition is a silent overwrite. Google Calendar documents `If-Match`
against the event ETag and answers `412 preconditionFailed`; CalDAV mandates `If-Match` on the resource ETag
(RFC 4791) with RFC 6638 §8.3 adding `If-Schedule-Tag-Match`; Graph uses `If-Match` with `@odata.etag`.
**Learned from.** Google *Get specific versions of resources* and *Handle API errors*; RFC 4791; RFC 6638;
`operations.ts` `identifyStaleMappings`.
**Honoured by.** The protocol already did it: `WriteIntent.update`, `.delete` and `.retire` carry
`precondition: ObservedPrecondition` in a required position, and `.create` carries
`Extract<Precondition, { kind: "absent" }>`. `sync-reconcile` does not redefine the type — every
`PlannedWrite` wraps a protocol `WriteIntent`, so the guarantee is inherited rather than restated, and a
planner that wanted to skip a precondition could not construct the value.
**Proved by.**
`tests/writes/precondition-required.test-d.ts :: RECON-O9: an update without a precondition does not typecheck`;
`tests/writes/precondition-required.test-d.ts :: RECON-O9: a delete without a precondition does not typecheck`;
`tests/writes/precondition-required.test-d.ts :: RECON-O9: a create carries the absent precondition and nothing else`;
`tests/writes/precondition-required.test.ts :: RECON-O9: no write in the plan carries a missing precondition`.

### RECON-I14. A stale precondition is a typed conflict value, never a thrown error and never an overwrite

**Lesson.** Mappings stored the local content hash and the remote's editable-content hash and availability;
an update was planned only when a precondition actually diverged, and the reason was classified rather than
collapsed into "changed". That breakdown is what made real incidents diagnosable. A thrown error would tempt
a catch-and-retry that becomes the overwrite the precondition was preventing.
**Learned from.** `operations.ts` `StaleReasonCounts`, `getRemoteStateChanges`; test *"restores destination
content edited without a time change"*.
**Honoured by.** `Plan.conflicts` is a first-class array. `conflictCauses` is an `as const` object with a
derived union: `sourceChanged`, `mirrorContentChanged`, `mirrorTimeChanged`, `mirrorAvailabilityChanged`,
`mirrorMissing`, `mirrorReassigned`. A `Conflict` carries the `expected` and `observed` preconditions.
`planReconciliation` never throws on provider data.
**Proved by.**
`tests/writes/stale-precondition.test.ts :: RECON-O10: a mapping recorded at v1 against an observed v2 yields a conflict`;
`tests/writes/stale-precondition.test.ts :: RECON-O10: the conflict carries both the expected and the observed precondition`;
`tests/writes/stale-precondition.test.ts :: RECON-O11: ${expectedCause} is classified as itself, not collapsed`;
`tests/writes/stale-precondition.test.ts :: RECON-O11: the six conflict causes are distinct and none is a catch-all`.

### RECON-I15. Two concurrent writers: one of them must see a conflict

**Lesson.** Concurrent runs need a fencing check immediately before the write, and it must fail closed. Two
plans built from the same base revision must not both apply.
**Learned from.** `core/sync-engine/generation.ts` `createRedisGenerationCheck`; tests *"does not mutate the
provider when reconciliation is superseded before comparison"*, *"finishes a replacement before observing
that the generation is stale"*.
**Honoured by.** Structurally, by RECON-I13: both plans carry the same `ObservedPrecondition`, so applying
the first moves the remote version and the second's precondition is stale by construction. The planner is
pure, so the *fencing* belongs to the applier — which is exactly why `Plan.cursor` is a separate field
(RECON-I17).
**Proved by.**
`tests/writes/concurrent-writers.test.ts :: RECON-O31: both writers plan the same single update from the shared base`;
`tests/writes/concurrent-writers.test.ts :: RECON-O31: after the first writer lands, the second replans as a conflict, not an overwrite`;
`tests/writes/concurrent-writers.test.ts :: RECON-O31: replanning from the state the first writer left is a no-op, not a second write`.

### RECON-I16. A replayed create is a no-op, and the observed identity outranks the mapping

**Lesson.** Google push failures produced duplicates because no mapping was ever recorded, so the same add
was recomputed every run — one calendar was failing about fifty times an hour.
**Learned from.** commit `b057d2e0` (#616), first bullet; `operations.ts`.
**Honoured by.** Every `create` carries `IdempotencyKey` derived deterministically from
`(destination calendar, source identity)` via `sourceIdentityKey` — the same derivation the provider writes
as its native idempotency identity — and the precondition `{ kind: "absent" }`. A create is suppressed
whenever a mapping binds the identity; replanning the same input is therefore byte-identical, so a replay
carries the same key and the provider collapses it.

**Amended after review.** The ledger previously also claimed the planner suppresses a create when the
*destination listing* already shows an event under that idempotency identity. It does not, and it cannot:
`RemoteEvent` carries no idempotency key and nothing else on a destination event links it back to a source
identity, so there is no expressible comparison. Recovering a lost mapping from the destination listing
needs a provider-side lookup by idempotency key, which is I/O and therefore outside a pure planner. The
guarantee against a duplicate on a lost mapping rests on `IdempotencyKey` plus `precondition: absent` at the
provider, which is where the protocol put it. Recorded rather than quietly dropped.
**Proved by.**
`tests/writes/idempotent-create.test.ts :: RECON-O12: replanning after the create landed produces no second create`;
`tests/writes/idempotent-create.test.ts :: RECON-O12: with the mapping deliberately missing the observed identity is still authoritative`;
`tests/writes/idempotent-create.test.ts :: RECON-O12: an unmapped observed event produces exactly one create`;
`tests/writes/idempotent-create.test.ts :: RECON-O12: an already mapped and unchanged event plans nothing`.

### RECON-I17. The cursor is a field the applier can drop without dropping the writes

**Lesson.** Never write a sync token on the superseded path, and never advance a cursor past work you did not
durably apply — but a superseded run must still be able to flush the work it already did.
**Learned from.** `generation.ts`; `ingest.ts`; tests *"never writes a sync token on the superseded path"*,
*"emits a wide event with outcome superseded but flushed when generation becomes stale"*.
**Honoured by.** `Plan.cursor: CursorDecision` is a sibling of `writes` and `tombstones`, not a property of
them. `CursorDecision` is `advance | hold | reset` — three arms, so "we did not advance" is never expressed
as an absent string. The applier's input type is `Omit<Plan, "cursor">` plus an explicit cursor argument, so
dropping the advance is the ordinary path rather than a special case.
**Proved by.**
`tests/cursor/independence.test.ts :: RECON-O25: an unchanged listing carrying a new cursor still advances it`;
`tests/cursor/independence.test.ts :: RECON-O25: the cursor decision is reachable without building the writes at all`;
`tests/cursor/independence.test-d.ts :: RECON-O27: the applicable plan exposes no cursor field to write by accident`;
`tests/cursor/independence.test.ts :: RECON-I17: a partial listing holds because the listing is incomplete, not because nothing changed`.

### RECON-I18. A cursor is valid only for the request shape that minted it

**Lesson.** Sync tokens were stored as `keeper:sync-token:<windowVersion>:<base64url>`; a newer required
window version discarded the token and forced a full sync. Widening the window while silently reusing an old
delta token leaves the newly covered span permanently unpopulated. Both providers agree: Google refuses
`syncToken` combined with `timeMin`/`timeMax` at all and requires the remaining parameters to match the
initial sync; Graph encodes `startDateTime`/`endDateTime` into the `deltaLink` and expects the exact link to
be replayed.
**Learned from.** `core/oauth/sync-token.ts` `resolveSyncTokenForWindow`; Google *Synchronize resources
efficiently*; Graph *event: delta*; the protocol's `DeltaSupport.windowBoundToCursor`.
**Honoured by.** `SyncCursor` already carries `scope: ListingScope`. `src/plan/cursor.ts` refuses to advance
a cursor whose `scope` is not identical to the scope the policy asked for, emitting
`reset{ reason: "scopeChanged" }`. A widened window becomes a full resync, never a quietly under-reporting
delta.
**Proved by.**
`tests/cursor/scope-binding.test.ts :: RECON-O26: advancing a narrow-scope cursor under a widened policy resets instead`;
`tests/cursor/scope-binding.test.ts :: RECON-O26: the same listing under its own scope advances normally`;
`tests/cursor/scope-binding.test.ts :: RECON-O26: a recurrence-expansion change is a scope change too`;
`tests/cursor/scope-binding.test.ts :: RECON-O26: a cursor minted for another calendar is never reused`.

### RECON-I19. A cursorLost listing carries no tombstones, and the resync that follows is what deletes

**Lesson.** The obvious reading of Google's guidance — *"a 410 should trigger a full wipe of the client's
store and a new full sync"* — is exactly the mass-deletion bug. The wipe is unnecessary and destroys the
baseline that lets the resync be diffed safely.
**Learned from.** Google *Handle API errors*; Nylas' and Nango's write-ups repeating the wipe advice;
protocol ledger entry 35.
**Honoured by.** `cursorLost` has no `events` field at all, so no diff basis exists; `removals.ts` returns
`[]` for it and `cursor.ts` returns `reset{ reason: "cursorLost" }`. Every other path that can reach a
tombstone is gated on the same `ListingAuthority` (RECON-I78), including the mirror-window retirement,
which review found could otherwise delete a drifted mirror from a `partial` or `cursorLost` listing. The subsequent full `snapshot` carries
a proven coverage window and deletes through RECON-I3, which is the only path that can.
**Proved by.**
`tests/cursor/cursor-lost.test.ts :: RECON-O2: a cursorLost listing plans no writes either`;
`tests/cursor/cursor-lost.test.ts :: RECON-O2: a cursorLost listing resets the cursor and says why`;
`tests/cursor/cursor-lost.test.ts :: RECON-O2: the cursor decision alone reaches reset without consulting the writes`.

### RECON-I20. Corrupt known state forces a resync; it never becomes a tombstone by omission

**Lesson.** When a stored row failed validation during a delta ingest, the engine abandoned the diff, reset
the token and forced a full sync — a delta diff against a partially unreadable baseline computes bogus
deletions. On a full ingest the invalid rows were removed only if the fetch did not report them.
**Learned from.** `ingest.ts` (`isDeltaSync && parseResult.failures.length > 0`);
`core/source/stored-event-state.ts` `buildInvalidStoredEventIdsToRemove`.
**Honoured by.** `KnownState` carries `events: readonly KnownEvent[]` and `corrupt: readonly
CorruptKnownRow[]` as separate fields. The implementation is **stricter** than the lesson: any corrupt row
at all — on every listing kind, not only a delta — forces `reset{ reason: "corruptKnownState" }` and
suppresses every tombstone in the plan, because a baseline we cannot fully read cannot support an absence
claim from any listing shape. (The ledger first described a weaker per-kind rule; review caught the
divergence and the stronger rule is the one kept.) Every corrupt row also appears in
`unresolved`. Parsing is the caller's job, so a corrupt row arrives as a value — the fail-loud rule applies
to invariants of our own (RECON-I27), not to aged data written by an older schema.
**Proved by.**
`tests/known-state/corrupt.test.ts :: RECON-O22: a delta against a corrupt baseline resets the cursor and says why`;
`tests/known-state/corrupt.test.ts :: RECON-O22: the corrupt row itself is reported, so it is not silently skipped`;
`tests/known-state/corrupt.test.ts :: RECON-O22: a snapshot against a corrupt baseline also refuses to infer deletions`;
`tests/known-state/corrupt.test.ts :: RECON-O22: a delta against a corrupt baseline plans zero tombstones`.

### RECON-I21. Ambiguity is a first-class outcome, never a guess and never a delete

**Lesson.** Stored rows with a null source uid were skipped by both removal branches; duplicate remote events
sharing a legacy UID were left alone rather than paired; orphan overrides were kept rather than attached to
an ambiguous master.
**Learned from.** `event-diff.ts` (`sourceEventUid === null` -> `return false`); tests *"does not guess
between duplicate remote events sharing a legacy UID"*, *"keeps orphan overrides and refuses to attach them
to ambiguous masters"*, *"does not attach same-UID overrides across source calendars"*.
**Honoured by.** `unresolvedReasons` includes `ambiguousIdentity` and `missingIdentity`. Ambiguity produces
no write, no tombstone and no mapping change. There is no "best guess" branch anywhere in `src/`.
**Proved by.**
`tests/identity/ambiguity.test.ts :: RECON-O24: an ambiguous identity produces no write, so neither copy overwrites the mirror`;
`tests/identity/ambiguity.test.ts :: RECON-O24: a duplicate-uid pair deletes neither`;
`tests/identity/ambiguity.test.ts :: RECON-O24: the ambiguity is reported rather than resolved by feed order`;
`tests/identity/ambiguity.test.ts :: RECON-O24: an ambiguous identity produces no write, so neither copy overwrites the mirror`.

### RECON-I22. Ties break on a content-derived total order, never on feed order

**Lesson.** An unordered publisher would otherwise delete and re-create the stored row on every poll.
Revision selection orders on SEQUENCE, then LAST-MODIFIED/DTSTAMP/CREATED, then the lowest slot signature.
**Learned from.** `parse-ics-events.ts` `selectGroupRevision`; tests *"drops the same copy whichever order
the feed lists the pair in"*, *"does not churn the stored row when the feed reorders the colliding events"*.
**Honoured by.** `src/state/dedupe.ts` folds observed events into a `Map` keyed by `sourceIdentityKey` and
resolves collisions on the revision rank, falling back to the fingerprint value as the final tiebreak so
the comparator is total and the survivor of an equal-rank collision does not depend on feed order. (The
comparator is local rather than `sync-ical`'s `compareEventRevisions`: an observed `RemoteEvent` carries a
single numeric `Revision`, not the SEQUENCE/DTSTAMP tuple that comparator ranks, so reusing it would mean
inventing fields. Review found the fingerprint tiebreak missing and it was added.) `src/plan/order.ts` sorts the finished plan by
`(sort instant, retire-before-write, identity key)`, so two runs over the same input produce byte-identical
plans and the applier never re-sorts.
**Proved by.**
`tests/order/permutation.test.ts :: RECON-O18: all 120 permutations of a five-event listing produce the same plan`;
`tests/order/permutation.test.ts :: RECON-O18: reordering the known state does not change the plan`;
`tests/order/permutation.test.ts :: RECON-O18: reordering the mappings does not change the plan`;
`tests/order/permutation.test.ts :: RECON-O19: three revisions of one identity apply the newest regardless of page order`;
`tests/order/permutation.test.ts :: RECON-O19: the surviving write is built from the highest revision, not the last in the array`.

### RECON-I23. Removes are ordered before writes at the same instant

**Lesson.** Applying an add before removing the copy occupying that slot makes the destination briefly show a
duplicate and, on providers that key on UID, makes the add fail outright.
**Learned from.** `operations.ts` `sortOperationsByTime`/`getOperationTypePriority`.
**Honoured by.** `comparePlannedWrites` is exported and documented as the plan's contract: instant ascending,
then `retire`/`delete` before `create`/`update`, then identity key. `Plan.writes` arrives already sorted, so
the applier may chunk it freely (RECON-I24) without re-sorting.
**Proved by.**
`tests/order/write-order.test.ts :: RECON-I23: at the same instant, a retire sorts before a create`;
`tests/order/write-order.test.ts :: RECON-I23: the plan arrives already sorted by that comparator`;
`tests/order/write-order.test.ts :: RECON-I23: the comparator is antisymmetric and reflexive`.

### RECON-I24. The plan holds no accumulator and imposes no cross-entry dependency

**Lesson.** A single large snapshot insert exceeded Postgres's bind-parameter ceiling and failed the whole
ingest; progress accounting carried across runs and double-counted.
**Learned from.** tests *"chunks a large snapshot so one statement cannot exceed the bind-parameter
ceiling"*, *"clears accumulated progress so totals do not carry across runs"*.
**Honoured by.** `Plan.writes` is an ordered list with no dependency beyond RECON-I23, so the applier may
chunk at any boundary. The one exception is deliberate and typed: `PlannedWrite.replace` (RECON-I25) is a
single entry. The plan carries no counters that survive it — `PlanDiagnostics` is built fresh per call, and
the package holds no module-level state at all.
**Proved by.**
`tests/plan/no-state.test.ts :: RECON-I24: a hundred consecutive plans over the same input are identical`;
`tests/plan/no-state.test.ts :: RECON-I24: a hundred consecutive plans over the same input are identical`;
`tests/plan/no-state.test.ts :: RECON-I24: no module under src declares module-level mutable state`.

### RECON-I25. A replace is one plan entry, because a half-applied replace orphans a real event

**Lesson.** If the delete succeeds and the recreate fails, the stale mapping must be kept so the next run
retries; the checkpoint must not be written when the operation aborts between the two halves. Dropping the
mapping early orphans a remote event nothing will ever clean up.
**Learned from.** `core/sync-engine/index.ts` `executeRemoteOperations`; tests *"keeps the stale mapping when
recreation fails after a successful delete"*, *"does not checkpoint the stale mapping when recreation aborts
after deletion"*, *"does not delete a remote UID that was recovered by an earlier add"*.
**Honoured by.** `PlannedWrite` is `single | replace`. The `replace` arm carries the `delete` intent and the
`create` intent in one value; there is no representation in which a planner emits the delete alone and the
applier records it independently. The atomic unit is explicit in the type, so the applier's checkpoint rule
follows from the shape rather than from a comment.
**Proved by.**
`tests/writes/replace-atomicity.test.ts :: RECON-O16: a representation change is planned as one replace entry`;
`tests/writes/replace-atomicity.test-d.ts :: RECON-O16: a replace missing its recreate does not typecheck`;
`tests/writes/replace-atomicity.test.ts :: RECON-O16: no plan expresses that delete independently of the recreate`.

### RECON-I26. Retire the delete identifier this listing gave you

**Lesson.** Mappings written before delete-ids existed store the iCalUID, which Google's delete endpoint
rejects, costing a second batch request per delete — real rate-limit budget. Reconciliation already listed
the remote copy, so its handle is in hand.
**Learned from.** `operations.ts` `resolveMappingDeleteId`; test *"uses remoteId as deleteIdentifier fallback
when pushResult has no deleteId"*.
**Honoured by.** `src/plan/tombstones.ts` and `src/plan/writes.ts` prefer the `DeleteHandle` from the matched
observed event and fall back to `mapping.destination.deleteHandle` only when no remote copy was matched.
**Proved by.**
`tests/writes/delete-handle.test.ts :: RECON-O17: with no destination listing the stored handle is the only one available`;
`tests/writes/delete-handle.test.ts :: RECON-O17: an observed mirror's own delete handle beats the mapping's stored one`;
`tests/writes/delete-handle.test.ts :: RECON-O17: an unmapped absence forgets the row rather than inventing a delete`.

### RECON-I27. Internal data fails loud; provider data fails soft

**Lesson.** A malformed part of a feed must not fail the whole feed, and a real deletion arriving in the same
payload as a malformed item must still be applied. But internally produced data that fails validation must
throw rather than silently degrade.
**Learned from.** commits `43292a9f` (#606), `2657805b` (#604); the repo's fail-loud rule; ICAL-I42.
**Honoured by.** `planReconciliation` never throws on anything reachable from a provider: bad observed items
become `unresolved` and the rest of the listing still plans. It throws `ReconcileInternalDataError` only when
one of our own invariants is broken — a `Mapping` whose destination calendar is not the policy's destination,
a `KnownEvent` with no identity, a `MappingSet` with two mappings for one identity.
**Proved by.**
`tests/plan/fail-loud.test.ts :: RECON-I27: a mapping pointing at a foreign destination calendar fails loud`;
`tests/plan/fail-loud.test.ts :: RECON-I27: two mappings claiming one source identity is our invariant, and it fails loud`;
`tests/plan/fail-loud.test.ts :: RECON-I27: the internal error names the invariant it broke`;
`tests/presence/withheld-is-present.test.ts :: RECON-O28: an item present as an event and withheld in the same payload is not deleted`.

### RECON-I28. Unsupported is reported, never reinterpreted

**Lesson.** THISANDFUTURE is reported rather than converted, because converting silently changes the meaning
of the whole tail of a series. RDATE series, floating UNTIL and unanchorable floating times are reported
rather than guessed.
**Learned from.** `parse-ics-events.ts`, `validate-recurrence-input.ts`; ICAL-I10, ICAL-I11.
**Honoured by.** `unresolvedReasons` separates `withheldBySource` (the source could not build it),
`unsupportedByDestination` (`Capabilities.recurrenceWrite`/`representableRange` refuse it),
`ambiguousIdentity`, `outsideProvenCoverage`, `staleRevision`, `corruptKnownState`,
`provenanceIndeterminate` and `missingIdentity`. The planner never coerces an unsupported shape into a
writable one.
**Proved by.**
`tests/unresolved/reasons.test.ts :: RECON-I28: an unsupported construct is reported, never coerced into a write`;
`tests/unresolved/reasons.test.ts :: RECON-I28: the reason set has eleven distinct members and no catch-all`;
`tests/unresolved/reasons.test.ts :: RECON-I28: an unsupported construct is reported, never coerced into a write`.

### RECON-I29. Every drop leaves a trace, because a drop reads downstream as a deletion

**Lesson.** Two independent comments in `packages/calendar` say this outright. Discard reasons are separated
by cause and counters are per-run, never cumulative; a healthy feed reports zero.
**Learned from.** `ingest.ts` `DiscardedSourceEventCounts`; commit `fdd9ba62` (#634); tests *"keeps discard
counters per-run, not accumulating across runs"*, *"reports a clean feed as having discarded nothing"*.
**Honoured by.** Nothing leaves `planReconciliation` unaccounted: every input identity ends in exactly one of
`writes`, `tombstones`, `unresolved`, `conflicts`, or the explicitly-converged set. A closure test asserts
that partition exhaustively. Being pure, the package reports; the caller does the `widelog.error`. Review
found four drops with no trace and each now has one: an `outOfScope` removal (`removalOutOfScope`), a
removal whose uid names several rows and whose id names none (`unmatchedRemoval`), a pairing refusal
(`pairingCeilingExceeded`), and a within-batch duplicate collapsed by dedupe
(`PlanDiagnostics.supersededObservations`, a counted sample rather than an unresolved item, because a
duplicate that lost to a higher revision is not an identity left undecided).
**Proved by.**
`tests/plan/closure.test.ts :: RECON-I29: every known identity is accounted for somewhere`;
`tests/state/dedupe.test.ts :: RECON-I36: a collapsed duplicate is counted in the plan's diagnostics`;
`tests/deletion/delta-authority.test.ts :: RECON-O3: an outOfScope removal leaves a trace instead of vanishing`;
`tests/deletion/delta-authority.test.ts :: RECON-O3: a removal whose uid names several rows and whose id names none is unresolved`;
`tests/hygiene/ledger-citations.test.ts :: RECON-I29: every cited test name exists verbatim in the file that is cited`;
`tests/plan/closure.test.ts :: RECON-I29: a healthy input yields empty arrays everywhere, not a silent drop`.

### RECON-I30. Diagnostic samples are capped by count AND by bytes, beside an uncapped count

**Lesson.** An uncapped identifier list pushed the log line past what the pipeline keeps and took the counters
with it — losing the numbers that prove no mass deletion happened.
**Learned from.** `ingest.ts` `WIDE_EVENT_LIST_LIMIT`/`WIDE_EVENT_LIST_MAX_LENGTH`;
`ingest-wide-event-list-bounds.test.ts`.
**Honoured by.** `src/plan/diagnostics.ts` builds the protocol's `BoundedSample { sample, total }` under
`PlanLimits.sampleCount` and `PlanLimits.sampleBytes`. `total` is always exact even when `sample` is
truncated.
**Proved by.**
`tests/plan/diagnostics-bounds.test.ts :: RECON-L7: a hundred thousand unresolved items do not produce a hundred thousand samples`;
`tests/plan/diagnostics-bounds.test.ts :: RECON-L7: the byte ceiling binds even when the count ceiling would not`;
`tests/plan/diagnostics-bounds.test.ts :: RECON-L7: the total stays exact even though the sample is capped`.

### RECON-I31. Reconciliation must converge, proved as a fixed point over the applied state

**Lesson.** Several convergence bugs only appeared on the second poll. Idempotence must be proved by
re-running the planner over the post-apply state, not by comparing two plans.
**Learned from.** tests *"is idempotent once the plan has been applied"*, *"stays converged when the same
unrepresentable delta replays"*, `vfy-shaping-fixed-point.test.ts`, `representable-range-idempotence.test.ts`.
**Honoured by.** The test suite carries one `applyPlan` test helper that mutates `known` and `mappings` the
way the real applier would, and every reconcile test asserts `plan -> apply -> plan == empty`. This is the
headline property, run as a table over every degenerate shape.
**Proved by.**
`tests/convergence/fixed-point.test.ts :: RECON-O20: ${name} converges after one application`
(shapes: zero-duration, inverted range, all-day at a non-UTC boundary, recurring master anchored outside the
window, withheld item, unresolved item, conflicted mapping, re-identified occurrence, replaced mirror);
`tests/convergence/fixed-point.test.ts :: RECON-O20: at least one of the nine shapes has a non-empty first plan`;
`tests/convergence/fixed-point.test.ts :: RECON-O20: a mirror we already own and already agree with is never rewritten`.

### RECON-I32. A degenerate range is a legitimate present event

**Lesson.** RFC 5545 §3.6.1 requires DTEND > DTSTART and Google rejects a non-positive span, so degenerate
ranges are stored as stated and widened only at the destination edge. Every layer that judged a range by its
end alone dropped them, producing a permanent add/delete cycle.
**Learned from.** `core/events/time-range.ts` `POINT_IN_TIME_DURATION_MS`; commit `b057d2e0` (#616); the
degenerate-range test family; test *"admits every degenerate event whose instant lies inside the sync
window"*.
**Honoured by.** `sync-reconcile` owns no window predicate. It calls `policy.withinWindow`, whose default is
`sync-ical`'s `withinTimeWindow` — the one predicate every layer shares (RECON-I33). A destination widening
is invisible to the source side by RECON-I11.
**Proved by.**
`tests/convergence/fixed-point.test.ts :: RECON-O20: at least one of the nine shapes has a non-empty first plan`;
`tests/convergence/fixed-point.test.ts :: RECON-O20: an indeterminate event does not oscillate between runs`;
`tests/convergence/fixed-point.test.ts :: RECON-O20: a mirror we already own and already agree with is never rewritten`.

### RECON-I33. One window predicate, injected, never redefined

**Lesson.** `packages/calendar` shipped four diverged private copies of the window predicate in one change,
and each copy that judged by the end alone dropped degenerate ranges. Every layer applying a sync window must
use the same predicate or an event survives one stage and not the next.
**Learned from.** commit `b057d2e0` (#616); `overlapsRepresentableTimeWindow`.
**Honoured by.** `ReconciliationPolicy.withinWindow: WindowMembership` — the predicate arrives as an
argument, as the brief requires of every dependency. `src/policy.ts` is the only file in `src/` that imports
`sync-ical`, and only to offer `defaultWindowMembership = withinTimeWindow`. There is no second membership
test in `src/`; a hygiene test greps for one.
**Proved by.**
`tests/hygiene/one-predicate.test.ts :: RECON-I33: no module under src/plan re-derives window membership`;
`tests/hygiene/one-predicate.test.ts :: RECON-I33: only the policy module imports sync-ical for a value`;
`tests/hygiene/one-predicate.test.ts :: RECON-I33: a predicate that admits nothing produces no window-driven tombstone`.

### RECON-I34. A recurring item's window membership is judged on its occurrences, never on its anchor

**Lesson.** A master rule whose DTSTART is outside the window still generates occurrences inside it; the
window-prune path explicitly skips any stored event carrying a recurrence rule.
**Learned from.** `ingest.ts` (`if (!event.recurrenceRule && !overlapsTimeWindow(...))`); tests *"does not
flag a series whose occurrences all fall outside the window"*, *"does not truncate an unbounded series two
years after its original DTSTART"*.
**Honoured by.** `src/plan/tombstones.ts` exempts any identity whose content carries a `recurrence` payload
from `outsideMirrorWindow` retirement; the mirror window prunes materialised occurrences only. The planner
never expands a rule — expansion belongs upstream (ICAL-I51).
**Proved by.**
`tests/window/recurrence-exemption.test.ts :: RECON-O30: a master with DTSTART two years early is not retired`;
`tests/window/recurrence-exemption.test.ts :: RECON-O30: nor is it reported as outside proven coverage`;
`tests/window/recurrence-exemption.test.ts :: RECON-O30: the series' absence from a snapshot still tombstones it, exemption is about the window only`.

### RECON-I35. An occurrence that changes identity within its series is a reassignment, not delete + add

**Lesson.** The engine paired newly-unmapped occurrences against newly-unmatched mappings owned by the same
event state, ordered by slot, and split the result into database-only reassignments (remote state verifiably
unchanged) and remote reassignments. Without it, one removed legacy occurrence shifted every later mapping
and rewrote the whole series.
**Learned from.** `operations.ts` `pairReidentifiedMaterializedOccurrences`; tests *"does not shift later
recurring mappings when one legacy occurrence was removed"*, *"keeps recurring siblings while one provider
occurrence changes and moves"*.
**Honoured by.** `src/plan/reassignment.ts` produces a distinct outcome from tombstone-plus-write, and takes
it only when the remote state is verifiably unchanged — both the mirror fingerprint and the availability
must be present and equal. Pairing is within one owning series id, sorted by slot, and is `O(n log n)`
(RECON-I42).
**Proved by.**
`tests/reassignment/occurrences.test.ts :: RECON-O34: one removed occurrence retires exactly one mirror`;
`tests/reassignment/occurrences.test.ts :: RECON-O34: a reassignment onto a mirror the user edited is a conflict, not an update`;
`tests/reassignment/occurrences.test.ts :: RECON-O34: an untouched mirror still takes the reassignment`;
`tests/reassignment/occurrences.test.ts :: RECON-O34: the retired mirror is the one that belonged to the removed occurrence`.

### RECON-I36. Within one batch a provider may report the same occurrence several times

**Lesson.** Only the final version may be applied. Deduplication keys on provider id when present and falls
back to a storage instance key, last-write-wins per key, before any diff runs.
**Learned from.** `event-diff.ts` `deduplicateIncomingEvents`; tests *"applies only the final version when a
provider occurrence changes repeatedly in one delta"*, *"deduplicates remote events with same identity key"*.
**Honoured by.** `src/state/dedupe.ts` runs before anything else and guarantees at most one observed item per
`sourceIdentityKey`. "Final" is decided by revision order (RECON-I22), not by array position, so a reordered
page cannot change the answer. The planner asserts the invariant rather than assuming it.
**Proved by.**
`tests/order/permutation.test.ts :: RECON-O19: the surviving write is built from the highest revision, not the last in the array`;
`tests/order/permutation.test.ts :: RECON-O19: the surviving write is built from the highest revision, not the last in the array`;
`tests/state/dedupe.test.ts :: RECON-I36: the survivor is the highest revision, not the last in the array`.

### RECON-I37. An unusable newest revision withholds the identity; the older one never wins

**Lesson.** Letting the previous revision win syncs the instance at a stale time — a silent revert of a user's
edit. The stored row is left untouched and the withholding is reported on every subsequent run without
churning.
**Learned from.** `parse-ics-events.ts` `collectStaleRevisions`; tests *"never reverts a stored event to the
time the publisher moved it away from"*, *"keeps reporting the discard on every later run and never churns
the row"*.
**Honoured by.** Revision comparison is monotonic: a write is never planned from an observed event whose
revision is below the known state's. It becomes `Unresolved{ reason: "staleRevision" }` and the known state
is left exactly as it is. `sync-ical` already withholds the whole UID upstream (ICAL-I7); this is the
second line of defence, because a delta provider can also deliver an out-of-order page.
**Proved by.**
`tests/writes/stale-revision.test.ts :: RECON-O23: an out-of-order page below the known revision plans no write`;
`tests/writes/stale-revision.test.ts :: RECON-O23: the stale delivery is reported as staleRevision`;
`tests/writes/stale-revision.test.ts :: RECON-O23: the stale delivery does not tombstone the identity either`.

### RECON-I38. All-day-ness is resolved by one shared predicate before any comparison

**Lesson.** All-day ranges live on the UTC day grid; all-day-ness must be derived consistently, and a 24-hour
timed event at a non-midnight boundary is not all-day. Getting this wrong drifts an all-day event a day per
sync between two providers.
**Learned from.** `core/events/time-range.ts` `floorToUtcDay`/`ceilToUtcDay`; commit `82799c5b` (#602);
tests *"does not treat non-midnight 24-hour timed events as all-day"*.
**Honoured by.** The protocol's `EventTime` is already `timed | allDay` — a discriminant, not an inferred
flag — and `sync-ical`'s `resolveIsAllDay` decided it upstream. `sync-reconcile` reads the discriminant and
never re-derives it, so the two sides cannot disagree.
**Proved by.**
`tests/window/all-day.test.ts :: RECON-I38: a 24h non-midnight event is not treated as the all-day one`;
`tests/window/all-day.test.ts :: RECON-I38: a 24h non-midnight event is not treated as the all-day one`;
`tests/window/all-day.test.ts :: RECON-I38: a settled all-day event plans no write`.

### RECON-I39. A no-op run may still need to flush

**Lesson.** When the event diff was empty the engine still wrote if there was a new cursor, a new content
snapshot or new coverage — otherwise a delta source re-fetches the same page forever, or coverage never
widens. When there was genuinely nothing to record it opened no transaction at all.
**Learned from.** `ingest.ts` empty-diff branch; tests *"flushes a changed snapshot even when the event set is
already in sync"*, *"does not flush when there are no changes"*.
**Honoured by.** `Plan` carries `cursor: CursorDecision` and `coverage: ProvenCoverage` as fields, so
"nothing to write but something to record" is a distinct, typed state the applier reads directly. An
"empty" plan is not the same value as a no-op plan, and no array length has to be inspected to tell them
apart (RECON-I17).
**Proved by.**
`tests/cursor/independence.test.ts :: RECON-O25: an unchanged listing carrying a new cursor still advances it`;
`tests/plan/no-op.test.ts :: RECON-I39: a no-op delta still carries a cursor decision`;
`tests/plan/no-op.test.ts :: RECON-I39: a no-op snapshot still carries the coverage it proved`.

### RECON-I40. Divergence is three-state, and values never leave the process

**Lesson.** A successful push with no echo counts as uncomparable, never as a silent zero; the absence of an
echo is a distinct third state, not agreement. Only booleans and lengths are logged.
**Learned from.** `core/events/push-echo.ts`; tests *"counts a successful push with no echo as uncomparable,
never as a silent zero"*, *"adds no fields at all to a clean push with no divergence"*.
**Honoured by.** The three-state half of this lesson is **not applicable here** and is recorded as such: the
protocol's `EchoVerdict` (`matched | diverged | notObserved`) describes the outcome of a write we performed,
and this package never performs or observes a write outcome — it plans. Its own three-state analogue is
`ObservedState` (`sourceOnly | bothSides`) plus `MirrorIndex.listed`: with no destination listing the mirror
is *uncomparable*, and `decideMappedWrite` raises no mirror conflict rather than reading absence as
agreement. The half that does apply is the logging rule: `PlanDiagnostics` carries counts and capped
identifier samples only — never a title, a description or a
location. A hygiene test asserts no user-supplied text field reaches `PlanDiagnostics`.
**Proved by.**
`tests/plan/diagnostics-bounds.test.ts :: RECON-I40: the diagnostics carry identifiers and counts only, never content`;
`tests/plan/diagnostics-bounds.test.ts :: RECON-I40: the diagnostics carry identifiers and counts only, never content`.

### RECON-I41. Reconcile is pure so that it is safe to call from inside a transaction

**Lesson.** The ingest engine had to stop calling `widelog` from inside a pooled-driver callback, because a
pooled driver invokes the callback in the async context of whoever released the connection and telemetry
landed on a foreign wide event. Remote I/O stays outside database transactions.
**Learned from.** `ingest.ts` `measureDiff` and its comment; commit messages *"keep remote I/O outside
database transactions"*.
**Honoured by.** Zero I/O, zero telemetry, zero clock. This is not style: a planner that logged would be
unsafe to call from inside a transaction callback, and a planner that awaited would be a lockup surface.
Enforced by `RECON-L1` and `RECON-L3` rather than by convention.
**Proved by.**
`tests/hygiene/purity.test.ts :: RECON-L1: no export is declared async and the planner returns a plain value`;
`tests/hygiene/purity.test.ts :: RECON-L1: the planner completes rather than handing back a pending seam`;
`tests/hygiene/purity.test.ts :: RECON-L3: planning never reads the ambient clock`.

### RECON-I42. Every iteration is bounded in the input size, and the bound is proved

**Lesson.** The product has repeatedly shipped hangs, and the recurrence budget exists because one
pathological series could push a whole calendar into permanent backoff. A pure planner cannot deadlock but it
can wedge: a quadratic pairing loop on adversarial input is this package's form of the missing ceiling.
**Learned from.** `core/utils/backoff.ts`; `findSourceEventsExceedingRecurrenceBudget`; ICAL-I43; the brief's
lockup obsession.
**Honoured by.** Every lookup is a `Map` built once; there is no nested scan over `known` or `mappings`.
Reassignment pairing sorts within one owning series and walks the two sorted lists once. `PlanLimits` bounds
the sample sizes and the reassignment pairing width, and exceeding a bound is a typed `unresolved` outcome
(`pairingCeilingExceeded`, one per unpaired mapping), never a slow success and never a degradation into
delete-plus-create: the mappings the refusal left unpaired are shielded from tombstoning for that run.
Refusal only applies when both sides are non-empty, so a mass deletion with nothing to pair against is
still planned normally. Nothing recurses.
**Proved by.**
`tests/limits/pairing-ceiling.test.ts :: RECON-L4: a refused ceiling is a typed unresolved outcome, never a delete and recreate`;
`tests/limits/pairing-ceiling.test.ts :: RECON-L4: quadrupling the input does not sixteen-fold the comparison count`;
`tests/limits/pairing-ceiling.test.ts :: RECON-L5: a degenerate order where every pair compares equal still terminates`;
`tests/limits/pairing-ceiling.test.ts :: RECON-L4: pairing completes inside one scheduler tick, so it cannot be awaiting anything`;
`tests/limits/large-state.test.ts :: RECON-L6: a hundred thousand known events against an empty listing completes`;
`tests/limits/large-state.test.ts :: RECON-L6: doubling the state doubles the window probes rather than squaring them`;
`tests/limits/deep-series.test.ts :: RECON-L8: a ten-thousand-deep override chain returns a plan rather than blowing the stack`.

### RECON-I43. Never `Bun.sleep`, and no timer may be armed

**Lesson.** `Bun.sleep` is a native primitive `vi.useFakeTimers` cannot patch; every sleep in this repo is
`setTimeout` for exactly that reason, and a commit exists to undo the CI cost of getting it wrong.
**Learned from.** commit `34dc5079` *perf(tests): stop the backoff and tzdata suites burning real wall time
(#806)*; `core/utils/backoff.ts`; ICAL-I44.
**Honoured by.** No `Bun.sleep` anywhere in `src/` or `tests/`. The package arms no timer at all — the
stronger guarantee — asserted under fake timers.
**Proved by.**
`tests/hygiene/no-bun-sleep.test.ts :: RECON-L2: no file under src reaches for the unfakeable sleep primitive`;
`tests/hygiene/no-bun-sleep.test.ts :: RECON-L2: no file under tests reaches for the unfakeable sleep primitive`;
`tests/hygiene/no-bun-sleep.test.ts :: RECON-L2: a full plan schedules no microtask continuation either`.

### RECON-I44. The ambient clock and the ambient timezone are never read

**Lesson.** Durations must come from a monotonic clock and must never be differenced from a total; wall clock
steps backwards and forwards in production. Separately, `packages/calendar` pins `TZ=UTC` because otherwise
wall-time tests pass or fail by machine.
**Learned from.** `core/sync-engine/index.ts` (`sync.reconcile.duration_ms` comment); tests *"keeps the
reconcile total and the phases honest when the clock steps backwards"*; ICAL-I45.
**Honoured by.** The brief forbids a clock here, which is the strongest form of honouring it. Any
now-dependent decision — is this window in the past? — arrives as a value on the policy. The test script is
`TZ=UTC bun x --bun vitest run` and one suite re-runs a plan under a non-UTC ambient zone.
**Proved by.**
`tests/hygiene/purity.test.ts :: RECON-L3: planning mutates none of its four arguments`;
`tests/hygiene/purity.test.ts :: RECON-L3: planning never reads the ambient clock`;
`tests/hygiene/purity.test.ts :: RECON-I44: the plan is identical under UTC and under a zone fourteen hours ahead`.

---

## Not applicable to sync-reconcile

Each of these is a real lesson from `packages/calendar` that this package deliberately does not carry.
Recorded so their absence reads as a decision, with the condition that would re-open it.

### RECON-I45. Retry ceilings, capped `Retry-After`, abortable sleeps

`withBackoff` caps attempts, caps the delay even when the provider disagrees, and ends with an explicit
unreachable throw; `abortableSleep` rejects if the signal is already aborted and cleans up on both paths
(`core/utils/backoff.ts`).
**Not applicable.** `planReconciliation` awaits nothing, so there is no runtime loop to bound. The applicable
residue is RECON-I42: internal iteration must be provably finite in the input size. The package exports no
timer, sleep or signal.
**Re-open condition.** If any export here ever becomes `async`, it inherits this entry verbatim. `RECON-L1`
is the tripwire that makes adding one impossible to do quietly.

### RECON-I46. Single-flight coalescing, lock and lease discipline

The in-flight map entry is removed in `.finally` and only if the stored promise is still the same task;
followers join the leader's promise and receive its rejection rather than hanging. Locks are acquired in a
deterministic sorted order over a de-duplicated key set, on one connection, inside a transaction carrying
`statement_timeout` and `idle_in_transaction_session_timeout` (`core/oauth/refresh-coordinator.ts`,
`core/source/ingest-lock.ts`).
**Not applicable.** A pure planner holds no lock and coalesces nothing. Inventing an internal cache or a
memoisation lease to satisfy the lockup brief would import the hazard gratuitously; caching belongs in the
caller. The transferable rule *is* adopted: every set the planner iterates is sorted deterministically before
it produces output (RECON-I22), so two callers holding different locks produce identical plans from identical
inputs.

### RECON-I47. Deadlines and merged abort signals on outbound awaits

Every outbound await needs a deadline and a composed abort signal (`fetch-with-timeout.ts`).
**Not applicable.** No outbound anything. `OperationContext` carries `signal`, `now`, `deadline` and
`retryBudget` and belongs to the provider adapters, not to the planner. That the planner cannot see a
deadline is the point: it cannot spend one.

### RECON-I48. Redirect ceilings, `Authorization` withholding, quota acquisition inside the retry

Transport concerns (`utils/safe-fetch.ts`; protocol ledger entries 21, 23, 48).
**Not applicable.** Different package. Recorded so the transport package inherits them.

### RECON-I49. Timezone resolution, DST folds, VTIMEZONE synthesis

A wall time in a fall-back fold names two instants and RFC 5545 gives no way to disambiguate; a DATE-valued
series is floating per §3.3.10 and must expand on the dates it names.
**Not applicable, and forbidden.** Instant resolution is `sync-ical`'s job. `sync-reconcile` consumes already
resolved absolute instants, never parses a TZID, never touches tzdata and never re-derives an occurrence
start. Any timezone logic appearing under `packages/sync-kit/reconcile` is a layering violation and the
review should reject it. `tests/hygiene/one-predicate.test.ts` greps for it.

### RECON-I50. Comparing serialised text

Comparing a TZID wall time against a UTC instant lexically is meaningless and let a genuinely inverted
resource pass a guard.
**Not applicable as a hazard, adopted as a prohibition.** Reconcile compares instants and opaque fingerprint
and version tokens. It never compares serialised ICS text, and it never re-hashes content — both
fingerprints arrive as inputs (RECON-I12).

### RECON-I51. Recurrence expansion and occurrence budgets

Materialising a series is expensive and must be bounded.
**Not applicable.** Reconcile receives either a rule-bearing master or already-materialised occurrences and
never expands. The budget is enforced upstream and surfaces here as
`withheld{ reason: "recurrenceBudgetExceeded" }`, which RECON-I6 keeps *present*.

### RECON-I52. Destination representational limits

Google refuses a zero-duration event; Graph refuses end-before-start; CalDAV requires a strictly later DTEND.
**Not applicable as arithmetic.** The planner does not widen or clamp anything. It reads
`Capabilities.representableRange` to decide whether an item is writable at all
(`unresolved{ reason: "unsupportedByDestination" }`); the shaping itself belongs to
`CalendarProvider.normalize`, which is what produces the `MirrorFingerprint` the planner compares
(RECON-I12).

### RECON-I53. Batched writes and bind-parameter ceilings

A single large snapshot insert exceeded Postgres's parameter limit and failed the whole ingest.
**Not applicable as behaviour, adopted as a constraint on the type.** The planner performs no write. Its
obligation is to emit a list the applier may chunk anywhere, which is RECON-I24.

### RECON-I54. Wide events, monotonic durations, phase attribution

Durations must come from a monotonic clock and must never be differenced from a total.
**Not applicable.** No telemetry is emitted here (RECON-I41). The plan is a value the caller may log; the
caller owns the wide event and the clock.

---

## Dependencies taken and rejected

### RECON-I55. Taken: `@keeper.sh/sync-protocol` (workspace)

Every type this package speaks — `ChangeListing`, `WriteIntent`, `ObservedPrecondition`, `RemoteEvent`,
`Capabilities`, `TimeWindow`, `WindowMembership`, `BoundedSample`, `assertNever` — is already defined there
and is **not redefined here**. The protocol had already made the two decisions this package most depends on:
non-snapshot listings carry no `coverage` field, and `update`/`delete`/`retire` carry a required
`ObservedPrecondition`. Reconcile inherits both guarantees rather than restating them.

### RECON-I56. Taken: `@keeper.sh/sync-ical` (workspace), imported in exactly one file

`src/policy.ts` imports `withinTimeWindow` to offer `defaultWindowMembership`, and
`compareEventRevisions` for the dedupe tiebreak. Nothing under `src/plan/` imports it: the predicate arrives
on the policy, per the brief's rule that dependencies arrive as arguments. The dependency exists so the
package ships the *correct* default (RECON-I33) and so the tests run against the real predicate rather than a
stub. `canonicalEventFingerprint` is **not** called here — fingerprints are inputs (RECON-I12).

### RECON-I57. Rejected: ical.js, ts-ics, rrule, tsdav, node-ical

All are either already rejected by `sync-ical` (ICAL-I53–I55) or belong to a transport package. Reconcile
must import none of them. The moment it parses a TZID or expands an RRULE it has duplicated `sync-ical`, and
two copies will diverge — which is precisely the failure mode of #616, where one window predicate became
four.

### RECON-I58. Rejected: fast-check

The tempting properties are order-independence and fixed-point convergence, and fast-check integrates with
vitest cleanly. Rejected for consistency with ICAL-I59 and because the properties here are *finite*: the
order-independence obligation is all 120 permutations of a five-event listing, enumerated exhaustively, which
is a stronger statement than a sampled generator makes, and reproducible without a seed in the failure
message. The fixed-point obligation is a table over nine named degenerate shapes, each of which is a
regression from a real incident and deserves a name in the output rather than a generated counterexample.
**Re-open condition.** If the reassignment pairing grows a genuinely combinatorial input space, generated
input beats enumeration and this should be revisited.

### RECON-I59. Rejected: `fast-json-stable-stringify`, RFC 8785 (JCS), and any hashing here

`packages/calendar` hand-rolls a canonical subset *and* depends on `fast-json-stable-stringify` — two
implementations of one idea. `sync-ical` replaced both with a closed field-order tuple (ICAL-I33, ICAL-I57).
`sync-reconcile` hashes nothing at all: both fingerprints are inputs. A third canonicalisation here would be
a third thing to keep in agreement.

### RECON-I60. Rejected: `temporal-polyfill`

Temporal reached Stage 4 in March 2026 and ships natively in Node 26 and Deno, but
`bun -e 'typeof Temporal'` prints `undefined` on this repo's Bun 1.3.14 — verified in this worktree, not
taken on trust. Even if it shipped, this package does no calendar arithmetic: it compares absolute instants
and opaque tokens. Epoch comparison is sufficient and Temporal would buy nothing.

### RECON-I61. Taken from the platform, not from a dependency: `Map.groupBy`, `Array.prototype.toSorted`

Both are present on Bun 1.3.14 (verified). `Map.groupBy` replaces the hand-rolled accumulate-into-a-Map loop
that `packages/calendar` and `sync-ical` both wrote by hand, and `toSorted` keeps the sorting paths
non-mutating, which matches the repo's functional-construction preference. No lodash, no immer, no
immutable.js. Rejected from Bun: `Bun.sql` and `bun:sqlite` (no database here), `Bun.hash` and
`Bun.CryptoHasher` (nothing is hashed here), and Bun's own test runner — the repo convention is
`bun x --bun vitest run`, because bare `bun test` is the wrong runner and produces bogus
*"vi.hoisted is not a function"* errors. Bun's real contribution to this package is running TypeScript
sources with no build step, which is what makes the source-consumed package idiom work.

### RECON-I62. Process

`bun install` in the worktree first. Tests run as `TZ=UTC bun x --bun vitest run`. turbo caches, so the only
real verdict is `bunx turbo run test lint types --force`. oxlint runs with the restriction category on: no
console, **no ternaries anywhere**, `eqeqeq`. No comments except an external constraint with a citation. No
type assertions, no `any`, no non-null `!`, no `@ts-ignore`; `as const` and `satisfies` only. Switches over
discriminated unions end in `assertNever`. Guard clauses, no `else` after a return. No defect claim without a
test that fails first.

---

## The test id scheme

Every test is named `RECON-<series><n>: <what it proves>`, and the **Proved by** lines above cite that exact
string so the ledger can be walked against the suite by grep.

- `RECON-I<n>` — the ledger entry the test honours, one for one.
- `RECON-O<n>` — an **overwrite** obligation: a write, a deletion or a fingerprint that must not move. Each
  must fail before its guard exists.
- `RECON-L<n>` — a **lockup** obligation: a bound, a ceiling, or the absence of a timer, a clock or a promise.

### RECON-O index — the overwrite family

Each line names the failure it prevents and how the test forces it.

- `RECON-O1` — tests/deletion/no-wipe.test.ts — *a partial listing deletes the calendar.* Forced by a
  `partial` listing whose `events` omit every known event; a set-difference implementation tombstones all of
  them.
- `RECON-O2` — tests/cursor/cursor-lost.test.ts, tests/deletion/no-wipe.test.ts — *a 410 wipes the store.*
  Forced by a `cursorLost` listing with a fully populated `known`; the naive "410 means full wipe" advice
  tombstones everything. Also forced through the mirror-window retirement path, which reached a deletion
  without consulting the listing kind at all until RECON-I78.
- `RECON-O3` — tests/deletion/delta-authority.test.ts — *a delta page's omissions read as deletions.* Forced
  by a delta listing that reports one removal and omits four known events.
- `RECON-O4` — tests/coverage/proven-coverage.test.ts — *absence outside proven coverage deletes.* Forced by
  running identical inputs twice, once under `unproven` and once under `proven`, asserting zero then one.
- `RECON-O5` — tests/coverage/proven-coverage.test.ts — *a mapping between recorded coverage and the
  requested edge is deleted or re-added.* Forced by placing a known event in exactly that gap.
- `RECON-O6` — tests/coverage/axes.test.ts — *a wide future range licenses a historic deletion.* Forced by
  proving only the future axis and placing one absence on each axis.
- `RECON-O7` — tests/deletion/two-windows.test.ts — *the requested window is mistaken for the authoritative
  one and a narrow destination prunes a shared baseline.* Forced by an event outside the mirror window but
  inside proven coverage: it must retire the mirror and keep the source row.
- `RECON-O8` — tests/presence/withheld-is-present.test.ts — *a stalled series is mass-deleted then
  mass-re-added.* Forced by withholding the same item on ten consecutive polls and asserting every plan is
  empty.
- `RECON-O9` — tests/writes/precondition-required.test-d.ts — *an unconditional overwrite.* Forced with
  `@ts-expect-error` on an update and a delete constructed without a precondition.
- `RECON-O10` — tests/writes/stale-precondition.test.ts — *a silent clobber of a newer remote version.*
  Forced by a mapping recording version `v1` against an observed `v2`.
- `RECON-O11` — tests/writes/stale-precondition.test.ts — *every conflict collapses to "changed" and becomes
  undiagnosable.* Forced by a table over all six causes asserting distinct classifications.
- `RECON-O12` — tests/writes/idempotent-create.test.ts — *a duplicate real calendar event.* Forced by
  replanning after the create landed, and again with the mapping deliberately missing.
- `RECON-O13` — tests/provenance/echo.test.ts — *our own write is mirrored back into the source.* Forced by
  an observed source event stamped `ours` whose content differs from the mapping.
- `RECON-O14` — tests/provenance/echo.test.ts — *another installation's mirror is deleted as an orphan.*
  Forced by an `ours` event carrying a foreign `InstallationId`.
- `RECON-O15` — tests/provenance/echo.test.ts — *an unattributable event is deleted.* Forced by an
  `indeterminate` destination event with no mapping.
- `RECON-O16` — tests/writes/replace-atomicity.test.ts, .test-d.ts — *a delete lands, the recreate fails, and
  the mapping is already gone.* Forced by asserting no plan expresses the delete independently.
- `RECON-O17` — tests/writes/delete-handle.test.ts — *a legacy iCalUID is sent to a delete endpoint that
  rejects it.* Forced by a mapping whose stored handle differs from the observed one.
- `RECON-O18` — tests/order/permutation.test.ts — *an unordered publisher churns a row every poll.* Forced by
  all 120 permutations of a five-event listing, compared byte-for-byte.
- `RECON-O19` — tests/order/permutation.test.ts — *a repeated occurrence in one delta applies a stale
  version.* Forced by three revisions of one identity in ascending and descending order.
- `RECON-O20` — tests/convergence/fixed-point.test.ts — *a forever-loop that writes to a real calendar every
  run.* Forced for nine named degenerate shapes by `plan -> apply -> plan`, asserting the first plan is
  non-empty and the second and third are empty.
- `RECON-O21` — tests/fingerprints/*.test.ts, .test-d.ts — *a destination's own rewrite is read as a user
  edit.* Forced by CRLF, trailing-space, sub-second and availability-coercion echoes, and by a type test that
  the two fingerprint brands are not comparable.
- `RECON-O22` — tests/known-state/corrupt.test.ts — *a delta diff against an unreadable baseline computes
  bogus deletions.* Forced by one corrupt row alongside four healthy ones.
- `RECON-O23` — tests/writes/stale-revision.test.ts — *a user's edit is silently reverted.* Forced by an
  out-of-order page delivering a lower revision than the known state.
- `RECON-O24` — tests/identity/ambiguity.test.ts — *the planner guesses between two events sharing one UID.*
  Forced by a duplicate-UID pair with no distinguishing recurrence identity.
- `RECON-O25` — tests/cursor/independence.test.ts — *a delta source re-fetches the same page forever.* Forced
  by an unchanged listing carrying a new cursor.
- `RECON-O26` — tests/cursor/scope-binding.test.ts — *a widened window reuses a narrower cursor and leaves the
  new span permanently unpopulated.* Forced by advancing the same listing under a widened `ListingScope`.
- `RECON-O27` — tests/cursor/independence.test.ts, .test-d.ts — *a superseded run writes a sync token.*
  Forced by asserting the write set typechecks and applies without the cursor field.
- `RECON-O28` — tests/presence/withheld-is-present.test.ts — *one malformed item suppresses a real deletion in
  the same payload.* Forced by a listing carrying both.
- `RECON-O29` — tests/identity/delimiter.test.ts — *event text containing the delimiter merges two
  identities.* Forced by two identities whose fields concatenate identically under a `|` join.
- `RECON-O30` — tests/window/recurrence-exemption.test.ts — *a master anchored before the window is retired
  and its in-window occurrences vanish.* Forced by a master with DTSTART two years before the window.
- `RECON-O31` — tests/writes/concurrent-writers.test.ts — *two writers clobber each other.* Forced by
  building two plans from one base state and applying both in sequence.
- `RECON-O32` — tests/state/observed.test-d.ts — *an orphan mirror is retired on the strength of a
  destination we never listed.* Forced by a type test that `sourceOnly` exposes no destination listing.
- `RECON-O33` — tests/identity/identity-is-not-content.test.ts — *a content edit becomes delete + create and
  loses RSVPs, conferencing links and provider ids.* Forced by mutating every content field of a known event.
- `RECON-O34` — tests/reassignment/occurrences.test.ts — *one removed legacy occurrence rewrites the whole
  series.* Forced by removing an early occurrence from a ten-occurrence mapped series.

### RECON-L index — the lockup family

- `RECON-L1` — tests/hygiene/purity.test.ts — *an I/O or telemetry seam appears inside a planner called from
  within a database transaction.* Forced by reflecting over every export and asserting none is an
  `AsyncFunction` and no return value is a thenable.
- `RECON-L2` — tests/hygiene/no-bun-sleep.test.ts — *a sleep `vi.useFakeTimers` cannot patch burns real CI
  wall time, or a timer is left armed.* Forced by a source grep plus `vi.getTimerCount() === 0` after a full
  plan under fake timers.
- `RECON-L3` — tests/hygiene/purity.test.ts — *a hidden clock read makes the plan untestable and drifts in
  production.* Forced by stubbing `Date.now` and the `Date` constructor to throw and planning anyway.
- `RECON-L4` — tests/limits/pairing-ceiling.test.ts — *a quadratic or unbounded pairing loop wedges on
  adversarial input.* Forced by instrumenting the comparator, quadrupling the input and asserting the call
  count does not sixteen-fold; and by an all-ties comparator that must still terminate deterministically.
- `RECON-L5` — tests/limits/pairing-ceiling.test.ts — *a collision resolver loops on a degenerate total
  order.* Forced by a revision set in which every pair compares equal.
- `RECON-L6` — tests/limits/large-state.test.ts — *a nested scan over `known` × `mappings` turns a large
  calendar into a hang.* Forced by 100k known events with an empty listing, asserting single-pass Map lookups
  and — via an injected counting window predicate, never a wall clock (RECON-I83) — that doubling the state
  doubles the probes rather than squaring them.
- `RECON-L7` — tests/plan/diagnostics-bounds.test.ts — *an uncapped identifier list pushes the log line past
  what the pipeline keeps and takes the counters with it.* Forced by 100k unresolved items, asserting the
  sample is capped by count and by bytes while `total` stays exact.
- `RECON-L8` — tests/limits/deep-series.test.ts — *a recursive walk over a master/override chain blows the
  stack.* Forced by a ten-thousand-deep chain that must return a value.

### Test suite layout

```
tests/deletion/        no-wipe, delta-authority, two-windows, removals-switch, listing-kind.test-d
tests/coverage/        proven-coverage (+ .test-d), axes
tests/presence/        withheld-is-present
tests/provenance/      echo
tests/identity/        identity-is-not-content, ambiguity, delimiter
tests/fingerprints/    two-sided (+ .test-d), provider-rewrite
tests/writes/          precondition-required (+ .test-d), stale-precondition, stale-revision,
                       idempotent-create, replace-atomicity (+ .test-d), delete-handle, concurrent-writers
tests/cursor/          independence (+ .test-d), scope-binding, cursor-lost
tests/known-state/     corrupt
tests/order/           permutation, write-order
tests/reassignment/    occurrences
tests/window/          recurrence-exemption, all-day
tests/convergence/     fixed-point
tests/unresolved/      reasons
tests/plan/            closure, no-state, no-op, diagnostics-bounds, fail-loud
tests/state/           dedupe, observed.test-d
tests/limits/          pairing-ceiling, large-state, deep-series
tests/hygiene/         purity, no-bun-sleep, one-predicate, ledger-citations
```

## Red phase addenda (sync-reconcile)

Recorded while writing the failing suite, before any implementation exists. Each entry is a
correction or an addition to the design above; the review phase should hold the implementation to
these as well as to RECON-I1..I62.

### RECON-I63. The planner must derive a `SourceIdentity` from an observed `RemoteEvent`, and the design had no module for it

The module map went straight from `identity/source-identity.ts` (the key builder) to the plan,
with no step that answers "which identity is this observed event?". Every write, every dedupe and
every absence check needs that answer. Closed by `src/identity/observed-identity.ts`, exporting
`observedSourceIdentity(event: RemoteEvent): SourceIdentity | null`. The `null` arm is load-bearing:
an event with no resolvable identity reaches `unresolved/missingIdentity` and is never guessed at,
per RECON-I21. Proved by `tests/identity/ambiguity.test.ts`.

Note the derivation the tests pin: recurring content yields `master`, single-occurrence content
yields `slot(uid, start, end)`. The protocol's `RemoteEvent` carries no recurrence-id, so the
`override` shape can only reach the planner through `KnownState` and `MappingSet`. That asymmetry
is real and the implementation must not paper over it.

### RECON-I64. `PlannedWrite` carries its `SourceIdentity`

The published `publicApi` gave `PlannedWrite` only `at` and the intent(s). RECON-I23 requires the
total order to break ties on the identity key, and RECON-I29 requires every input identity to land
in exactly one bucket — neither is expressible without the identity on the entry. Added to both
arms of the union. Proved by `tests/order/write-order.test.ts` and `tests/plan/closure.test.ts`.

### RECON-I65. `SourceIdentity` reaches reconcile as a type-only import, so the one-file rule is a rule about *value* imports

RECON-I56 says sync-ical is imported in exactly one file. `SourceIdentity` is sync-ical's
`EventIdentity` and RECON-I9 forbids redefining it, so `src/identity/source-identity.ts` carries
`import type { EventIdentity } from "@keeper.sh/sync-ical"`. A type-only import is erased and
creates no runtime edge, so the invariant that survives is the stronger, checkable one: exactly one
file — `src/policy.ts` — may import a *value* from sync-ical. `tests/hygiene/one-predicate.test.ts`
asserts that list is exactly `["src/policy.ts"]`.

### RECON-I66. Microsoft Graph's `@removed` may name events outside the requested window

Graph documents that within a `calendarView` delta round, `@removed` with reason `deleted` covers
both events inside the date range that were deleted, and events *outside* the range that were
added, deleted or updated since the previous call
(https://learn.microsoft.com/en-us/graph/delta-query-events). The tempting defence — filter
removals by the mirror window before honouring them — is wrong in the other direction: it drops
authoritative removals we asked for. The design already separates `outsideMirrorWindow` (a mirror
retirement) from `explicitRemoval` (a source deletion) as distinct tombstone causes, which is
exactly the distinction Graph forces; RECON-O7 is the test that keeps them from collapsing, and
`removalBasis` must never window-filter `listing.removals`.

### RECON-I67. RFC 6578 truncation is a 507 *inside* a 207, and the sync-token it returns is still valid

RFC 6578 §3.6 has the server answer a truncated `sync-collection` with 207 Multi-Status carrying a
507 for the request URI, and requires the returned `DAV:sync-token` to represent the correct state
for the partial set returned (https://www.rfc-editor.org/rfc/rfc6578). So truncation is not cursor
loss and it is not an empty calendar: it is `partial` with a continuation, and the honest cursor
decision is `hold`/`listingIncomplete` until the client has walked the continuation. RECON-O1 and
`tests/cursor/independence.test.ts` pin both halves.

### RECON-I68. Google's own recovery advice is "drop the token and full-sync", never "delete the local rows"

Google's sync guide has a 410 `fullSyncRequired` invalidate the stored `syncToken`, after which the
client re-runs a full `events.list` with `timeMin` reset
(https://developers.google.com/workspace/calendar/api/guides/sync). Nothing in that advice licenses
a deletion, yet the shape of the advice — "start over" — is what tempts an implementation to clear
the store first. RECON-O2 forces the opposite: ten populated rows, a `cursorLost` listing, zero
tombstones, `reset`/`cursorLost`, and coverage back to `unproven` so the *next* run cannot infer a
deletion either.

### RECON-I69. Type-level tests are green in the red phase, and that is the correct outcome

Seven `.test-d.ts` files (28 assertions) pass against the unimplemented skeleton, because their
subject is the type declaration and the declarations *are* the specification, not the
implementation. They are regression guards, not red-phase evidence. Ten further assertions pass for
the same structural reason — `as const` set sizes, source greps, and the demonstration that
sync-ical's pipe-joined `eventIdentityKey` really does collide. Every one of them sits in a file
whose behavioural siblings are red. The behavioural count that matters is 238 failing assertions,
all of them reaching a named `unimplemented` throw.

## Green phase addenda (sync-reconcile)

Recorded while making the 276 failing assertions pass. Each entry either records a decision the
design left open, or a correction to the red-phase suite where a test asserted something its own
inputs could not distinguish. The review phase should hold the implementation to these too.

### RECON-I70. The baseline must record the revision it accepted, or a late lower revision is undetectable

RECON-I37 (`staleRevision`) is unprovable against a `KnownEvent` that carries only a fingerprint:
"revision 3 arrived after revision 7" cannot be derived from two content hashes. `KnownEvent` now
carries `revision: Revision` and the rule is explicit — an observation whose revision does not
outrank the baseline **and** whose fingerprint differs from it is withheld as `staleRevision`, and
the known row is left untouched. The fingerprint clause is load-bearing: without it, a settled
re-delivery at the same revision would be reported as stale on every poll.

Test correction: `tests/writes/stale-revision.test.ts` now builds its baseline with
`revision: 7`; `tests/support/fixtures.ts` grows an optional `revision` (default `0`), and
`tests/support/apply.ts` carries the observed revision into the applied baseline. Without those
three lines RECON-O23 asserts a behaviour no implementation can have.

### RECON-I71. There is no bucket for "settled", so a closure assertion may not include a settled identity

RECON-I29 partitions every input identity into writes, tombstones, conflicts or unresolved. An
identity that is present, mapped and unchanged belongs to none of them — that is the definition of
a fixed point (RECON-O20), and `tests/plan/closure.test.ts` itself asserts a healthy input yields
four empty arrays. The mixed scenario therefore may not contain a settled identity, and its
`evt-2` (observed at the fingerprint the baseline already recorded) has been changed to
`fp-changed-2`. The partition claim is unchanged and still exhaustive over the identities the run
actually acts on.

### RECON-I72. Occurrence pairing cannot see the mirror, so it pairs within the series and the *shape* decides the write

`pairReassignedOccurrences(observations, orphanedMappings, limits)` receives no destination
listing, so a "pair only when the mirror fingerprint matches" rule has nothing to compare against —
the mapping's `mirrorFingerprint` is opaque to every other input. Pairing is therefore: refuse
above `limits.reassignmentPairingWidth`; otherwise group both sides by uid, order each side by
identity key, and pair positionally within one series. Nothing crosses a series.

What the mapping's recorded shape decides is the *outcome*, in `deriveWrites`: a pair whose
observed content already matches the baseline for the new identity plans nothing; a pair whose
recorded shape (`allDay` / `timed` / `recurring`) differs from the observed one is a single
`replace` entry (RECON-O16, RECON-I25); anything else is an `update` that keeps the mapping.
The write carries the *mapping's* identity, not the observation's — that is what lets an applier
retire the old row and re-point in one step, and it is what makes the re-identification converge
in one application rather than oscillating (RECON-O20, "a re-identified occurrence").

Test correction: `tests/reassignment/occurrences.test.ts` — the negative case now pairs an
observation in `series-1` against an orphan in `series-2` and is named for what it proves
("pairing never crosses from one series into another"); the mapped series is given the
`fp-shared` baseline its observations carry, so the nine survivors are genuinely settled and the
suite's own claim ("no writes are planned") is about the planner rather than about a fixture typo.

### RECON-I73. Any observation we could not use shields its uid from the absence axis

RECON-I6 made a withheld item count as present. The same argument covers every observation the
source handed us but the planner could not use: an unresolvable identity, a construct the
destination cannot represent (RECON-I28), and our own echo whose identity no longer matches the
row we recorded. All of them shield their uid, so a known row for that uid is not "absent" and
cannot be tombstoned. Only a *usable* observation contributes an identity key alone. This is the
difference between "the source stopped mentioning this event" and "we could not read what the
source said about it", and only the first may delete.

### RECON-I74. A partial listing feeds presence, never the write basis

RECON-I1 forbids a partial or `cursorLost` listing producing a deletion. It must also not produce
an overwrite: half a page is not a version of the calendar. `writeBasis` therefore answers `[]`
for both, while `presenceBasis` still counts their events — the cursor holds
(`listingIncomplete`), the continuation is walked, and the complete listing does the writing. No
work is lost, because nothing was checkpointed.

### RECON-I75. The mirror window is judged only when it is not the window that was requested

`outsideMirrorWindow` retires a mirror for an event the source still has (RECON-I5). Judging it
requires the window predicate, and RECON-I44/RECON-L3 forbid the planner touching the ambient
clock — the injected predicate reads it for us, so the planner must not consult the predicate when
the answer is already known. When the listing's own `scope.window` is exactly `policy.mirrorWindow`
the request has already bounded the answer, and the retirement pass is skipped. The failure mode
this trades into is a mirror that survives one poll too long (a provider may return events outside
the window it was asked for); the failure mode it refuses is an unnecessary deletion. Recurring
identities are exempt from the pass entirely (RECON-I34).

### RECON-I76. The mapping is compared against the baseline, not only against the observation

RECON-O31 has no destination listing: the second writer sees a baseline that already records the
first writer's content and a mapping that still records the old one. A planner that only compared
the observation with the mapping would plan a second update over a mirror it no longer understands.
So the write decision reads three fingerprints — observation, baseline (`KnownState`), mapping — and
a mapping that disagrees with the baseline is a `sourceChanged` conflict carrying the precondition
it expected, never a write. Absence of a destination listing is not permission to assume the
destination agrees with us.

### RECON-I77. Absence outside proven coverage is unresolved, but a recurring identity is judged by the snapshot, not by its anchor

RECON-I34 says a master anchored years before the window is not out of window; the same is true of
proven coverage, whose axes are compared against the recorded `time` and a master's recorded time is
its anchor. A recurring row absent from a snapshot is therefore tombstoned on the snapshot's
authority alone — but still only when coverage is `proven`. Unproven coverage refuses every
deletion, recurring or not (RECON-I3).

---

## Learned in review — the second implementation pass

Six overwrite defects and one lockup-shaped test survived the first pass. Each one is recorded here with
the entry it belongs to, so the ledger reads as what the code does rather than as what it intended.

### RECON-I78. Deletion authority is one value, and every deletion path must read it

Three separate paths could end in a `Tombstone` — an authoritative removal, an absence from a snapshot,
and the mirror-window retirement — and only the first two were gated on `listing.kind`. The third asked
whether the requested scope differed from the mirror window and then deleted drifted mirrors on *any*
listing kind, so a `cursorLost` page deleted real mirrors: the exact failure RECON-I1 and RECON-I19 are
about, reached by a path neither entry had looked at. The fix is not another gate but one shared value:
`src/presence/authority.ts` maps `listing.kind` through the mandated exhaustive switch to
`wholeScope | namedRemovalsOnly | none`, and every deletion path and the reassignment pairing consume it —
`mayRetireItsOwnMirrors` refuses `none`, `speaksForAbsence` admits only `wholeScope`. A new deletion path
that forgets to ask is now the anomaly rather than the default.
**Proved by.**
`tests/deletion/no-wipe.test.ts :: RECON-O1: a partial listing whose scope is not the mirror window still retires nothing`;
`tests/deletion/no-wipe.test.ts :: RECON-O2: a cursorLost listing whose scope is not the mirror window retires nothing either`;
`tests/deletion/no-wipe.test.ts :: RECON-O2: the same drifted row is retired once a snapshot speaks for the scope`.

### RECON-I79. Orphanhood is an absence claim and inherits every absence rule

`orphanedMappings` — mappings whose identity is not in the presence basis — was computed for every listing
kind and fed to occurrence pairing. On a delta, presence holds only the events on that page, so a page
carrying one *new* occurrence of a series paired positionally with the mapping of a different, still-alive
occurrence and planned an `update` over its mirror. Absence from a delta page was laundered into an
overwrite without ever touching `removals.ts`. Pairing now runs only under `speaksForAbsence`, which is
`snapshot` alone; on a delta a shifted occurrence is created and its predecessor is simply left mapped,
which is the conservative outcome and is repaired by the next snapshot.
**Proved by.**
`tests/deletion/delta-authority.test.ts :: RECON-O3: a delta page carrying a new occurrence never rewrites an unmentioned sibling`.

### RECON-I80. A tombstone that can delete carries a precondition; one that cannot is a different value

RECON-I13 was enforced over `WriteIntent` only, and `Tombstone` — the planner's *actual* deletion channel —
carried `handle: DeleteHandle | null` and no precondition at all, so "a delete without a precondition is
not expressible" was false for every deletion this package emits. `Tombstone` is now a discriminated union:
`retireMirror` carries a non-null `DeleteHandle` **and** the mapping's `ObservedPrecondition`, and
`forgetKnownRow` carries neither and names no destination, so an unmapped absence cannot be applied as a
delete by construction rather than by an applier remembering to check for `null`.
**Proved by.**
`tests/writes/delete-handle.test.ts :: RECON-O17: a mapped retirement carries the mapping's precondition`;
`tests/writes/delete-handle.test.ts :: RECON-O17: an unmapped absence forgets the row rather than inventing a delete`.

### RECON-I81. A reassignment re-points a mirror, so it must prove the mirror is still ours

`decideMappedWrite` compared the observed mirror against the mapping; `decideReassignedWrite` did not look
at `mirrors` at all, so a shifted occurrence wrote its content over a mirror the user had edited, with a
matching precondition and no conflict raised. Both paths now consult the observed mirror, with a deliberate
asymmetry: on the mapped path a precondition mismatch is always a conflict, and a fingerprint divergence is
a conflict when the source content is unchanged (the only case where divergence is the sole news). On the
reassignment path *any* divergence from the mapping is a conflict, because we are repurposing a mirror the
source no longer claims at that slot and the write would carry a different occurrence's content onto it.
**Proved by.**
`tests/reassignment/occurrences.test.ts :: RECON-O34: a reassignment onto a mirror the user edited is a conflict, not an update`;
`tests/reassignment/occurrences.test.ts :: RECON-O34: an untouched mirror still takes the reassignment`.

### RECON-I82. A mapping records which calendar it points at, so the planner must check it

`Mapping.destinationCalendar` was declared and never read, while `updateIntentFor` built writes as
`{ calendar: policy.destination, target: mapping.destination.id, precondition: mapping.precondition }` — a
foreign calendar's event id and etag applied to this calendar. RECON-I27 already claimed this was refused;
it now is. `indexMappings` takes the destination `CalendarKey` and throws `ReconcileInternalDataError` for
any entry recorded against another calendar, in the same pass that refuses a duplicate source claim.
**Proved by.**
`tests/plan/fail-loud.test.ts :: RECON-I27: a mapping pointing at a foreign destination calendar fails loud`.

### RECON-I83. A wall-clock assertion measures the CI agent, not the algorithm

`RECON-L6` asserted `large < small * 3` over `performance.now()` samples, which is a flake generator that
proves nothing about complexity, and it inspected nothing else about the plan. It is replaced by a counted
assertion in the style of RECON-L4: the window predicate is injectable (RECON-I33), so the test injects a
counting predicate and asserts that doubling the state doubles the probes rather than squaring them. No
test in this package now asserts on elapsed time.
**Proved by.**
`tests/limits/large-state.test.ts :: RECON-L6: doubling the state doubles the window probes rather than squaring them`.

### RECON-I84. A ledger that cannot be walked is a ledger that drifts

The ledger promised that every **Proved by** line names a real file and the exact test name inside it, and
145 of 150 citations did not, because the entries were written before the tests and never reconciled with
their final wording. Two named files that were never created. The citations are regenerated from the actual
`test(...)` strings, and the promise is now enforced by a test that parses this document, extracts every
citation in the sync-reconcile section and asserts the file exists and contains the title verbatim — the
mechanical walk the ledger claimed. A renamed test now fails the suite instead of quietly orphaning a claim.
**Proved by.**
`tests/hygiene/ledger-citations.test.ts :: RECON-I29: every cited test file exists`;
`tests/hygiene/ledger-citations.test.ts :: RECON-I29: every cited test name exists verbatim in the file that is cited`;
`tests/hygiene/ledger-citations.test.ts :: RECON-I29: the walk covers the whole ledger, not a handful of lines`.

### RECON-I85. The mirror-window pass fires only when the requested scope is not the mirror window

Review asked why a row that drifted out of the mirror window is not retired when the caller requested
exactly that window. It is deliberate and it is the safer of the two. When scope equals the mirror window,
a drifted row is simply absent from the listing, so it reaches the absence path — which demands *proven
coverage* before it deletes and reports `outsideProvenCoverage` when it has none. Retiring it on the
window comparison alone would bypass that proof. The comparison exists so that a caller who deliberately
listed a narrower or wider window than it mirrors can still retire what it no longer mirrors.
**Proved by.**
`tests/deletion/two-windows.test.ts :: RECON-O7: an event inside proven coverage but outside the mirror window retires the mirror`;
`tests/coverage/proven-coverage.test.ts :: RECON-O4: the same absence is reported as unresolved rather than silently dropped`.

---

# sync-conformance learnings ledger

`@keeper.sh/sync-conformance` at `packages/sync-kit/conformance`: the executable specification every
adapter runs against itself. One entry point, `runConformance({ name, supports, create, withinWindow })`,
which generates the case set from the adapter's declared `Capabilities`, registers it with `describe`/`it`
and returns a report naming every case it selected, every case it took the alternative branch of, and every
case it skipped. It ships an in-memory reference provider that passes, plus four fixtures that truncate a
page, expire a cursor, force a precondition conflict and stall a request forever.

Numbering is prefixed `CONF-` so it appends to the protocol (1–60), sync-ical (`ICAL-I1`–`ICAL-I71`) and
sync-reconcile (`RECON-I1`–`RECON-I85`) ledgers above without renumbering anyone. `CONF-I1`–`CONF-I60` are
adopted. `CONF-I61`–`CONF-I68` are not applicable and say why. `CONF-I69`–`CONF-I78` are the dependency and
process decisions. `CONF-I79`–`CONF-I82` were added by review. The module map, the public API and the
`CONF-O` (overwrite) / `CONF-L` (lockup) test indexes are the closing sections.

The suite has landed. Every citation is a **Proved by.** line naming the case id and the test file whose
titles carry it, and `conformance/tests/hygiene/ledger-citations.test.ts` walks this section against
`src/case-id.ts` and against the test titles themselves — the same mechanical walk `RECON-I84` added for
sync-reconcile. `CONF-I79`–`CONF-I82` were added by the adversarial review of the first implementation
pass and are collected in the closing **Added after review** section.

A note on what "honoured" means here, because this package is unusual. sync-protocol honours a lesson by
making the wrong thing unsayable in the type system; sync-reconcile honours it by computing the right
answer. sync-conformance honours it by **generating a case that fails when an adapter gets it wrong**, and
by shipping a **negative control** — a deliberately mutated provider that must fail exactly that case and no
other. A conformance case with no negative control is an assertion nobody has ever seen fail, which is the
same failure class as a capability flag nobody checks (CONF-I37).

---

## Adopted

### CONF-I1. A truncated read is indistinguishable from a deletion, so it must be a different listing kind

**Lesson.** `ingestSource` given a fetch that silently returned 1 of 3 stored events emitted 2 deletes, and
those deletes reached real calendars. The repo keeps this as a characterization test, not a bug report,
because it is the executable reason `CalDAVClient.fetchCalendarObjects` throws on a short multiget.
**Learned from.** `packages/calendar/tests/core/sync-engine/ingest-truncation.test.ts ::
"deletes every stored source event when a fetch silently returns a subset"`;
`providers/caldav/shared/client.ts` (`CalDAVIncompleteMultiGetError`); RFC 6578 §3.6, which signals
truncation with a 207 whose request-URI response carries 507 plus `DAV:number-of-matches-within-limits`.
**Honoured by.** The flagship fixture `truncatingAfter(n)`, and the flagship case family
`deletion-safety`. For every adapter the suite asserts: a truncated page yields `kind: "partial"` or
`Result.ok === false`, never `snapshot`; `assertNoRemovalDerivable` passes on the result; and the cursor is
unchanged. The type system already forbids `removals` and `coverage` on `partial` (protocol entry 1), so
the runtime case exists to prove the **adapter** reaches that kind rather than manufacturing a `snapshot`
from a short read.
**Proved by.** `CONF-O1` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I2. An empty listing must never mean "the calendar is empty"

**Lesson.** A failed HTTP fetch was swallowed and returned as empty, which ingest read as "the source
authoritatively has zero events" and deleted every `event_state` row for the calendar on the next tick.
**Learned from.** commit `0184ea19` *fix(ics): don't wipe existing events when remote fetch fails (#383)*;
`ics/utils/fetch-adapter.ts`; test *"propagates fetch errors instead of returning empty events"*.
**Honoured by.** An ungated case that drives the adapter with a transport that fails, and asserts
`Result.ok === false` with a typed `ProviderFailure`. A separate case seeds a genuinely empty calendar and
asserts the two outputs are **distinguishable** — a suite that only checked "does not throw" would pass
both.
**Proved by.** `CONF-O2` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I3. Deletion authority is a discriminant, not a flag, and differs per adapter

**Lesson.** A delta source reports only changes, so absence means unchanged; a snapshot source re-reports
its coverage, so absence means gone. The old code threaded `isDeltaSync?: boolean` through four call sites.
**Learned from.** `core/source/event-diff.ts` (`buildSourceEventStateIdsToRemove`);
`core/sync-engine/ingest.ts` (`getNonRecurringStoredEventIdsOutsideWindow`).
**Honoured by.** `supports.deletionAuthority` selects a case set rather than removing one.
`snapshotAbsence` gets "an event absent from a snapshot inside proven coverage is removed";
`explicitRemovalsOnly` gets "an event absent from a listing is never removed, and a named removal is". Both
halves are generated; neither adapter runs the other's. The report records which branch was taken so the
adapter's own test file asserts on it.
**Proved by.** `CONF-O3` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I4. Deletion may only be inferred inside a coverage window the listing itself proved

**Lesson.** Reconciliation carries `authoritativeWindow`, `authoritativeSourceWindows` and
`requestedWindow` as three separate values with different powers; a destination whose sources are
unverified is limited to explicit requested-window cleanup.
**Learned from.** `core/sync/operations.ts` (`ReconciliationScope`, `isInsideSourceAuthoritativeWindow`);
tests *"does not reconcile a mapping inside the requested window but outside source coverage"*,
*"limits unverified reconciliation to explicit requested-window cleanup"*.
**Honoured by.** The suite requests a window strictly wider than the reference provider will cover, and
asserts the returned `listing.coverage.covered` is the narrower one and that no removal is derivable for
identities in the requested-but-uncovered band. It also asserts `coverage.calendar` equals `scope.calendar`
— a coverage window proved for a different calendar is a foreign-calendar overwrite (RECON-I27).
**Proved by.** `CONF-O4` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I5. A withheld event is present, not absent

**Lesson.** Filtering an unrepresentable event out of the listing makes the diff see it as absent and
delete the stored row the user still has. The ICS adapter deliberately keeps unsupported UIDs **in**
`events` and reports them separately.
**Learned from.** `ics/utils/fetch-adapter.ts` (`unsupportedEventUids`); `core/sync-engine/ingest.ts`
lines 226–232, 323–336; tests *"withholds unsupported events, counts them, and keeps their stored state"*,
*"never deletes the stored row of the event it withholds"*.
**Honoured by.** An ungated case that seeds an event the adapter cannot represent, asserts it appears in
`listing.withheld` with a `WithholdReason`, and asserts no removal is derivable for its identity. The
assertion runs on **both** sides: the withheld identity must also not appear as a deletable mirror
(CONF-I41).
**Proved by.** `CONF-O5` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I6. One bad event must not stall the whole feed, and a real deletion in the same payload still applies

**Lesson.** A single VEVENT with an hour-based all-day DURATION, a negative DURATION, a THISANDFUTURE
override or an uninterpretable TZID used to throw out of the whole fetch — nothing applied, the token never
advanced, the calendar never converged.
**Learned from.** commits `fdd9ba62` (#634) and `43292a9f` (#606);
`ics-malformed-vevent-telemetry.test.ts :: "applies a real deletion that arrives in the same feed as a
malformed VEVENT"`, *"converges over repeated polls of the same malformed feed"*.
**Honoured by.** A three-part case: a listing carrying one unusable item still returns `ok` with the other
items; a genuine removal delivered in the same listing is still expressed; and polling the same input twice
produces byte-identical output including diagnostics.
**Proved by.** `CONF-O6` in `conformance/tests/isolation.test.ts`.

### CONF-I7. An unbuildable newest revision must withhold its whole identity, not fall back to the older one

**Lesson.** Letting the superseded revision win syncs the instance at a stale time — a silent wrong write,
not a missing one.
**Learned from.** `ics/utils/parse-ics-events.ts` lines 413–444; commit `8106280b`;
`ics-stale-revision-telemetry.test.ts :: "never reverts a stored event to the time the publisher moved it
away from"`.
**Honoured by.** An overwrite case that seeds two revisions of one identity where the newer is
unrepresentable, and asserts the older revision's time is **not** written — the adapter must withhold the
identity, not downgrade it.
**Proved by.** `CONF-O7` in `conformance/tests/writes.test.ts`.

### CONF-I8. Revision order is a total order derived from content, never feed order

**Lesson.** Producing a different winner when the same pair is listed in the opposite order churns the
stored row on every poll.
**Learned from.** `ics/utils/parse-ics-events.ts` (`compareEventRevisions`);
`ics-superseded-slot-telemetry.test.ts :: "drops the same copy whichever order the feed lists the pair in"`,
*"settles without churning the surviving row over repeated polls"*.
**Honoured by.** The order-permutation case: the same colliding pair is fed in both orders and the two
listings must be deeply equal after canonicalisation, then polled twice for zero further writes.
**Proved by.** `CONF-O8` in `conformance/tests/convergence.test.ts`.

### CONF-I9. Re-ingesting identical input must be no work at all, not an idempotent write

**Lesson.** Any residual churn multiplies into destination writes, quota, audit-log entries and etag
invalidation for other clients.
**Learned from.** `degenerate-range-source-ingest.test.ts :: "re-reads an unchanged feed as no work at
all"`; `ingest.test.ts :: "does not flush when there are no changes"`; the twelve `*convergence*` suites.
**Honoured by.** Convergence is asserted as a **count of write operations**, not state equality.
`CONF-O9` polls an unchanged calendar twice and asserts the provider's write log did not grow; `CONF-O28`
writes a degenerate range, lets the provider widen it, and asserts the replay is not a fresh write; the
reference provider is exercised by a full fixed point — list, apply, list, list — and the write log after
convergence must equal the write log after the apply. "No work" means **no write**, never no read: see
`CONF-I82`.
**Proved by.** `CONF-O9` in `conformance/tests/convergence.test.ts`.

### CONF-I10. An expired cursor discards the whole pagination, clears the token, and carries no tombstones

**Lesson.** A 410 mid-pagination must discard every accumulated page rather than commit a partial result,
and the sync token only advances when the whole pagination completes.
**Learned from.** `providers/google/source/utils/fetch-events.ts` (`fullSyncRequired` returned from inside
the page loop); the Outlook equivalent; `core/sync-engine/ingest.ts`
(`fullSyncRequired => flush({inserts:[],deletes:[],syncToken:null})`); Google's documented 410 GONE;
Graph's 410 `syncStateNotFound`; RFC 6578 §3.2 `DAV:valid-sync-token`.
**Honoured by.** The `expiringCursorAfter(n)` fixture, and a case asserting all four of: the listing kind
is `cursorLost`; no events and no removals leak out (the type forbids the fields, the case proves the
adapter does not instead return an empty `delta`); the cursor is cleared rather than retained; and the
resync that follows is what deletes.
**Proved by.** `CONF-O10` in `conformance/tests/cursor.test.ts`.

### CONF-I11. A cursor is valid only for the request shape that minted it

**Lesson.** Sync tokens were stored with an encoded sync-window version; widening the required window
discards the token and forces a backfill, because a token minted under a narrower window will never report
events in the newly added range.
**Learned from.** `core/oauth/sync-token.ts` (`resolveSyncTokenForWindow`, `requiresBackfill`);
`tests/core/oauth/sync-token.test.ts`.
**Honoured by.** Gated on `supports.delta.windowBoundToCursor`. Mint a cursor under window A, request
window B ⊃ A with the same cursor, and assert the adapter answers `cursorLost` (or a `cursorInvalid`
failure) rather than a delta that silently omits the new range. The protocol already carries `scope` on
`SyncCursor`, so the adapter has the information; the case proves it uses it.
**Proved by.** `CONF-O11` in `conformance/tests/cursor.test.ts`.

### CONF-I12. Corrupt known state forces a resync and never becomes a tombstone by omission

**Lesson.** A stored row that fails validation is removed only if the fetch still reports its identity; on
a delta sync any validation failure resets the token instead of diffing against a partial picture.
**Learned from.** `core/sync-engine/ingest.ts` lines 285–304; tests *"resets delta sync when a corrupt
stored row requires full-sync recovery"*, *"keeps an unparseable stored row belonging to a withheld
over-budget series"*.
**Honoured by.** A case that seeds the provider-under-test with a corrupt known row through the
`ProviderUnderTest.seed` seam, asserts a resync is demanded, and asserts zero removals are emitted.
**Proved by.** `CONF-O12` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I13. An ambiguous removal is not a deletion

**Lesson.** Graph's `@removed` tombstone may omit the event type, and a sparse id may name a series master
while local state holds only expanded instances — advancing the token would strand every occurrence. The
code declares the whole delta unusable and demands a full sync rather than guessing.
**Learned from.** `providers/outlook/source/utils/fetch-events.ts` (the `@removed && !event.type` branch,
the seriesMaster-in-delta branch).
**Honoured by.** Gated on `supports.removalsAreAmbiguous`. `ProviderSeed.unattributableRemovals` is the
seam: the case seeds a tombstone the adapter cannot attribute to an identity and asserts it produces either
`cursorLost` or a removal the suite cannot name — never an `AuthoritativeRemoval`, and never a blank uid.
The negative control is a mutant that blanks the uid of a removal it does report.
**Proved by.** `CONF-O13` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I14. A replayed create is a no-op; a create conflict without a usable precondition is a refusal

**Lesson.** `recoverCreateConflict` returns early when the remote copy already matches, and otherwise
requires an ETag, throwing *"already exists but has no ETag for a safe recreation"* rather than
delete-then-create blind.
**Learned from.** `providers/caldav/destination/provider.ts`; `caldav/shared/client.ts`
(412 → `CalDAVCreateConflictError`); RFC 4791 §4.1 (`CALDAV:no-uid-conflict`) and §5.3.2
(`If-None-Match: *`).
**Honoured by.** Two ungated cases. Replaying an identical `create` with the same `IdempotencyKey` must
return `alreadyExists` or `unchanged` with the same `RemoteRef`, and the store must hold exactly one
object. A conflicting create whose remote copy differs must return `conflict` carrying the observed
precondition — never a `deleted` followed by a `created`, which the suite detects by counting the
provider's write log.
**Proved by.** `CONF-O14` and `CONF-O15` in `conformance/tests/writes.test.ts`.

### CONF-I15. Provenance is per-provider and may be undetectable, and that must be sayable

**Lesson.** Google and ICS detect our own events by a UID suffix; Outlook by a category, because Graph
rewrites `iCalUId`; CalDAV by the `.ics` filename. Outlook's reader checks both.
**Learned from.** `core/events/identity.ts` (`isKeeperEvent`);
`providers/outlook/source/utils/fetch-events.ts` lines 565–573; `providers/caldav/destination/provider.ts`.
**Honoured by.** `supports.provenanceChannel` selects the carrier, and the case is proved by **round trip**
— write through the adapter, list back through the same adapter, assert the returned event is `OwnEvent`
with our `InstallationId` — never by inspecting provider internals. For `none`, the alternative case
asserts the round-tripped event is `IndeterminateEvent` and that no deletion of an indeterminate event is
derivable.
**Proved by.** `CONF-O16` in `conformance/tests/provenance.test.ts`.

### CONF-I16. A foreign event must survive every reconciliation the suite can generate

**Lesson.** Orphan cleanup skips `!remoteEvent.isKeeperEvent` and skips anything outside the authoritative
window. Without the window check, a freshly imported calendar deletes Keeper-tagged events another row
legitimately placed there.
**Learned from.** `core/sync/operations.ts` lines 590–613; tests *"does not remove unmapped non-keeper
future events"*, *"does not remove an unmapped non-keeper event after it becomes historical"*.
**Honoured by.** `CONF-O17` seeds a `ForeignEvent` canary, writes beside it, lists, and asserts the canary
is byte-identical afterwards; the negative control bumps the canary's revision on **any** successful create
or update, so every write path in the reference is covered by that one mutant. The originally planned
*shared teardown* over every write-family case was **not** built: `create` runs per case (`CONF-I57`) and a
shared hook cannot know each case's seed, so the mutant — which disturbs the canary from inside the
provider — is what makes the guarantee general rather than local to `CONF-O17`.
**Proved by.** `CONF-O17` in `conformance/tests/provenance.test.ts`.

### CONF-I17. Echo verification is three-state, and "no echo" is not "matched"

**Lesson.** A CalDAV PUT answers 201/204 with no body, so there is nothing to compare; the code declares
`{ comparable: false }` rather than reporting zero divergence. Only booleans and lengths ever leave the
echo module — never field values.
**Learned from.** `providers/caldav/destination/provider.ts` (`CALDAV_PUSH_ECHO`);
`core/events/push-echo.ts` header comment; `core/sync-engine/index.ts` (`tallyPushEcho`).
**Honoured by.** Gated on `supports.echoesWrites`. An adapter that cannot echo must return
`echo: { kind: "notObserved" }`, and the suite asserts the report counts it as **not observed**, not as
matched. A separate ungated assertion scans every `BoundedSample` the adapter emits for the seeded event's
title, description and location strings, and fails if any appears — diagnostics carry identifiers, never
content.
**Proved by.** `CONF-O18` in `conformance/tests/writes.test.ts`; the content-leak scan is `CONF-O19` in
`conformance/tests/diagnostics.test.ts`.

### CONF-I18. Echo must tolerate the provider's own lossless rewrites, or the mirror churns forever

**Lesson.** Timestamps compared at whole-second granularity, text CRLF-normalised and trimmed,
availability defaulting to busy, and an unsupported OOO availability coerced to busy must not read as
drift.
**Learned from.** `core/events/push-echo.ts` (`isSameSerializedSecond`); `core/events/content-hash.ts`;
tests *"does not churn when a destination serializes timestamps to whole seconds"*, *"does not churn when a
provider coerces unsupported OOO availability to busy"*; RFC 4791 §5.3.4, which forbids returning a strong
ETag when the stored bytes differ from the submitted bytes.
**Honoured by.** The **reference provider deliberately rewrites what it stores** — it truncates sub-second
precision, normalises CRLF and trims trailing whitespace — so any adapter that trusts its own submitted
representation instead of the provider's returned `RemoteVersion`/`Fingerprint` fails the convergence case
rather than passing it by luck.
**Proved by.** `CONF-O20` in `conformance/tests/convergence.test.ts`.

### CONF-I19. Identity is canonical and excludes mutable content

**Lesson.** Key order, `undefined` vs `null`, and array order must not produce a false change; occurrence
identity is distinct from resource identity.
**Learned from.** `core/source/event-diff.ts` (`canonicalizeStructuredIdentityValue`,
`buildSourceEventIdentityKey`); tests *"does not diff equivalent recurrence payloads with different key
order"*, *"handles null/undefined timezone by treating them as equivalent"*.
**Honoured by.** The suite's own canonical encoder follows RFC 8785 key ordering (UTF-16 code-unit order,
**not** `localeCompare`) and is used for every deep comparison the suite makes. A generated case presents
the same event twice with permuted key order and equivalent absent-value spellings, and asserts one
identity and zero writes. A dedicated case covers astral-plane and combining-mark keys, because the sorting
rule is the footgun.
**Proved by.** `CONF-O21` in `conformance/tests/convergence.test.ts`.

### CONF-I20. A repeated identity in one listing is one entry, last observation wins

**Lesson.** One provider batch reporting the same occurrence several times produced duplicate inserts;
Google's delta applies only the final version when an occurrence changes repeatedly in one delta. Graph
documents replays explicitly and guarantees no ordering.
**Learned from.** `core/source/event-diff.ts` (`deduplicateIncomingEvents`); `ingest.test.ts :: "applies
only the final version when a provider occurrence changes repeatedly in one delta"`;
learn.microsoft.com/graph/delta-query-overview §Replays.
**Honoured by.** A case that makes the provider emit one identity N times in a single listing and asserts
the reconciled result has exactly one entry equal to the last observation, and that feeding the repeats in
reverse order yields the same winner (CONF-I8).
**Proved by.** `CONF-O22` in `conformance/tests/convergence.test.ts`.

### CONF-I21. Every retry path has a provable ceiling and a capped provider-supplied delay

**Lesson.** `withBackoff` bounds attempts, caps `Retry-After` at 64s, uses an abortable `setTimeout`-based
sleep that removes its listener on the timeout path and clears the timer on the abort path, and ends with
an explicit unreachable throw so the loop cannot fall out silently.
**Learned from.** `core/utils/backoff.ts`; `backoff.test.ts :: "caps a provider-supplied delay at the
maximum backoff"`, *"throws after exhausting all retries"*.
**Honoured by.** `OperationContext.retryBudget` is handed to the adapter by the suite, and the generated
case drives a transport that answers `rateLimited` forever with a `retryAfter` in 2099. It asserts the
transport was reached exactly `maxAttempts` times and that the injected clock advanced by no more than
`maxAttempts * retryDelayCeilingMs`, then calls the adapter's own `retryCeilingProven` obligation. The
abortable sleep is `TestClock.sleep`, which registers its abort listener against its own `AbortController`
and tears it down on **both** paths, so a caller reusing one signal across a retry loop accumulates no
listeners — asserted directly with `getEventListeners`. The backoff sleeps on a signal composed from the
provider's lifetime and the caller's, so an abort cancels the pending delay instead of leaving it armed.
**Proved by.** `CONF-L1` in `conformance/tests/lockups.test.ts`.

### CONF-I22. Every await on an outside resource carries a deadline, and a timeout is not a caller abort

**Lesson.** `mergeAbortSignals` removes every listener on the first abort, and `buildTimeoutSignal` keeps a
separate `isTimeout()` so a caller-initiated abort is not misreported as a provider timeout.
**Learned from.** `core/utils/fetch-with-timeout.ts` (`RequestTimeoutError`, `isTimeoutError`);
`fetch-with-timeout.test.ts`.
**Honoured by.** Both the `stallingOn(predicate)` fixture and `TransportStub.stall()` answer with a
permanently pending promise, never a long timer, so the deadline must come from outside the awaited work.
`CONF-L2` stalls the transport, gives the call a **positive** budget, and asserts both that the transport
was reached and that the answer is `budgetExhausted`; `CONF-L3` stalls the transport, lets the call reach
it, then aborts mid-flight and asserts `aborted` — a different value from the deadline case. A caller that
walks away from a flight abandons its coalescing key, so the caller after it starts a fresh flight rather
than joining a leader nobody is waiting for.
**Proved by.** `CONF-L2` and `CONF-L3` in `conformance/tests/lockups.test.ts`.

### CONF-I23. A single-flight leader's failure reaches every follower, and the slot is freed on the throwing path

**Lesson.** The refresh coordinator deletes its in-flight entry in a `finally` guarded by an identity check
so a later generation is not evicted, and the distributed release is best-effort with a TTL fallback so a
release failure cannot wedge the next caller.
**Learned from.** `core/oauth/refresh-coordinator.ts`; `refresh-coordinator.test.ts :: "coalesces
concurrent refreshes for the same credential"`, *"releases the lock after failures"*.
**Honoured by.** Four assertions, not two: the leader's rejection reaches every follower registered before
it settled; the coalescing slot is freed on the rejecting path; a follower registering **after** the leader
rejected starts a fresh attempt rather than inheriting the dead one (the gap the existing repo tests do not
cover); and a second generation started after the first settled is not evicted by the first's `finally`.
Gated on the adapter declaring any coalescing at all, which the suite detects by observing fewer transport
calls than concurrent invocations.
**Proved by.** `CONF-L4` in `conformance/tests/lockups.test.ts`.

### CONF-I24. Telemetry emitted inside a coalesced body lands on a foreign caller's context

**Lesson.** Only the joining branch runs in the joining caller's async context; a shared body runs in
whichever context created the promise, so telemetry emitted there is attributed to the wrong wide event.
**Learned from.** `core/oauth/refresh-coordinator.ts` (the comment above
`widelog.set("token.refresh_coalesced")`); `core/sync-engine/ingest.ts` lines 191–205 (`measureDiff`).
**Honoured by.** A constraint on the harness rather than a generated case: `runConformance` attributes
`ListingDiagnostics` to the call that returned them, and the concurrency case asserts that two coalesced
callers each receive their own diagnostics object with their own `pagesFetched`, rather than one object
shared by reference.
**Proved by.** `CONF-L5` in `conformance/tests/lockups.test.ts`.

### CONF-I25. Multi-key acquisition must be in a canonical order

**Lesson.** `withSourceIngestLocks` dedupes and sorts calendar ids before taking each advisory lock,
because two runs touching the same pair in opposite orders deadlock.
**Learned from.** `core/source/ingest-lock.ts`; `ingest-lock.test.ts :: "acquires every source lock before
running work"`.
**Honoured by.** A case that issues two concurrent `listChanges` calls over overlapping calendar sets in
opposite orders and asserts both settle before the fake clock passes the deadline. Gated on the adapter
enumerating more than one calendar.
**Proved by.** `CONF-L6` in `conformance/tests/lockups.test.ts`.

### CONF-I26. A lease releases on the throwing path and leaves no timer behind

**Lesson.** The sync lock's renewal records an error and clears it on the next success; loss is detected by
reading a different holder, not by the renewal flag; release always clears the interval before the release
script, so an abandoned handle cannot leave a timer running.
**Learned from.** `packages/sync/src/sync-lock.ts` (`createLockHandle`).
**Honoured by.** The suite invokes every adapter operation once with a transport that throws synchronously
and once with one that rejects, then asserts the operation can be invoked again and succeed — a lease held
past a throw shows up as the second call hanging, which the deadline turns into a failure rather than a CI
hang. After each case the suite advances the fake clock past every declared budget and asserts no timer
callback fires. The coalescing slot is released on **both** settlement paths, so a rejecting body cannot
poison its key for the process lifetime, and the seven `ProviderConformanceSuite` obligations are not
decoration: each is invoked by the case that owns it — `retryCeilingProven` by `CONF-L1`,
`deadlineOnNeverResolvingStub` by `CONF-L2`, `abortMidFlightCleansUp` by `CONF-L3`,
`followerRejectsWhenLeaderFails` by `CONF-L4`, `concurrentSameKeyDoesNotDeadlock` by `CONF-L6`,
`leaseReleasedOnThrow` by `CONF-L7` and `deletionInputsShareOneCalendar` by `CONF-O4` — and each has a
body that reads a different piece of the adapter's own state.
**Proved by.** `CONF-L7` and `CONF-L8` in `conformance/tests/lockups.test.ts`.

### CONF-I27. A cancelled waiter must not strand its successors, and every poll has a ceiling

**Lesson.** The sync lock's poll loop has an explicit timeout, returns `{acquired:false}` on abort, and its
`finally` cancels the waiter on every non-acquiring exit, atomically promoting the previous live waiter.
**Learned from.** `packages/sync/src/sync-lock.ts` (`CANCEL_WAITER_SCRIPT`).
**Honoured by.** A case that starts three concurrent same-key operations, aborts the second mid-flight, and
asserts the first and third both settle. The aborted one must reject; the others must not inherit its abort
reason.
**Proved by.** `CONF-L9` in `conformance/tests/lockups.test.ts`.

### CONF-I28. An aborted queued task is rejected, not dropped, and its slot is not lost

**Lesson.** The rate limiter splices the cancelled task out, rejects it with a named error and re-runs the
queue so the concurrency slot is not lost; `executeTask` decrements in a `finally` so a throwing task
cannot leak a permit permanently.
**Learned from.** `core/utils/rate-limiter.ts`; `rate-limiter.test.ts :: "rejects an aborted queued task
without starting it"`.
**Honoured by.** A case that queues N operations against an adapter whose declared concurrency is less than
N, makes one throw and aborts another, and asserts the remaining N−2 all complete. A permanently leaked
permit shows up as the tail never settling, which the deadline converts into a failure.
**Proved by.** `CONF-L10` in `conformance/tests/lockups.test.ts`.

### CONF-I29. Fan-out returns a result for every task, and never exceeds the declared concurrency

**Lesson.** `allSettledWithConcurrency` builds a bounded worker pool that catches per task, so one
rejection cannot abort the pool or leave holes in the results.
**Learned from.** `core/utils/concurrency.ts`.
**Honoured by.** A case in which task k rejects and task j stalls forever: the suite asserts N results are
returned (not N−1), that the stalled one is a deadline failure rather than a missing entry, and that
`transport.inFlightPeak()` never exceeded the concurrency the adapter declared.
**Proved by.** `CONF-L11` in `conformance/tests/lockups.test.ts`.

### CONF-I30. Failures are classified by discriminant, never by matching message text

**Lesson.** A database error's message inlines the SQL and its bound parameters, so **customer data** can
match a backoff pattern and put a healthy calendar into permanent backoff.
**Learned from.** `packages/sync/src/destination-errors.ts` (`BACKOFF_ERROR_PATTERNS` and its
`isDatabaseError` early return).
**Honoured by.** `ProviderFailure` is already a discriminated union, so the case is hostile rather than
structural: the suite seeds an event whose title and description contain `"rate limit exceeded"`,
`"410 Gone"`, `"Precondition Failed"` and a NUL byte, and asserts every failure classification and every
identity key is unchanged from the benign run.
**Proved by.** `CONF-O23` in `conformance/tests/hostile-content.test.ts`.

### CONF-I31. An unattempted run is a third state, neither success nor failure

**Lesson.** `resolveDestinationAttemptVerdict` returns "inconclusive" when superseded with zero attempted
operations — escalating punishes a healthy destination, clearing lets a broken one oscillate forever.
**Learned from.** `packages/sync/src/destination-errors.ts`.
**Honoured by.** A case that aborts before the first transport call and asserts the outcome is
`notAttempted`, plus an assertion that the suite's own report counts it in neither the passed nor the
failed tally — the third state must survive the harness, not just the adapter.
**Proved by.** `CONF-L12` in `conformance/tests/lockups.test.ts`.

### CONF-I32. A superseded run never advances the cursor

**Lesson.** ingest fetches, checks `isCurrent()`, then opens the transaction; on supersession it returns
empty with `flushed: false` and no sync token. Writing a cursor on the superseded path advances the sync
frontier past changes that were never applied — silent, unrecoverable data loss.
**Learned from.** `core/sync-engine/ingest.ts` lines 260–266; `ingest-superseded.test.ts :: "never writes a
sync token on the superseded path"`.
**Honoured by.** A case that aborts the operation after the first page and before the last, and asserts the
adapter returns no `SyncCursor` — with that test name reused verbatim, because the name is the invariant.
Cursor non-advancement is asserted on three separate paths: truncated read, aborted run, transport failure.
**Proved by.** `CONF-O24` in `conformance/tests/cursor.test.ts`.

### CONF-I33. A replace whose create fails after the delete succeeded must leave a recoverable state

**Lesson.** The engine checkpoints removals before adds, checkpoints a successful chunk before a later one
fails, and keeps the stale mapping when a recreation fails after a successful delete, so a crash between
delete and create does not orphan a real event.
**Learned from.** commit `1c5171d2`; `index.test.ts :: "keeps the stale mapping when recreation fails after
a successful delete"`, *"does not checkpoint the stale mapping when recreation aborts after deletion"*.
**Honoured by.** The case performs a real replace: it deletes the original, then issues the create half
against an identity another copy already blocks, so the second half fails the way `CONF-I14` says it must —
a `conflict` carrying the blocking `RemoteRef`. It then asserts the deleted target is still named in the
write log, that the blocking copy came through the failed half unchanged, and that recreating the original
on the next run succeeds. `assertNoUnplannedRecreation` takes the removals the case *planned*, so a
deliberate delete-then-create is expressible while an unplanned one is still a violation.
**Proved by.** `CONF-O25` in `conformance/tests/writes.test.ts`.

### CONF-I34. Storage bounds and mirror bounds are different windows

**Lesson.** ICS retains the whole feed unbounded, because filtering by window would make the snapshot diff
delete every historic stored row on the next ingest; the sync window bounds only what is mirrored.
**Learned from.** `ics/utils/fetch-adapter.ts` (*"The whole feed is kept on purpose…"*);
`fetch-adapter.test.ts :: "returns events far outside the sync window so stored history stays unbounded"`;
`ingest.test.ts :: "keeps stored history a snapshot source still reports outside the sync window"`.
**Honoured by.** A case gated on `supports.deletionAuthority` in which the source still holds an event
outside the requested window. The adapter must either report it or leave it outside the coverage it proved
— Google's `timeMin`/`timeMax` and Graph's `calendarView` filter, so demanding it be *returned* would fail
an honest adapter — and in both branches no removal may be derivable for it. That second half is only
meaningful because the removal basis carries each known identity's **time**: `derivableRemovals` calls the
injected `withinWindow` per identity, so an identity outside the proven coverage can never be called
absent. The negative control drops the out-of-window event **and** claims coverage 90 days past what it
read, which is the only shape that turns window filtering into a deletion.
**Proved by.** `CONF-O26` in `conformance/tests/window.test.ts`.

### CONF-I35. Window membership is one predicate, used at every stage, swept at every boundary

**Lesson.** An event that survives one stage and is dropped by the next oscillates forever.
`overlapsTimeWindow` is a single predicate with a documented special case: a degenerate range is judged by
`start >= windowStart && start < windowEnd`.
**Learned from.** `core/events/time-range.ts`; `ingest-window-boundary.test.ts :: "window boundary
agreement between adapter filter and delta pruner"`.
**Honoured by.** `runConformance` takes `withinWindow: WindowMembership` as an **argument** and uses that
one function for every window judgement it makes, so an adapter cannot be checked against a predicate that
differs from the one the reconciler will use. The boundary set is generated from the requested window
rather than hand-picked — on the lower edge, before it, on the upper edge, past it, and zero-duration — and
each member is judged twice: at listing time (a member the predicate admits must be in the listing) and at
removal time (a member the predicate excludes from the proven coverage must not be derivable as a removal).
The case then polls a second time and asserts the two polls agree, and finishes on an inverted window that
may admit nothing.
**Proved by.** `CONF-O27` in `conformance/tests/window.test.ts`.

### CONF-I36. Degenerate ranges are real events; widening at the destination must not read as drift

**Lesson.** Zero-duration and inverted ranges are legitimate and must be preserved, but must be widened at
the destination because RFC 5545 §3.6.1 requires DTEND > DTSTART and Google rejects a non-positive span.
The source row must not then read as changed.
**Learned from.** `core/events/time-range.ts` (`POINT_IN_TIME_DURATION_MS`); commit `b057d2e0` (#616);
`degenerate-range-source-ingest.test.ts :: "does not treat a stored source row as changed after a
destination widened its mirror"`.
**Honoured by.** Gated on `supports.representableRange.zeroDuration`. The reference declares
`minimumSpanSeconds: 900` and widens what it stores, exactly as a destination would. `accept` gets the
mirror-and-echo case: the seeded zero-duration event must still be listed as the source holds it, the
written copy must come back at or above the declared minimum span, and replaying the same create must
answer `alreadyExists`/`unchanged` with the stored revision unmoved — the destination's widening must not
read as drift. `reject` gets the alternative: the write must fail `unrepresentable` with constraint
`minimumSpan`, and must not silently widen.
**Proved by.** `CONF-O28` in `conformance/tests/window.test.ts`.

### CONF-I37. A capability declaration that is never checked against behaviour is worthless

**Lesson.** Provider representational limits must be declared up front rather than discovered at write
time, and `supportedAvailabilities` exists so a coercion is expected rather than read as drift.
**Learned from.** `providers/outlook/destination/provider.ts`; `operations.test.ts :: "does not churn when
a provider coerces unsupported OOO availability to busy"`.
**Honoured by.** `supports` drives selection in **both** directions and no capability value removes a
case — `delta: { kind: "none" }` takes the `noDelta` branch, under which no cursor may be minted and the
cursor cases assert exactly that instead of returning early. Every declared capability is read by a case:
`allDay` and `representableRange.allDayGrid` by `CONF-O45`, `.minimumSpanSeconds` and `.zeroDuration` by
`CONF-O28`, `.invertedRange` by `CONF-O29`, `throttleSignals` by `CONF-O46`, `quotaScope` by `CONF-L1`, and
the rest by the gates. The ungated set is derived from the gate table and surfaced on the report, and a
test drives selection with an adapter that refuses everything it can and asserts every declared case id is
still generated.
**Proved by.** `CONF-O29` in `conformance/tests/capabilities.test.ts`.

### CONF-I38. Every drop is counted, self-authored separately, and the counts are stable across polls

**Lesson.** Folding Keeper's own mirrors into `unrepresentable` made that counter permanently non-zero on
every mirrored calendar, destroying its value as an alarm. Counters must be per-run, not accumulating, and
must not churn between identical polls.
**Learned from.** commit `fdd9ba62` (#634); `core/sync-engine/ingest.ts` (`DiscardedSourceEventCounts`:
*"These counts are the only trace that removal leaves"*);
`ics-discard-telemetry.test.ts :: "reports a clean feed as having discarded nothing"`;
`ics-revision-collapse-telemetry.test.ts :: "keeps reporting the dropped occurrence on every later run
without churn"`.
**Honoured by.** `ListingDiagnostics` already separates `withheld`, `selfAuthored` and `unrepresentable`.
Three generated cases: a clean listing reports all-zero totals; a listing with one self-authored and one
unrepresentable event increments exactly one counter each; and the same input polled twice produces
identical diagnostics, including sample order.
**Proved by.** `CONF-O30` in `conformance/tests/diagnostics.test.ts`.

### CONF-I39. Identifier lists are a bounded sample beside an exact uncapped total

**Lesson.** An uncapped list pushed the wide event past what the log pipeline retains and took the counters
with it, losing the alarm entirely. Capped by both entry count and total bytes.
**Learned from.** `core/sync-engine/ingest.ts` (`WIDE_EVENT_LIST_LIMIT`, `WIDE_EVENT_LIST_MAX_LENGTH`);
`ingest-wide-event-list-bounds.test.ts`.
**Honoured by.** A case that seeds thousands of withheld events and one pathologically long identifier, and
asserts `BoundedSample.sample` is bounded in both entry count and total UTF-16 length while
`BoundedSample.total` is exact. A companion assertion checks every diagnostic value is a loggable scalar —
never an object, never `undefined`.
**Proved by.** `CONF-O31` in `conformance/tests/diagnostics.test.ts`.

### CONF-I40. A discarded event may be missing the identifier you would log it by

**Lesson.** Publishers strip DTSTART, or strip UID, before deleting.
**Learned from.** `ics-discard-telemetry.test.ts :: "counts an event the feed publisher stripped UID from
before deleting it"`.
**Honoured by.** `WithheldIdentity` already requires at least one of `uid` and `id`. The fixture corpus
includes an identity-less discard, and the case asserts it is still reported with reason `missingIdentity`
rather than dropped silently.
**Proved by.** `CONF-O32` in `conformance/tests/diagnostics.test.ts`.

### CONF-I41. A withheld identity must not cost the user its existing mirror

**Lesson.** An over-budget series was dropped from inserts but had to be kept from removals, and its
mirrors kept too, or a widened sync range mass-deletes the user's events and pushes the calendar into
permanent backoff.
**Learned from.** `core/sync-engine/ingest.ts` lines 247–257; `core/sync/operations.ts`
(`withheldSourceEventStateIds`); `operations.test.ts :: "keeps the mirrors of a series withheld for
exceeding the occurrence budget"`, *"still retires a withheld series' mapping once it falls outside the
requested window"*.
**Honoured by.** The withheld case is asserted on the **destination** side as well: a mirror whose source
identity was withheld this run must still exist afterwards, and must still be retired when it leaves the
window. It is called out separately because a listing-only assertion would have missed the production
incident.
**Proved by.** `CONF-O33` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I42. A cancelled event is not an absent event

**Lesson.** `STATUS:CANCELLED` is an input, never a filter; a cancelled master cancels its detached
overrides; Google carries `cancelledEventIds` separately from `changedEventIds`.
**Learned from.** `ics/utils/parse-ics-events.ts`; `parse-ics-events.test.ts :: "drops a cancelled master
and all of its detached overrides"`; `providers/google/source/utils/fetch-events.ts`.
**Honoured by.** `Removal` already distinguishes `deleted`, `cancelled` and `outOfScope`, and
`ProviderSeed` carries `cancelled` and `unattributableRemovals` so all three states can be produced. The
case seeds one identity the source keeps, one it reports as cancelled and one tombstone that names no
identity, then asserts the cancellation is removed **as a cancellation**, the kept identity is not removed,
the unnamed tombstone appears only as `outOfScope`, and that no `outOfScope` marker drives a derivable
removal. The negative control reports the cancellation as a plain deletion.
**Proved by.** `CONF-O34` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I43. An unsupported construct is withheld and counted, never approximated

**Lesson.** Silently treating THISANDFUTURE as a plain override changes the meaning of every subsequent
occurrence.
**Learned from.** `parse-ics-events.test.ts :: "reports THISANDFUTURE as unsupported instead of changing
its meaning"`.
**Honoured by.** The generic form: for every `RepresentabilityConstraint` the adapter's capabilities say it
cannot meet, the suite feeds an input violating it and asserts the result is `unrepresentable` with that
exact constraint — never a "best effort" representation. The negative control is a mutant adapter that
clamps instead of refusing.
**Proved by.** `CONF-O35` in `conformance/tests/capabilities.test.ts`.

### CONF-I44. An occurrence changing identity is a reassignment, not delete plus add

**Lesson.** Treating it as delete+add makes the destination flicker and can orphan the real event; the
reassignment must first prove the mirror is still ours.
**Learned from.** `core/sync/operations.ts` (`OccurrenceReassignment`); `operations.test.ts :: "recreates a
mapped event when the same event ID moves"`.
**Honoured by.** A case that writes a recurring series, lists it back and asserts the target it is about
to reassign is `ours` (or `indeterminate`, where the adapter declares no provenance channel), then moves the
series' anchor with a single conditional update. It asserts exactly one update, no delete, a precondition on
every write, and that the fingerprint changed — the anchor is part of identity, so a series moved to a new
`DTSTART` must not hash the same as the one it left (RFC 5545 §3.8.5.3).
**Proved by.** `CONF-O36` in `conformance/tests/writes.test.ts`.

### CONF-I45. A quiet calendar still advances its cursor

**Lesson.** With zero inserts and zero deletes, ingest still flushes when there is a new sync token, a
changed snapshot or new coverage — otherwise the cursor never advances and every poll refetches from the
same point forever.
**Learned from.** `core/sync-engine/ingest.ts` lines 344–366; `ingest.test.ts :: "flushes sync token even
when delta sync yields no event changes"`.
**Honoured by.** A case that polls an unchanged calendar under a delta cursor and asserts the returned
listing carries a `SyncCursor` different from the one supplied, while the write count is zero. "No work"
must not mean "no cursor write" — this is the exact counterweight to CONF-I9, and the pair is generated
together so neither can be satisfied by breaking the other.
**Proved by.** `CONF-O37` in `conformance/tests/cursor.test.ts`.

### CONF-I46. A delta item is a patch, not a snapshot

**Lesson.** Graph documents that updated instances carry the id plus *at least* the changed properties,
that the same entity can appear multiple times in one session, and that no ordering may be assumed.
**Learned from.** learn.microsoft.com/graph/delta-query-overview §Resource representation, §Replays.
**Honoured by.** A case in which the provider emits a delta item carrying only the id and one changed
field: the adapter must either fill the omitted fields from its own read or report the item as withheld —
it must never emit a `RemoteEvent` whose omitted fields are blanked, which the case detects by comparing
against the pre-delta content.
**Proved by.** `CONF-O38` in `conformance/tests/cursor.test.ts`.

### CONF-I47. Servers rewrite what you submit, so the written representation is not authoritative

**Lesson.** RFC 4791 §5.3.4 forbids returning a strong ETag when the stored bytes differ from the submitted
bytes, so the client must re-read rather than assume its local copy is authoritative. Google normalises
bodies likewise.
**Learned from.** RFC 4791 §5.3.4; the push-echo suites.
**Honoured by.** Every write outcome carries a `RemoteVersion`, and the reference deliberately rewrites
what it stores, so the submitted representation is never the stored one. `CONF-O39` proves the consequence
the caller must live with: a second write whose precondition was **not** taken from the provider's latest
answer — the version the previous write returned — is refused as a typed `conflict`, which is what forces
the re-read. The case is filed here rather than under `CONF-I14` because the lesson is about the
authority of the returned version, not about create idempotency.
**Proved by.** `CONF-O39` in `conformance/tests/writes.test.ts`.

### CONF-I48. There is no universal create-idempotency primitive, so it is declared vocabulary

**Lesson.** CalDAV mandates UID uniqueness within a collection and offers `If-None-Match: *`; Google has no
conditional insert at all and must go through `events.import` with an `iCalUID`.
**Learned from.** RFC 4791 §4.1 and §5.3.2; Google's version-resources guide (*"no support for conditional
modifications for insert"*) and the `events.import` reference.
**Honoured by.** `WriteIntent.create` requires both an `IdempotencyKey` and `precondition: { kind:
"absent" }`, so the guarantee is in the type regardless of vocabulary. `supports.precondition` selects
which mechanism the case exercises, and there is **no** value that removes the replayed-create case: an
adapter that cannot express a conditional insert must instead prove that the caller-supplied
`IdempotencyKey` deduplicates.
**Proved by.** shared with CONF-I14, which owns the replayed-create case in
`conformance/tests/writes.test.ts`; this entry adds no case of its own.

### CONF-I49. A cursor is opaque, and a cursor the adapter cannot read is `cursorLost`, never an empty delta

**Lesson.** Graph encodes `$select` and other query parameters inside the deltaLink, so reconstructing a
request from a token's parts changes its meaning. An empty delta on a bad cursor is the worst possible
answer: it reads as "nothing changed" and, to a snapshot-shaped consumer, as "everything was deleted".
**Learned from.** learn.microsoft.com/graph/delta-query-overview §State tokens; RFC 6578 §3.2.
**Honoured by.** The harness never parses `SyncCursor.value`. A case hands the adapter a cursor whose bytes
have been mutated and asserts `cursorLost` or a `cursorInvalid` failure — never a throw, and never an empty
`delta`. The suite asserts nothing about the cursor's format.
**Proved by.** `CONF-O40` in `conformance/tests/cursor.test.ts`.

### CONF-I50. Truncation and coverage are different claims, even where the RFC lets one token carry both

**Lesson.** RFC 6578 §3.6 says the `DAV:sync-token` returned with a truncated result *"MUST represent the
correct state for the partial set of changes returned"* — so a compliant CalDAV server hands back a
resumable token on a short page. That token is safe to page with and catastrophic to treat as coverage.
**Learned from.** RFC 6578 §3.6/§3.7 read against `ingest-truncation.test.ts :: "deletes every stored
source event when a fetch silently returns a subset"`.
**Honoured by.** The protocol splits the two: a truncated read is `kind: "partial"` carrying a
`Continuation` and structurally no `cursor` and no `coverage`. The case asserts a CalDAV-shaped adapter
surfaces the per-page token as a `Continuation` and never as a `SyncCursor` — resumability is preserved,
coverage is not claimed.
**Proved by.** `CONF-O41` in `conformance/tests/deletion-safety.test.ts`.

### CONF-I51. Timing fixtures are built on `setTimeout` and a fake clock, never `Bun.sleep`, never real time

**Lesson.** `Bun.sleep` is a native primitive `vi.useFakeTimers` cannot patch, so any test built on it burns
real wall time in CI. The repo has paid for this twice. `bun test` is also the wrong runner and produces
bogus *"vi.hoisted is not a function"* errors.
**Learned from.** commits `34dc5079` (#806) and `e39851df` (#808); `core/utils/backoff.ts`;
`packages/sync/src/sync-lock.ts`.
**Honoured by.** The package's `TestClock` is built on `setTimeout` only, the stall fixture is
`new Promise(() => {})` rather than a long timer, and every advance uses `vi.advanceTimersByTimeAsync` —
the synchronous variant does not flush microtasks between callbacks and deadlocks against awaited promises.
The hygiene test greps `src/` and `tests/` for the unfakeable primitive **and** drives a real sleep under
fake timers, asserting the timer is armed, that advancing fake time resolves it, and that the injected
clock moved by exactly the interval slept. The generated `CONF-L` cases run on **real** timers, because an
adapter's own suite will; their budgets are milliseconds, not seconds. The vitest config keeps a real
per-test timeout as a backstop so a genuine wedge fails fast instead of hanging CI.
**Proved by.** `conformance/tests/hygiene/no-bun-sleep.test.ts`.

### CONF-I52. `AbortSignal.timeout` is not patched by fake timers, so deadlines come from the injected clock

**Lesson.** vitest's fake timers do not mock `AbortSignal.timeout` or `node:timers/promises`; the root cause
is upstream in sinon fake-timers and the issue is still open.
**Learned from.** github.com/vitest-dev/vitest/issues/3088.
**Honoured by.** `OperationContext.deadline` is an `Instant` and `OperationContext.now` is a function, both
supplied by the suite; the suite constructs its own `AbortController` and fires it from a `setTimeout`.
Neither the suite nor the reference provider calls `AbortSignal.timeout`, and a hygiene test asserts that.
**Proved by.** `conformance/tests/hygiene/no-unpatchable-timers.test.ts`.

### CONF-I53. A wall-clock assertion measures the CI agent, not the algorithm

**Lesson.** The repo learned to assert on structure — call counts, ordering, emitted fields — and to test
timing attribution by injecting a clock rather than measuring.
**Learned from.** `phase-timing-clock.test.ts`; ledger `RECON-I83`.
**Honoured by.** The deadline obligation is phrased as *"rejected with a deadline failure after the deadline
elapsed on the fake clock"*, never *"completed within N real milliseconds"*. No case in this package reads
`performance.now()` or `Date.now()`; a hygiene test enforces it.
**Proved by.** `conformance/tests/hygiene/no-wall-clock.test.ts`.

### CONF-I54. Dependencies arrive as arguments, and the suite must detect an adapter that ignores them

**Lesson.** Every coordinator in the codebase takes its store as a parameter, which is precisely what makes
the lockup tests possible with stubs. An adapter that imports its own clock or `fetch` makes the deadline
and abort obligations pass **vacuously**, which is worse than not running them.
**Learned from.** `core/oauth/refresh-coordinator.ts`, `core/sync-engine/generation.ts`,
`packages/sync/src/sync-lock.ts`, `core/source/ingest-lock.ts`.
**Honoured by.** `create(environment)` receives the clock, the concurrency ceiling, the hash function, the
installation id and the transport stub, and `runConformance` takes the `describe`/`it` runner as an
argument rather than importing one. A dedicated **injection** case asserts the transport call count and the
clock read count both rose across one listing; an adapter that reached past its arguments fails that case
explicitly instead of quietly passing the whole lockup family vacuously. It is a case in the same generated
set rather than a hook that runs before each lockup case, so it is visible in the report and in the ledger
walk like every other guarantee.
**Proved by.** `CONF-L13` in `conformance/tests/injection.test.ts`.

### CONF-I55. The reference implementation must be adversarial about its own success

**Lesson.** The repo's convergence tests re-run the whole pipeline and assert a fixed point, and several are
named for it.
**Learned from.** the twelve `*convergence*` suites; `vfy-shaping-fixed-point.test.ts`.
**Honoured by.** The reference provider is exercised by a fixed-point case — list, apply, list, list,
assert the write log did not grow — and is run through the full suite **bare**, with a companion test
asserting the unmutated reference fails nothing at all. Each fixture is then asserted for the outcome it
exists to produce: `truncatingAfter(1)` must answer `partial`, `expiringCursorAfter(1)` must answer
`cursorLost` on the poll after the first, `conflictingOn(create)` must answer `conflict`, and
`stallingOn(write)` must settle at its deadline rather than never. Separately, every case ships a negative
control: a mutated reference provider that must fail exactly that case and no other.
**Proved by.** `conformance/tests/reference/fixed-point.test.ts`,
`conformance/tests/reference/negative-controls.test.ts`.

### CONF-I56. A failed run must not leak state into the run that follows it

**Lesson.** No phase time carried forward, no counters accumulated, no partially flushed checkpoint left
ambiguous.
**Learned from.** `phase-timing-failures.test.ts :: "keeps a failed run from leaking phase time into the
runs that follow it"`; `ingest.test.ts :: "checkpoints a successful chunk before a later chunk fails"`.
**Honoured by.** A case that fails mid-run against a provider instance and then runs again against the same
instance, asserting the second run converges and reports fresh per-run diagnostics rather than accumulated
ones.
**Proved by.** `CONF-O42` in `conformance/tests/diagnostics.test.ts`.

### CONF-I57. A conformance suite with a shared provider acquires order dependence

**Lesson.** Order dependence in a suite whose job is proving convergence is self-defeating.
**Learned from.** the repo's per-test factory pattern; the brief's `create` factory.
**Honoured by.** `create` is invoked **per case**, never per suite, and `ProviderUnderTest.dispose` runs in
`afterEach`. Case order is derived from the `as const` case-id list, so it is stable and inspectable, but no
case may depend on it.
**Proved by.** `conformance/tests/harness/per-case-isolation.test.ts`.

### CONF-I58. Provider differences belong in declared data, not in three copies of the same describe block

**Lesson.** `calendar-rediscovery-adapters.test.ts` is three near-identical describe blocks, one per
provider — parity written three times instead of once.
**Learned from.** `packages/calendar/tests/core/source/calendar-rediscovery-adapters.test.ts`.
**Honoured by.** This is the whole package: one `runConformance` call per adapter, one case list, capability
values selecting branches. The existing three-block test is the prototype, and retiring it is the
acceptance criterion for the package.
**Proved by.** n/a — this is the package's premise, not a case.

### CONF-I59. The invariant is the test name

**Lesson.** Nearly every hard-won invariant in the old code survives as prose above a boolean flag
(`isDeltaSync`, `unchanged`, `fullSyncRequired`, `comparable`), which is exactly why the same bug classes
recurred.
**Learned from.** `core/sync-engine/ingest.ts` (`FetchEventsResult`: nine optional flags and four comment
blocks).
**Honoured by.** Every generated case's title is the invariant, prefixed with its `CONF-O`/`CONF-L` id and
cross-referenced to its ledger entry in `src/case-id.ts`, so the ledger can be walked against the suite by
grep — the mechanical walk `RECON-I84` added for sync-reconcile.
**Proved by.** `conformance/tests/hygiene/ledger-citations.test.ts`.

### CONF-I60. A non-IANA zone identifier must never reach a canonical event

**Lesson.** Windows/CLDR identifiers must be mapped from the full CLDR table and `tzone://Microsoft/Custom`
TZIDs resolved from their declared VTIMEZONE offsets or refused — never guessed — and a Windows id must
never leak out as `startTimeZone`.
**Learned from.** commits `ac6fa18c` (#244) and `7c276d8e` (#242);
`outlook-windows-timezone.test.ts :: "does not return Windows timezone ID as startTimeZone"`.
**Honoured by.** Zone **resolution** belongs to sync-ical (ICAL-I17), but one negative assertion is cheap
and it caught a real production bug: every `ZoneId` an adapter returns on a `RemoteEvent` must be accepted
by `Intl.DateTimeFormat` as an IANA identifier, or the write must fail with constraint `zoneIdentifier`.
**Proved by.** `CONF-O43` in `conformance/tests/capabilities.test.ts`.

---

## Not applicable

### CONF-I61. RFC 5545 nominal versus exact DURATION

Weeks and days are applied in wall time (a DST day is 23 or 25 hours); hours, minutes and seconds are
absolute. **Not applicable.** This is `ICAL-I23` and `RECON-I57`. sync-conformance computes no durations. It
applies only indirectly: a fixture that needs a DST-crossing recurring event must take its expected values
from `@keeper.sh/sync-ical`, never recompute them here.

### CONF-I62. All-day events as a pair of UTC midnights on the UTC day grid

Interpreted all-day events are anchored to the UTC midnight of their local calendar day, and re-anchoring
must move the whole recurrence identity set together. **Not applicable** as arithmetic — that is entry 44 /
`ICAL-I26` / `ICAL-I27`. The one transferable half **is** adopted, as `CONF-I80`: `supports.allDay` decides
which shape the suite feeds the adapter, and `CONF-O45` asserts the adapter never silently converts between
them.

### CONF-I63. VTIMEZONE synthesis

Validate-then-emit, no perpetual annual rule for zones whose transitions move, southern-hemisphere direction
preserved, whole-minute offsets, an old event must not truncate the rules current events need.
**Not applicable.** `ICAL-I30`/`I31`/`I22`. Recorded so its absence is a decision, not an oversight.

### CONF-I64. Wall-time resolution: normal, gap, fold

A gap time shifts forward by the transition, a fold takes the earlier instant, and the second pass of a
fall-back hour must be written in UTC. **Not applicable.** `ICAL-I20`/`I32`. Conformance fixtures use UTC
instants only, so no case here depends on a fold or gap decision. **Fixtures must not sit on a DST
boundary** — that is a rule on the fixture corpus, and it is why this entry exists rather than being absent.

### CONF-I65. Property-level lenient parsing

Bare 8-digit dates are rewritten to declare `VALUE=DATE` only when they are real calendar dates, only for
date-typed properties, only when no parameters are declared, and mixed lists are rejected wholesale.
**Not applicable.** `ICAL-I16`. The transferable rule is that any fixture that emits a malformed feed must
be byte-exact, so a repair regression is visible rather than absorbed.

### CONF-I66. TZID applies to every value on a property

A mixed multi-value EXDATE must be split across two property lines; `X-WR-TIMEZONE` never overrides an
explicit TZID. **Not applicable.** `ICAL-I28`/`I29`. Relevant here only as a source of realistic fixture
content.

### CONF-I67. Recurrence expansion budgets

The occurrence-budget arithmetic belongs elsewhere. **Not applicable** as arithmetic; its *consequence* — a
withheld series must not lose its mirror — is adopted as `CONF-I41`.

### CONF-I68. Exhaustive wall-time sweeps

Every transition since 1925 across every zone. **Not applicable** as subject matter; sync-conformance
asserts on instants, never on wall times. The **methodology** is adopted: prefer a generated sweep to a
handful of hand-picked examples, which is what the window-boundary sweep (`CONF-I35`) and the
property-based invariants (`CONF-I70`) do.

---

## Dependencies and process

### CONF-I69. Zero runtime dependencies

`package.json` declares one dependency, `@keeper.sh/sync-protocol` (workspace, source-consumed), and nothing
else. Everything this package needs — a canonical encoder, a clock, a hash seam, an in-memory store — is
under a hundred lines each and is code we must own, because it is the thing being tested.

### CONF-I70. `@fast-check/vitest` is the one proposed dev dependency

Proposed for exactly three invariants: canonicalisation (permuted key order and equivalent absent-value
spellings produce identical canonical bytes), convergence (`apply(apply(x)) === apply(x)`), and a
model-based command sequence over create/update/delete/list asserting no lost update. Official vitest 4.x
support starts at `0.2.3`. **Not taken in this pass**: the package ships zero dev dependencies beyond
vitest and the shared config, and each of the three invariants is currently asserted by a named case
(`CONF-O21`, `CONF-O9`, `CONF-O44`) whose failure message says what broke. Confined to invariants if it
is ever taken: property tests give worse failure messages and non-obvious shrink output, and **the named
example cases are the specification** (`CONF-I59`). The suite must not become property-based.

### CONF-I71. Rejected: `ical.js`, `ts-ics`, `rrule`, `tsdav`

They belong to `@keeper.sh/sync-ical` and `@keeper.sh/calendar`. Pulling any of them in would drag timezone
resolution into the conformance layer and re-litigate settled ICS learnings in a package that has no
business owning them.

### CONF-I72. Rejected: `temporal-polyfill` / `@js-temporal/polyfill`

Temporal is Stage 4 and ships natively in current Firefox, Chrome and Node, but Safari is still flagged and
the polyfills cost 35–50KB. Decisively: this package needs instants only, and the protocol already models
them as `Instant`. A second time model in a package that does no wall-time arithmetic buys nothing. Revisit
only if `@keeper.sh/sync-ical` migrates first.

### CONF-I73. Rejected: `fast-json-stable-stringify` and any canonicalisation package

We canonicalise only our own protocol objects, which are I-JSON by construction: no bigints, no `NaN`, no
unpaired surrogates, integers only. The hard eighty percent of RFC 8785 is ECMAScript number serialisation
we do not need. Roughly forty lines, owned here, with an explicit test for the sorting rule — UTF-16
code-unit order, **not** `localeCompare` — including astral-plane and combining-mark keys.

### CONF-I74. Rejected: an off-the-shelf conformance framework

The MCP and Connect conformance suites are process-level harnesses driving out-of-process implementations
over a wire protocol. Our adapters are in-process TypeScript functions, so an exported `runConformance` that
calls `describe`/`it` is simpler and gives adapters native vitest reporting, watch mode and turbo caching
for free. We own the reporting; that is a few dozen lines.

### CONF-I75. `Bun.CryptoHasher` is used, but injected

Native, synchronous, no import ceremony — and it is what `runConformance` injects by default, as
`environment.hash: (input: string) => string`, per the no-module-level-dependencies rule.
`RunConformanceOptions.hash` overrides it so a suite can substitute a collision-forcing hasher and prove the
conflict path actually fires rather than being unreachable. A hasher that collides on equal-length inputs is
not a seam by accident: fingerprints feed `matchesFingerprint` preconditions, so a collision would make a
stale precondition compare equal. The package's own harness therefore hashes with `Bun.CryptoHasher` too and
keeps the colliding one as an explicit, named seam.

### CONF-I76. vitest stays; `bun test` is not adopted

Bun 1.3 has landed `vi.useFakeTimers` compatibility, which makes the switch newly tempting. The repo is on
vitest 4.1.4 with turbo caching per package, and a runner split would fragment fixtures. Revisit only if
Bun's coverage and vitest 4 API parity are complete across every package at once. The package script stays
`bun x --bun vitest run`.

### CONF-I77. `supports` selects a branch; it never removes a guarantee

The brief's flat capability record is the one thing worth challenging, and this is the resolution: no
capability value deletes a case. Create idempotency has no `none` branch; `deletionAuthority` has two
branches and both are generated; `provenanceChannel: "none"` gets the indeterminate-provenance case rather
than no case; `delta: { kind: "none" }` gets the `noDelta` branch. `CaseGate` has exactly two shapes,
`ungated` and `branch` — the `skip` shape was **deleted**, so a future gate cannot quietly drop a case, and
`ConformanceReport` no longer carries a `skipped` list nobody could fill or a `notAttempted` list nothing
could populate. The gate table is one `as const` record, so the gated ids and the branch selection cannot
drift apart, and the ungated list is derived from it and surfaced on the report.

### CONF-I78. Every case ships a negative control

A conformance case nobody has watched fail is an assertion, not a test. Each `CONF-O`/`CONF-L` id has a
matching mutant of the reference provider in `conformance/tests/reference/negative-controls.test.ts`, and
the control asserts the mutant fails **that** case — a mutant that fails three cases is over-broad, and a
mutant that fails none is a hole in the suite.

---

## Added after review

### CONF-I79. Two writers holding one precondition must not both win

**Lesson.** The mirror now writes back to real calendars, and two ticks can overlap: a scheduled sync and a
push-triggered one both read the same version and both write. If the provider decides against the version it
read and commits after the other has already committed, the second write silently reverts the first — an
overwrite nobody can see in the write log, because both entries say `updated`.
**Learned from.** the adversarial review of this package's first implementation pass, which found the brief's
explicit obligation *"two concurrent writers cannot clobber each other without one seeing a conflict"*
unexercised: `CONF-O39` covered only the sequential replay, and the only `concurrently` helper fanned out
`listChanges`, never `write`.
**Honoured by.** `CONF-O44` issues two updates carrying the same `matchesVersion` precondition without
awaiting the first, and insists exactly one answers `updated` while the other is a typed conflict that did
not overwrite, with the calendar left holding exactly one applied write. The negative control is a reference
that yields between deciding a write and committing it, which is precisely the read-modify-write window a
provider with an await in the middle would open.
**Proved by.** `CONF-O44` in `conformance/tests/writes.test.ts`.

### CONF-I80. An all-day event must never be silently converted between representations

**Lesson.** `dateOnly` and `utcMidnightPair` are both legitimate; converting between them without being asked
moves every all-day event by up to a day, in whichever direction the destination's grid disagrees.
**Learned from.** `ICAL-I26`/`ICAL-I27` and entry 44 (`interpret-full-day-timed-events`, `build-zoned-date`),
read against `supports.allDay`, which was declared by every adapter and consulted by nothing.
**Honoured by.** `CONF-O45` writes an all-day event in the representation the adapter declared, lists it back,
and asserts the returned `EventTime.kind` is the one submitted and that a `utcDay` grid really lands on UTC
midnights. The negative control converts `allDay` to a midnight pair on the way out.
**Proved by.** `CONF-O45` in `conformance/tests/capabilities.test.ts`.

### CONF-I81. A declared throttle signal is a promise about classification

**Lesson.** Backoff decisions are made from a status, and a status the adapter did not declare must not be
backed off as a throttle — that is how a permanent failure becomes an infinite polite retry, and how a real
throttle becomes a hard failure.
**Learned from.** `CONF-I30` (classify by discriminant, never by message text) read against
`supports.throttleSignals`, which was declared and consulted by nothing.
**Honoured by.** `TransportBehaviour` carries a `status` shape, and `CONF-O46` drives every signal the adapter
declared, asserting each is classified `rateLimited` and that `retryAfter` is present exactly when the
declaration promised it, then drives an undeclared status and asserts it is **not** classified as a throttle.
The negative control ignores the declaration.
**Proved by.** `CONF-O46` in `conformance/tests/capabilities.test.ts`.

### CONF-I82. "No work" means no write, never no read

**Lesson.** An unchanged feed must still be re-read and re-validated: the ICS adapter reparses byte-identical
snapshot content on purpose, because that is how a stored row that fails validation is recovered. An adapter
that short-circuits on an unchanged ETag satisfies the convergence lesson and defeats the recovery one.
**Learned from.** `fetch-adapter.test.ts :: "reparses unchanged snapshot content so stored-state validation
can recover"` (`ICAL-I38`), read against `CONF-I9` and `CONF-I12`, which were in tension and said so nowhere.
**Honoured by.** `CONF-I9`'s convergence claim is now phrased as a count of **writes**, and `CONF-O12` polls
a feed byte-identical to the previous poll while a known row is corrupt, asserting the second poll still
demands a resync rather than short-circuiting past the row it has to recover.
**Proved by.** the corrupt-known-row case in `conformance/tests/deletion-safety.test.ts`, which this entry
shares with `CONF-I12`; it adds no case of its own.

---

## Module map

```
src/index.ts                     the public surface and nothing else
src/violation.ts                 ConformanceViolation — the suite's own typed failure
src/case-id.ts                   conformanceCaseIds as const, ConformanceCaseId, ledger cross-reference
src/options.ts                   RunConformanceOptions, ConformanceEnvironment, ProviderUnderTest
src/report.ts                    ConformanceReport, SelectedCase, SkippedCase, ungatedCaseIds
src/clock.ts                     TestClock — setTimeout only, injected, never Bun.sleep
src/canonical.ts                 RFC 8785 key ordering; the one deep-comparison encoder
src/registry/case.ts             ConformanceCase: id, title, ledger, gate, run
src/registry/gates.ts            capability -> branch selection; never case removal
src/single-flight.ts             the coalescing slot: released on every settlement, abandonable
src/deadline.ts                  raceDeadline — the one place an await is given a ceiling
src/transport.ts                 the injected transport stub and its typed failures
src/environment.ts               createConformanceEnvironment: clock, concurrency, hash, transport
src/limits.ts                    the suite's declared ceilings, handed to the adapter where they bind
src/registry/suite.ts            assembles the ordered case list from the case families
src/cases/deletion-safety.ts     truncation, cursorLost, coverage, withheld, cancelled, empty-vs-failed
src/cases/cursor.ts              advancement, clearing, opacity, scope binding, supersession, patches
src/cases/writes.ts              precondition required, conflict, replayed create, replace, reassignment
src/cases/provenance.ts          own-event round trip, foreign canary, indeterminate
src/cases/window.ts              boundary sweep, degenerate ranges, storage versus mirror bounds
src/cases/capabilities.ts        declared refusals actually refuse; zone identifier
src/cases/diagnostics.ts         bounded samples, zeros, idempotence, no content leakage
src/cases/convergence.ts         second-poll no-op, order permutation, dedupe, canonicalisation
src/cases/hostile-content.ts     failure classification is immune to event content
src/cases/lockups.ts             deadline, abort, ceiling, lease, single-flight, fan-out, concurrency
src/cases/injection.ts           the anti-vacuity case: the injected seams were actually used
src/cases/isolation.ts           one bad item does not stall the feed
src/cases/intents.ts             the write intents the cases submit
src/assertions/no-removal.ts     assertNoRemovalDerivable — the one deletion-safety predicate
src/assertions/listing.ts        listing kind, coverage and cursor assertions
src/assertions/outcome.ts        write-outcome assertions
src/reference/capabilities.ts    the reference provider's declared Capabilities
src/reference/store.ts           in-memory calendars, versions, tombstones, write log
src/reference/cursor.ts          opaque cursor mint and verify, scope-bound, generation log
src/reference/normalize.ts       representability refusals and the deliberate provider-side rewrite
src/reference/fingerprint.ts     canonical encoding fed to the injected hash
src/reference/provider.ts        createReferenceProvider(environment) -> ProviderUnderTest
src/fixtures/decorate.ts         ProviderDecorator and composition
src/fixtures/truncate-page.ts    truncatingAfter(n)
src/fixtures/expire-cursor.ts    expiringCursorAfter(n)
src/fixtures/conflict.ts         conflictingOn(predicate)
src/fixtures/stall.ts            stallingOn(predicate) — new Promise(() => {})
src/fixtures/index.ts            the fixture surface
src/run-conformance.ts           runConformance: gate, register, report
```

## Public API

```ts
const runConformance: <Provider extends ProviderId>(
  runner: SuiteRunner,
  options: RunConformanceOptions<Provider>,
) => ConformanceReport

interface SuiteRunner {
  readonly describe: (name: string, body: () => void) => void
  readonly it: (name: string, body: () => Promise<void>) => void
}

interface RunConformanceOptions<Provider extends ProviderId> {
  readonly name: string
  readonly supports: Capabilities<Provider>
  readonly create: CreateProvider<Provider>
  readonly withinWindow: WindowMembership
  readonly hash?: (input: string) => string
}

type CreateProvider<Provider extends ProviderId> = (
  environment: ConformanceEnvironment,
) => Promise<ProviderUnderTest<Provider>>

interface ProviderUnderTest<Provider extends ProviderId> {
  readonly contract: ProviderContract<Provider>
  readonly seed: (seed: ProviderSeed) => Promise<void>
  readonly inspect: () => Promise<ProviderInspection>
  readonly dispose: () => Promise<void>
}

interface ConformanceEnvironment {
  readonly clock: TestClock
  readonly concurrency: number
  readonly hash: (input: string) => string
  readonly installation: InstallationId
  readonly transport: TransportStub
}

interface TestClock {
  readonly now: () => Instant
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly advance: (milliseconds: number) => Promise<void>
}

interface TransportStub {
  readonly callCount: () => number
  readonly inFlightPeak: () => number
  readonly stall: () => void
  readonly resume: () => void
}

interface ProviderInspection {
  readonly objects: readonly RemoteEvent[]
  readonly writeLog: readonly WriteLogEntry[]
}

interface ConformanceReport {
  readonly name: string
  readonly selected: readonly SelectedCase[]
  readonly ungated: readonly ConformanceCaseId[]
}

interface ProviderSeed {
  readonly events: readonly RemoteEvent[]
  readonly corruptKnownRows: readonly string[]
  readonly cancelled: readonly EventUid[]
  readonly unattributableRemovals: readonly RemoteEventId[]
}
```

`runConformance` takes the runner as its first argument — `runConformance({ describe, it }, options)` — so
the one dependency this package would otherwise import into the module that uses it arrives as an argument
like every other (`CONF-I54`). `RunConformanceOptions.hash` is optional and defaults to `Bun.CryptoHasher`
(`CONF-I75`); `ConformanceEnvironment.concurrency` is the ceiling `CONF-L11` holds the adapter to, so the
number is declared to the adapter rather than kept private to the suite.

## Test index

`CONF-O1`–`CONF-O46` are the overwrite family; `CONF-L1`–`CONF-L13` are the lockup family. Each id appears
verbatim in its generated case title and in `src/case-id.ts` beside the ledger entry it enforces, and
`tests/hygiene/ledger-citations.test.ts` fails if the three ever disagree.

# sync-google learnings ledger

`@keeper.sh/sync-google` is the Google Calendar implementation of `CalendarProvider` from
`@keeper.sh/sync-protocol`. Its acceptance criterion is `@keeper.sh/sync-conformance` run end to end:
`CONF-O1`–`CONF-O46` and `CONF-L1`–`CONF-L13`. A case this adapter cannot pass is a defect in this
adapter until proven otherwise.

Entries are numbered `GOOG-I1`–`GOOG-I71`. `GOOG-I1`–`GOOG-I50` and `GOOG-I68`–`GOOG-I71` are adopted
(the last four were added in the red phase, when the push and hygiene lessons turned out to have modules
and tests but no numbered entry), `GOOG-I51`–`GOOG-I58` are the explicit not-applicable set, and
`GOOG-I59`–`GOOG-I67` are dependencies taken and rejected. Every
**Proved by** citation names a file under `packages/sync-kit/google/tests` and the exact test name inside
it, or a `CONF-` case id that the conformance run enforces, so the ledger can be walked against the suite
mechanically.

The single most important sentence in this ledger: **Google's own sync guide instructs clients to wipe
their store on a 410, and doing what it says is what deletes users' calendars.**

---

## Adopted

### GOOG-I1. A 410 on a listing is `cursorLost`, never an empty delta

**Lesson.** Google's sync guide says that on HTTP 410 the client should "wipe the client's data store
completely, then execute a new full sync". Following it is the single most destructive thing this adapter
could do: an invalidated cursor says nothing about what still exists, and treating the invalidated response
as an authoritative empty listing removes every mirrored event.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/sync` (verified 2026-08-16:
*"the server responds with an HTTP 410 … wipe … and execute a new full sync"*);
`packages/calendar/src/providers/google/source/utils/fetch-events.ts` (`GONE_STATUS ->
{events: [], fullSyncRequired: true}`); `core/sync-engine/ingest.ts:273`
(`flush({inserts: [], deletes: [], syncToken: null})`); test *"clears sync token and returns empty result
when fullSyncRequired is true"*.
**Honoured by.** `classifyGoogleError` maps `(410, "fullSyncRequired")` on `listChanges` to
`{ kind: "cursorLost" }`, and `src/listing/list-changes.ts` answers with the protocol's `cursorLost` arm.
That arm declares `events?: never`, `removals?: never` and `cursor?: never`, so a deletion is not
expressible on it — the guard is type-level, not a runtime check. The adapter has no code path that
constructs `{ kind: "delta", removals: [] }` from a 410.
**Proved by.** `google/tests/cursor/gone-is-not-empty.test.ts :: GOOG-O1: a 410 on the first page yields
cursorLost, zero removals and no cursor`; conformance `CONF-O10`, `CONF-O40`.

### GOOG-I2. A page-level 410 aborts the whole listing, not just that page

**Lesson.** A 410 arriving on page 7 of a paginated delta invalidates everything already collected.
Returning the six good pages plus a fresh token persists a cursor that skips the changes the invalidated
pages held — a silent, permanent hole in the mirror.
**Learned from.** `packages/calendar/src/providers/google/source/utils/fetch-events.ts` (both the
first-page and the `while`-loop `if (result.fullSyncRequired) return`).
**Honoured by.** `src/listing/paginate.ts` returns a `PageWalk` union; `{ kind: "cursorLost" }` is terminal
and discards the accumulator rather than merging it. There is no branch that folds partially collected
pages into a `delta`.
**Proved by.** `google/tests/cursor/gone-mid-pagination.test.ts :: GOOG-O2: a 410 on the third page
discards the two pages already collected`.

### GOOG-I3. A delta that ends without a `nextSyncToken` is cursor loss, not success

**Lesson.** `if (!result.nextSyncToken) return { fullSyncRequired: true }`. Persisting a null token
silently downgrades every future run to a full sync while the code believes it is doing deltas, or keeps
re-using the previous token forever.
**Learned from.** `packages/calendar/src/providers/google/source/fetch-adapter.ts:52-54`.
**Honoured by.** The protocol's `delta` arm carries a non-optional `cursor: SyncCursor`, so "delta without
a cursor" is unrepresentable. A final page with no `nextSyncToken` is mapped to `cursorLost`.
**Proved by.** `google/tests/cursor/missing-token.test.ts :: GOOG-O3: a final page with no nextSyncToken
is cursorLost, not a delta`.

### GOOG-I4. `nextSyncToken` arrives only on the last page, so an interrupted pagination has no cursor

**Lesson.** Google documents that "the `nextSyncToken` field is present only on the very last page". RFC
6578 §3.6/§3.8 states the same rule for WebDAV sync: a truncated `sync-collection` returns a token that
"MUST represent the correct state for the partial set of changes returned". A pagination that stops early
therefore has observations but no coverage claim and no cursor.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/sync` (verified 2026-08-16);
`https://www.rfc-editor.org/rfc/rfc6578.html` §3.6, §3.8.
**Honoured by.** Stopping early yields the protocol's `partial` arm: events observed so far, a
`Continuation` (never a `SyncCursor`), and structurally no `removals` and no `coverage`.
**Proved by.** `google/tests/cursor/truncation-is-partial.test.ts :: GOOG-O4: a page ceiling stop yields a
continuation and no cursor`; conformance `CONF-O41`, `CONF-O1`.

### GOOG-I5. The cursor is an owned opaque value that fingerprints the request shape

**Lesson.** `syncToken` is mutually exclusive with `iCalUID`, `orderBy`, `privateExtendedProperty`, `q`,
`sharedExtendedProperty`, `timeMin`, `timeMax` and `updatedMin`, and every request in a sync session must
carry an identical parameter set or Google answers 400. Widening the sync window therefore cannot be done
by changing `timeMin` on an incremental call: it either silently is not applied or 400s.
**Learned from.** `https://developers.google.com/workspace/calendar/api/v3/reference/events/list`;
the repo's own answer in `packages/calendar/src/core/oauth/sync-token.ts`
(`keeper:sync-token:<version>:<base64url>`) and `tests/core/oauth/sync-token.test.ts` *"expires provider
tokens when the absolute sync window advances"*.
**Honoured by.** `src/cursor/cursor.ts` mints `SyncCursor.value` as an encoding of
`{ version, listingMode, windowFingerprint, providerToken }`. `src/cursor/fingerprint.ts` derives the
fingerprint from the exact parameter set that minted it. A cursor whose fingerprint does not match the
current request resolves to `cursorLost` **locally, before any network call** — a deliberate,
non-destructive re-baseline instead of a runtime 400.
**Proved by.** `google/tests/cursor/scope-binding.test.ts :: GOOG-O5: a cursor minted under a narrow window
is refused against a wider one without touching the transport`; conformance `CONF-O11`.

### GOOG-I6. A voluntary cursor invalidation is still `cursorLost`, never a deletion

**Lesson.** Sync tokens are stored versioned, and the version encodes the sync-window version plus a
deterministic per-calendar staggered refresh period, so widening the window invalidates every token and a
fleet does not re-baseline in the same minute. That invalidation is a decision we make, not an error — and
it must land on exactly the same non-destructive path as a provider 410.
**Learned from.** `packages/calendar/src/core/oauth/sync-token.ts`,
`core/oauth/sync-window.ts` (`getDeterministicRefreshOffset`); commits `5b87e77b`, `fd2f5b12`,
*"stagger OAuth full-sync refreshes"* in `1c5171d2`.
**Honoured by.** `cursorVersion` is an `as const` value in `src/cursor/cursor.ts`; a version mismatch takes
the identical `cursorLost` return as GOOG-I1. There is one function that produces `cursorLost` and every
reason funnels through it.
**Proved by.** `google/tests/cursor/version-bump.test.ts :: GOOG-O6: a cursor from an older adapter version
is cursorLost and emits no removals`.

### GOOG-I7. An unreadable cursor is answered, never thrown

**Lesson.** A cursor value the adapter cannot decode is not an exception; it is a resync demand. Throwing
turns a recoverable state into a stalled calendar.
**Learned from.** `packages/calendar/src/core/oauth/sync-token.ts` (unprefixed legacy values decode as
version 0 rather than throwing); conformance `CONF-O40`.
**Honoured by.** `parseCursor` returns `{ kind: "usable" } | { kind: "unreadable" }`; the unreadable arm
returns `cursorLost`. No `throw` on the cursor path.
**Proved by.** `google/tests/cursor/tampered.test.ts :: GOOG-O7: a tampered cursor is cursorLost, not a
thrown error`; conformance `CONF-O40`.

### GOOG-I8. A quiet poll still advances the cursor, and writes nothing

**Lesson.** A delta that finds no changes still returns a fresh `nextSyncToken`. Handing back the cursor we
were given means the feed never moves on and every later poll re-reads the same frontier.
**Learned from.** Conformance `CONF-O37`.
**Honoured by.** `src/listing/list-changes.ts` always mints its cursor from the provider's final
`nextSyncToken`, never from `request.resume`.
**Proved by.** conformance `CONF-O37`; `google/tests/cursor/quiet-poll.test.ts :: GOOG-O8: a poll that
finds nothing mints a new cursor and issues no write`.

### GOOG-I9. A run that did not complete never advances the frontier

**Lesson.** A transport failure part way through must leave the caller holding the cursor it started with,
or the changes the failed run never delivered are skipped forever.
**Learned from.** Commit `0184ea19` *fix(ics): don't wipe existing events when remote fetch fails (#383)*;
conformance `CONF-O24`.
**Honoured by.** The cursor is minted only on the success path of the last page. Every failure returns
`Result.ok === false`, which carries no cursor at all.
**Proved by.** conformance `CONF-O24`.

### GOOG-I10. Deletions are only the identities Google explicitly named

**Lesson.** Removals are computed from `status: "cancelled"` entries, never from absence. Absence in a
delta page means "unchanged"; inferring deletion from it deletes the entire calendar on the first quiet
delta.
**Learned from.** `packages/calendar/src/core/source/event-diff.ts:230-265`
(`buildSourceEventStateIdsToRemove` delta branch); commit `d079c15c` *"remove stale event states after
delta moves"*.
**Honoured by.** The `delta` arm's `removals` are built only from decoded `{ kind: "cancelled" }` items.
`deletionAuthority: "snapshotAbsence"` applies only to the `snapshot` arm, where `timeMin`/`timeMax` prove
the window that was read.
**Proved by.** conformance `CONF-O13`, `CONF-O34`; `google/tests/listing/delta-absence.test.ts ::
GOOG-O10: a delta naming one cancellation removes exactly one of a hundred stored identities`.

### GOOG-I11. A changed identity that no longer intersects the window is a removal, not a silent drop

**Lesson.** An event the user moved to next year stays mirrored forever at its old time if a delta item we
filter out is simply dropped. This is the one legitimate delete-from-a-changed-id path — and it is not a
`deleted`, because the source still holds the event.
**Learned from.** `packages/calendar/src/core/source/event-diff.ts:258-262`; commit `d079c15c`.
**Honoured by.** The protocol's third removal arm, `{ kind: "outOfScope", id }`, carries no `uid` and is
never treated as an authoritative deletion by `sync-reconcile`. `src/listing/list-changes.ts` emits it for
a changed id whose decoded item falls outside `withinGoogleWindow`.
**Proved by.** `google/tests/listing/moved-out-of-window.test.ts :: GOOG-O11: an event moved past the
window edge is reported outOfScope, never deleted`; conformance `CONF-O34`, `CONF-O26`.

### GOOG-I12. `cancelled` is distinct from absent and from unparseable

**Lesson.** Google guarantees that a cancelled exception of a live recurring event carries **only** `id`,
`recurringEventId` and `originalStartTime`. Folding cancellations into the ordinary item stream sends a
three-field tombstone to the field parser, which reports it as an event with no start or end and counts it
as "unrepresentable" — losing the deletion and inflating the breakage counter at the same time.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/recurringevents`; generated
SDK doc comment `calendar/v3.ts:820`;
`packages/calendar/src/providers/google/source/utils/fetch-events.ts` (`collectEvents` skips id-less
cancelled events; `cancelledEventIds` built separately).
**Honoured by.** `src/decode/decode-event.ts` returns a discriminated union
`{ kind: "cancelled" } | { kind: "patch" } | { kind: "undecodable" }`, switched exhaustively with
`assertNever`. A cancelled tombstone never reaches `src/decode/event-time.ts`.
**Proved by.** `google/tests/decode/cancelled-tombstone.test.ts :: GOOG-O12: a three-field cancelled
exception is a tombstone, not an unrepresentable event`; conformance `CONF-O34`.

### GOOG-I13. A cancelled entry with no id is dropped and counted, never guessed at

**Lesson.** A tombstone with no identity names nothing to delete. Passing it on as a removal with a
fabricated id is an unattributable deletion.
**Learned from.** `fetch-events.ts` (`collectEvents` skips id-less cancelled events).
**Honoured by.** The decoder returns `{ kind: "undecodable", reason: "missingIdentity" }`, which lands in
`diagnostics.withheld` and never in `removals`.
**Proved by.** `google/tests/decode/idless-tombstone.test.ts :: GOOG-O13: an id-less cancellation is
counted, not removed`; conformance `CONF-O13`, `CONF-O32`.

### GOOG-I14. A withheld event is present, not absent

**Lesson.** An event we cannot build must not vanish from the listing, because the layer above reads
absence-within-coverage as deletion. Withholding a source must never cost the user the mirror they already
have.
**Learned from.** `packages/calendar/src/core/sync-engine/ingest.ts:246-258` and `:322-330` (both surviving
comments); commit `fdd9ba62` *"never deletes the stored row of the event it withholds"*.
**Honoured by.** `withheld: readonly WithheldEvent[]` rides the `snapshot` and `delta` arms beside
`events`, and `sync-reconcile` counts a withheld identity as present. Withholding is a third outcome
beside upsert and remove, not a filter.
**Proved by.** conformance `CONF-O5`, `CONF-O33`, `CONF-O7`.

### GOOG-I15. Stored state that fails to parse forces a resync, not a deletion

**Lesson.** Invalid stored state is a bug, not normal operation, and on a delta sync the diff cannot be
trusted against rows it cannot read. Silently coercing an invalid stored recurrence rule degrades a
recurring event into a one-off — the exact bug the validation was added to fix.
**Learned from.** `packages/calendar/src/core/sync-engine/ingest.ts:297-303`; commit `71ac9ee1` *"throw on
invalid stored ICS recurrence/exception data"*; user memory *fail loud on internally-produced data*.
**Honoured by.** Cursor state is parsed through `parseCursor`; a failure escalates to `cursorLost`, never
to a deletion and never to a silent default. Data Google produced is tolerated; data we produced fails
loud.
**Proved by.** conformance `CONF-O12`.

### GOOG-I16. Proven coverage is clamped and never substituted by the requested window

**Lesson.** A caller may ask for a decade. The adapter reads what it reads. Claiming coverage it never
proved lets the layer above derive deletions across years it never looked at.
**Learned from.** Conformance `CONF-O4`; `packages/calendar/src/core/oauth/sync-window.ts`.
**Honoured by.** `src/listing/coverage.ts` exports `provenCoverage(window)`, clamping to
`maximumCoverageMs` (366 days) and returning a degenerate window when the request is inverted. The
`CoverageWindow` names the calendar it was proven for, so two calendars' listings cannot be crossed.
**Proved by.** conformance `CONF-O4`; `google/tests/listing/coverage-clamp.test.ts :: GOOG-O16: a decade
request proves at most one year of coverage`.

### GOOG-I17. One window predicate, exported, and degenerate ranges judged by the instant they name

**Lesson.** A half-open window predicate silently drops degenerate ranges: a zero-duration event exactly on
`timeMin` produced no operation on any run, and an inverted range whose start is inside the window was
judged by its end and dropped. The same predicate had been paraphrased in at least eight places, each
diverging. A range that does not end after it starts must be judged by the single instant it names.
**Learned from.** `packages/calendar/src/core/events/time-range.ts` (`overlapsTimeWindow`); commit
`b057d2e0`; `tests/core/sync-engine/degenerate-range-*.test.ts`; test *"admits every degenerate event whose
instant lies inside the sync window"*.
**Honoured by.** `src/window/membership.ts` exports exactly one `withinGoogleWindow: WindowMembership`, and
it is the value handed to `runConformance` as `withinWindow`. A second copy is the defect; a hygiene test
enforces that no other module re-derives it.
**Proved by.** `google/tests/hygiene/one-predicate.test.ts :: GOOG-O17: no module compares a window bound
except the predicate module`; conformance `CONF-O27`, `CONF-O28`.

### GOOG-I18. Across pages the newest revision wins, and an unbuildable newest withholds the identity

**Lesson.** The same event id can appear on several pages of one delta, and the last page does not
necessarily win. Collapse by id choosing the higher `updated` (falling back to `created`). Crucially, if
the **newest** revision is unbuildable, withhold the whole identity — letting an older revision win
resurrects a time the publisher already moved away from.
**Learned from.** `fetch-events.ts` (`shouldReplaceGoogleRevision`/`getGoogleRevisionTime`); tests *"applies
only the final version when a provider occurrence changes repeatedly in one delta"*, *"never reverts a
stored event to the time the publisher moved it away from"*, *"withhold a UID whose newest revision is
unbuildable"*.
**Honoured by.** `src/listing/collapse-revisions.ts` runs over the accumulated page items **before**
decoding, keyed on the provider `id`, choosing the higher `updated` and falling back to `created`; equal
instants break on a stable `(etag, id)` comparison rather than arrival order. A winner that superseded a
loser and then fails to decode is withheld with the protocol's `supersededRevisionUnbuildable`.
**Not carried.** The loser *count* is not surfaced. `ListingDiagnostics` in `@keeper.sh/sync-protocol` has
exactly four members and no counter for superseded revisions; adding one is a shared-contract change that
would break `ical`, `reconcile` and the conformance reference in the same commit. The collapse still
returns `losers` and `superseded` to its caller, and the loss is observable as the withheld entry above.
**Proved by.** conformance `CONF-O7`, `CONF-O22`, `CONF-O8`; `google/tests/listing/revision-collapse.test.ts
:: GOOG-O18: the newest revision wins in either page order`;
`google/tests/listing/revision-collapse.test.ts :: GOOG-O18: a revision with no updated stamp falls back to
created, never to feed order`; `google/tests/listing/revision-collapse.test.ts :: GOOG-O18: two revisions
stamped at the same instant resolve the same way in either order`;
`google/tests/listing/revision-collapse.test.ts :: GOOG-O18: an unbuildable winner that superseded a
buildable loser is withheld as superseded`.

### GOOG-I19. `singleEvents: false` — masters and overrides are reassembled after pagination completes

**Lesson.** With `singleEvents: true` Google expands the series for us, which is convenient but makes the
delta lossy for series edits, hides the master's RRULE, and changes which tombstones arrive: with
`showDeleted` and `singleEvents` both true you receive only single deleted instances and never the
underlying series. With `singleEvents: false` the master and its `RECURRENCE-ID` overrides arrive
independently and can straddle pages, and an override can arrive **before** its master.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/recurringevents`;
`https://developers.google.com/workspace/calendar/api/v3/reference/events/list`; prior art
`fetch-events.ts:113` (`singleEvents: true`); commit `71ac9ee1` *fix(ics): emit recurring events as master +
RECURRENCE-ID overrides (#387)* — emitting overrides as fresh UIDs double-books every moved occurrence.
**Honoured by.** `src/listing/request-shape.ts` fixes `singleEvents: false` in an `as const` record.
`src/listing/assemble-series.ts` accumulates overrides against the series key and merges a master that
arrives later, so assembly is order-independent and runs only **after** pagination completes. The protocol
carries the series as one `RecurringContent` with an opaque `RecurrencePayload`; this package never expands
a rule. Every override contributes an `EXDATE` line at its `originalStartTime` to its master's
`RecurrencePayload.exceptions` (RFC 5545 §3.8.5.1), so the vacated slot never mirrors, and the override
itself is emitted as its own single-occurrence event under the instance uid of GOOG-I20 — never dropped,
never silently `continue`d. A cancelled override reaches the cancelled arm and becomes a `Removal`, which
the earlier skip swallowed entirely.
**Not carried.** Google sends a master and its overrides as separate resources, and a delta may carry the
override without the master. When the master is not in the same accumulated page set there is nothing to
attach the `EXDATE` to; the detached occurrence is still emitted, with the same deterministic identity it
would have had, so nothing is lost or duplicated, but the vacated slot is only closed on a listing that
carries both. The protocol has no `RECURRENCE-ID` arm to express the pairing across listings.
**Proved by.** `google/tests/listing/series-assembly.test.ts :: GOOG-O19: an override arriving before its
master on an earlier page assembles into one series`; `google/tests/listing/series-assembly.test.ts ::
GOOG-O19: a moved occurrence vacates its original slot and is carried at its new time`;
`google/tests/listing/series-assembly.test.ts :: GOOG-O19: an override behaves the same whether or not its
master shares the page set`; conformance `CONF-O36`.

### GOOG-I20. Instance identity is `(recurringEventId, originalStartTime)`, never the current start

**Lesson.** Expanded instances of a series all share one `iCalUID` while having distinct `id`s
(`masterId_20260101T090000Z`). Deduplicating or keying by `iCalUID` collapses a whole recurring series to a
single event. `originalStartTime` "uniquely identifies the instance within the recurring event series even
if the instance was moved", so keying on the instance's current start double-books every moved occurrence.
**Learned from.** `https://developers.google.com/workspace/calendar/api/v3/reference/events`;
`fetch-events.ts` (`changedEventsById` keyed on `event.id`); `buildSourceEventInstanceKey` in
`core/source/event-diff.ts`; tests *"adds recurring instances that share UID but differ by start and end"*,
*"does not merge recurring masters that reuse a UID at different slots"*.
**Honoured by.** `src/decode/identity.ts` derives `RemoteEventId` and `DeleteHandle` from the provider
`id`; `EventUid` carries `iCalUID` and is the cross-calendar mirror identity only. The series key is the
value type `{ seriesId, originalStart }`. An instance shares its master's `iCalUID`, so `uidOf` suffixes
the uid with the canonical `originalStartTime` (`uid#20260309T090000Z`) — the RFC 5545 `RECURRENCE-ID`
identity written into the uid space, deterministic across pages and runs rather than minted per listing.
**Proved by.** `google/tests/decode/series-identity.test.ts :: GOOG-O20: two occurrences sharing an iCalUID
are two identities`; conformance `CONF-O21`, `CONF-O22`.

### GOOG-I21. A delta item is a patch and never blanks the fields it omits

**Lesson.** A delta item is a change notification, not necessarily a whole event. Constructing a full
event from a reduced one overwrites the stored copy's description and location with nothing.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/sync`;
`https://developers.google.com/workspace/calendar/api/v3/reference/events`; conformance `CONF-O38`.
**Honoured by.** Google's incremental sync returns whole `Events` resources for changed events; the one
reduced form it sends is the cancelled tombstone, which never reaches the content path — `isCancelledItem`
takes it to the `cancelled` arm first. So for this provider an omitted `summary` means an untitled event,
not an unchanged title, and `?? ""` is the correct reading rather than a fabrication. The guard against the
case the lesson names is explicit: `carriesNoOccurrence` in `src/decode/decode-event.ts` withholds any
non-cancelled item that carries neither `start`, nor `end`, nor a recurrence rule, so a resource that is
not a whole event can never be built into `EditableContent` at all.
**Not carried.** No re-read. The protocol's `ChangeListing` has no partial-content arm — `RemoteEvent`
requires a complete `EditableContent` — so a provider that genuinely sent field-level patches could not be
represented here at all, and for Google an `events.get` would return the same resource the delta already
carried at three quota units apiece.
**Proved by.** conformance `CONF-O38`; `google/tests/decode/reduced-resource.test.ts :: GOOG-O21: an item
carrying no occurrence at all is withheld, never decoded into empty fields`;
`google/tests/decode/reduced-resource.test.ts :: GOOG-O21: a title Google omits is an untitled event, and
description and location stay absent`.

### GOOG-I22. Parsing is total per item: a value or a typed reason, never a throw

**Lesson.** Every member of Google's time object is optional, so a schema-valid `start: { timeZone: "UTC" }`
with no `date` and no `dateTime` reaches the parser. Guarding on the presence of the start/end **object**
rather than on a usable **instant** threw and failed the entire calendar's ingest, permanently and
uncounted.
**Learned from.** `fetch-events.ts` (the surviving comment on `parseGoogleEventsWithDiagnostics`); commit
`fdd9ba62` *"Google's parser guarded on the presence of the start/end object rather than a usable time"*.
**Honoured by.** `decodeEvent` returns a union and never throws. One malformed item costs that item plus a
counter — never the page and never the calendar.
**Proved by.** `google/tests/decode/per-item-isolation.test.ts :: GOOG-O22: a start with a zone and no
instant is withheld and the page still lists`; conformance `CONF-O6`.

### GOOG-I23. Absent arrays are empty and a calendar needs no display name

**Lesson.** Google omits empty arrays entirely (no `items` key) and omits `summary` on some calendars.
Requiring them made a user with no readable calendars — or one unnamed calendar — fail validation and take
the whole account's connect flow down with an opaque 500.
**Learned from.** `packages/calendar/src/providers/google/source/utils/list-calendars.ts`
(`page.items ?? []`, `summary ?? id`); commit `7dcc0916`.
**Honoured by.** `src/calendars/list-calendars.ts` validates entries one at a time so an unusable entry
costs only that entry, treats an absent `items` as empty, and falls back to the calendar id for
`displayName`. An empty enumeration is a `snapshot` with zero calendars, which is not proof that everything
was deleted. `calendarList.list` is paginated to exhaustion under the page ceiling: `kind: "snapshot"` is
the one enumeration variant the protocol's `DeriveCalendarRetirements` will retire against, so it is
emitted only when no `nextPageToken` survives. A ceiling reached with a token still in hand is
`notAttempted`/`budgetExhausted`, never a truncated first page dressed as complete coverage. An
account-level failure is reported with `calendar: null` rather than against a `primary` calendar that may
not exist.
**Proved by.** `google/tests/calendars/tolerant-enumeration.test.ts :: GOOG-O23: a page with no items key
and an unnamed calendar both enumerate`; `google/tests/calendars/tolerant-enumeration.test.ts :: GOOG-O23: a
page that carries a next token is followed, never presented as a snapshot`.

### GOOG-I24. Error classification tolerates a body that is not the documented shape

**Lesson.** Google returns non-JSON, empty and truncated error bodies. Calling `response.json()` on the
error path threw `SyntaxError` and crashed the whole sync. `@googleapis/calendar` changes the surface —
errors arrive as `GaxiosError` with `response.status` and `response.data` — but the lesson is identical,
and gaxios's `errorRedactor` is on by default and scrubs parts of the payload.
**Learned from.** `packages/calendar/src/providers/google/shared/errors.ts` (`parseGoogleApiError`); commit
`db3a047a`; `https://raw.githubusercontent.com/googleapis/gaxios/main/src/common.ts` (verified 2026-08-16:
`errorRedactor?: typeof defaultErrorRedactor | false`).
**Honoured by.** `src/errors/gaxios-error.ts` is a total decoder from `unknown` to
`{ status: number | null, reasons: readonly string[], retryAfter: Instant | null }`. It reads status and
reason before anything else touches the error, so redaction cannot remove the fields classification needs.
Classification returns a typed union and never throws.
**Proved by.** `google/tests/errors/hostile-bodies.test.ts :: GOOG-O24: an empty, a non-JSON and a redacted
error body each classify without throwing`; conformance `CONF-O23`.

### GOOG-I25. Classification is `(status, reason)`, never status alone

**Lesson.** 403 is both "rate limited" and "needs reauth" depending on `error.status` and the case-insensitive
`reason` strings inside `errors[]`/`details[]` (`rateLimitExceeded`, `userRateLimitExceeded`,
`accessTokenScopeInsufficient`, `authError`, `loginRequired`). Treating every 403 as auth failure marks
healthy accounts as needing reauthentication; treating every 403 as rate limit retries a permission error
five times. Never classify by matching error message substrings.
**Learned from.** `packages/calendar/src/providers/google/shared/errors.ts` (`isAuthError`,
`isRateLimitApiError`); commit `e10d0abb` *"update errors for google to match what we get in reality"*;
`https://developers.google.com/workspace/calendar/api/guides/errors`.
**Honoured by.** `src/errors/classify.ts` maps `(status, reasons)` through an `as const` table to
`GoogleFailure`: `cursorLost | resourceGone | rateLimited | conflict | preconditionFailed | authExpired |
notFound | unsupported | transient | permanent`. Retryability is a property of the classification, not of
the status code, and every caller switches exhaustively.
**Proved by.** `google/tests/errors/classification.test.ts :: GOOG-O25: a 403 rateLimitExceeded and a 403
authError classify differently`; conformance `CONF-O46`.

### GOOG-I26. 410 and 404 mean different things on different verbs

**Lesson.** On a delete both are success — the desired end state is "gone". On a listing 410 is cursor
loss. On `channels.stop` both mean the channel is already gone and must not fail deregistration. Treating a
delete 410 as failure left events retrying forever on every sync cycle.
**Learned from.** `packages/calendar/src/providers/google/destination/provider.ts:410` (surviving comment);
`push/watch-channel.ts` (`CHANNEL_GONE_STATUSES`); commit `6b50aa27`;
`https://developers.google.com/workspace/calendar/api/guides/errors`.
**Honoured by.** Status interpretation is per-operation, expressed in each operation's own result union.
There is no shared `isSuccess(status)` helper. `classifyGoogleError` takes the `OperationName` so
`(410, listChanges)` and `(410, write)` cannot collapse.
**Proved by.** `google/tests/errors/per-verb-gone.test.ts :: GOOG-O26: a 410 on delete is alreadyAbsent and
a 410 on list is cursorLost`.

### GOOG-I27. `eventType` is an exhaustive `as const` map, not a default-to-busy

**Lesson.** Working-location events must never be mirrored — they produce junk on the user's other calendar
that they cannot delete from Keeper — and out-of-office maps to a distinct availability. A new Google
`eventType` silently becoming "busy" is how that junk appeared.
**Learned from.** `fetch-events.ts` (`resolveGoogleAvailability`, `resolveSourceEventType`);
`destination/serialize-event.ts` (`canSerializeGoogleEvent`); commits `66eeee8e`, `642eb5c8`.
**Honoured by.** `src/decode/event-type.ts` is an `as const` record with a derived union, switched with
`assertNever`, so an unrecognised `eventType` is a decode refusal with a counter rather than a silent
"busy".
**Proved by.** `google/tests/decode/event-type.test.ts :: GOOG-O27: a workingLocation event is withheld, an
outOfOffice event is free`.

### GOOG-I28. A non-IANA zone identifier never reaches a canonical event

**Lesson.** Google states IANA zone ids on `start.timeZone`, but a caller-supplied zone on a write, or a
zone Google has not heard of, must not be passed through. Windows CLDR names arriving from a Microsoft-
published feed and reaching a Google write is the failure mode.
**Learned from.** `packages/calendar/src/ics/utils/normalize-timezone.ts`,
`resolve-timezone-identifier.ts`; `tests/ics/utils/outlook-windows-timezone.test.ts`; commits `ac6fa18c`,
`7c276d8e`; conformance `CONF-O43`.
**Honoured by.** `src/decode/event-time.ts` validates a zone id against `Intl.supportedValuesOf("timeZone")`
before it becomes a `ZoneId`; an unresolvable zone is `withheld` with reason `unresolvableTimeZone`. The
same validation gates `normalize()` on the write side.
**Proved by.** conformance `CONF-O43`; `google/tests/decode/zone-validation.test.ts :: GOOG-O28: a Windows
zone name on a Google event is withheld, not passed through`.

### GOOG-I29. Every await on Google has a deadline merged with the caller's signal, and the two are distinguishable

**Lesson.** Without a hard per-request abort a hung Google request pinned a worker slot and froze sync
indefinitely until a manual restart, observed in production as a sync stuck mid-percentage. The job
deadline must abort in-flight requests, not merely gate between chunks. And a user's cancel reported as a
provider timeout sends the operator hunting a Google outage that never happened.
**Learned from.** `packages/calendar/src/core/utils/fetch-with-timeout.ts`
(`buildTimeoutSignal`/`mergeAbortSignals`); commit `1b8e796d`; tests *"marks timeout failures as
transient"*, *"preserves an already-aborted signal's reason"*.
**Honoured by.** `src/client/deadline.ts` exports `mergeSignals` and `raceDeadline`. `raceDeadline` sits
**inside** `createRequestSeam.send`, so every request the adapter makes — write, `listCalendars`,
`events.get`, `events.watch`, `channels.stop` and the listing walk alike — is bounded, not only
`listChanges`; `mergeSignals` removes its listeners on settle so a long-lived caller signal does not leak a
listener per request. A permit is released when the merged signal fires as well as when the body settles,
so a call abandoned at its deadline cannot leak a permit and starve the pool. A deadline yields
`{ kind: "notAttempted", reason: "budgetExhausted" }`; a caller abort yields
`{ kind: "notAttempted", reason: "aborted" }`.
**Proved by.** conformance `CONF-L2`, `CONF-L3`, `CONF-L12`;
`google/tests/lockups/deadline.test.ts :: GOOG-L2: a transport that never resolves settles at the deadline`;
`google/tests/lockups/every-verb-deadline.test.ts :: GOOG-L2: a write against a transport that never
answers settles at the deadline`; `google/tests/lockups/every-verb-deadline.test.ts :: GOOG-L2:
listCalendars against a transport that never answers settles at the deadline`;
`google/tests/lockups/every-verb-deadline.test.ts :: GOOG-L2: registering a watch channel against a stalled
transport settles at the deadline`; `google/tests/lockups/every-verb-deadline.test.ts :: GOOG-L2: a permit
abandoned at its deadline returns to the pool`; `google/tests/lockups/every-verb-deadline.test.ts ::
GOOG-L2: a starved pool still answers once the transport recovers`;
`google/tests/lockups/abort-vs-timeout.test.ts :: GOOG-L3: a caller abort is not reported as a provider
timeout`.

### GOOG-I30. Retry has a ceiling, a capped provider delay, and an abortable sleep on `setTimeout`

**Lesson.** `withBackoff` caps attempts, caps the delay, jitters, honours a provider `Retry-After` but
clamps it to the maximum, rejects immediately if the signal is already aborted, and throws an explicit
"unreachable" error rather than returning `undefined`. A provider-supplied `Retry-After` of ten hours must
not produce a ten-hour wait. `Bun.sleep` is a native primitive `vi.useFakeTimers` cannot patch.
**Learned from.** `packages/calendar/src/core/utils/backoff.ts:43`; tests *"throws after exhausting all
retries"*, *"aborts during backoff sleep when signal is triggered"*, *"rejects immediately if the signal is
already aborted"*, *"caps a provider-supplied delay at the maximum backoff"*.
**Honoured by.** `src/client/backoff.ts` takes `RetryBudget` from `OperationContext` — `maxAttempts` and
`retryDelayCeilingMs` are the caller's, not the module's — and sleeps through the injected
`clock.sleep(ms, signal)`. The delay is jittered over `[half, full]` through the injected
`dependencies.randomFraction`, so a fleet that hits one 429 does not retry in lockstep and the randomness
is a seam a test can pin. A sleep that rejects is only an abort when the signal actually aborted; any other
rejection surfaces the provider failure it was waiting on rather than being relabelled a caller cancel. No
`Bun.sleep` anywhere in the package; a hygiene test enforces it.
**Proved by.** conformance `CONF-L1`; `google/tests/lockups/retry-ceiling.test.ts :: GOOG-L1: an operation
given three attempts reaches the transport three times`; `google/tests/hygiene/no-bun-sleep.test.ts ::
GOOG-L1: no source file references Bun.sleep`; `google/tests/lockups/backoff-jitter.test.ts :: GOOG-L3: two
workers drawing different fractions do not retry in lockstep`;
`google/tests/lockups/backoff-jitter.test.ts :: GOOG-L3: a sleep that rejects for its own reasons is a
failure, never a caller abort`.

### GOOG-I31. Quota is acquired inside the retried operation

**Lesson.** A whole-batch 429 re-sends every sub-request and Google charges per-user quota for each
attempt. Metering once per operation hid the real usage and made the limiter useless exactly when it
mattered. And a waiter blocked on capacity with no abort signal is a wedge.
**Learned from.** `packages/calendar/src/providers/google/shared/batch.ts:230-243` (surviving comment);
commit `f4b99005`; tests *"aborts while waiting for capacity"*, *"stops the timer when the acquire is
aborted mid-wait"*.
**Honoured by.** `src/client/request.ts` acquires the semaphore permit **inside** the function passed to
`withBackoff`, and `acquire` takes the merged signal. The limiter is injected, never constructed at module
scope.
**Proved by.** `google/tests/lockups/quota-inside-retry.test.ts :: GOOG-L1: three attempts take three
permits`; `google/tests/lockups/acquire-abort.test.ts :: GOOG-L10: an abort while waiting for capacity
releases the wait and arms no timer`.

### GOOG-I32. A permit or lease is released when the body throws, and when it aborts

**Lesson.** A lock released only on the happy path is this product's recurring hang. The prior art proved
both halves: *"acquires every source lock before running work"* and *"releases the lock after failures"*.
**Learned from.** `packages/calendar/src/core/source/ingest-lock.ts`;
`tests/core/source/ingest-lock.test.ts`; commit `1c5171d2`.
**Honoured by.** `src/client/semaphore.ts` releases in `finally`, the abort path releases before it
rejects, and a holder whose signal aborts releases even if its body never settles — an outside call that
ignores abort can no longer take a permit to the grave. Release is idempotent, so the two paths cannot
double-release. `src/client/single-flight.ts` deletes its map entry **only if it still owns it**.
**Proved by.** conformance `CONF-L7`, `CONF-L10`; `google/tests/lockups/lease-release.test.ts :: GOOG-L7: a
throwing body releases its permit and the next call proceeds`;
`google/tests/lockups/every-verb-deadline.test.ts :: GOOG-L2: a permit abandoned at its deadline returns to
the pool`.

### GOOG-I33. A single-flight leader's failure reaches every follower, and each follower keeps its own diagnostics

**Lesson.** A losing waiter that neither resolves nor rejects is the classic hang. The coordinator must
delete its own entry only if it still owns it, propagate the leader's failure to every follower, and not
log from inside the shared body — the body runs in whichever caller's async context created it, so
telemetry from inside lands on a foreign wide event.
**Learned from.** `packages/calendar/src/core/oauth/refresh-coordinator.ts` (identity check in `.finally`,
the surviving comment about foreign wide events); tests *"coalesces concurrent refreshes for the same
credential"*, *"charges the awaited refresh to the caller's own event"*.
**Honoured by.** `src/client/single-flight.ts` keys on the listing scope, rejects every follower with the
leader's failure, and returns diagnostics per caller rather than one shared object. The shared request runs
under the flight's **own** `AbortController`, joined callers are refcounted, and it is aborted only once
every caller has given up — so one caller's short deadline cannot cancel the request a caller with budget
is still waiting on. The abandoning caller forgets the key under an identity check as it goes, so the next
caller starts a fresh flight rather than joining an aborted one or racing a second leader.
**Proved by.** conformance `CONF-L4`, `CONF-L5`, `CONF-L9`; `google/tests/lockups/single-flight.test.ts ::
GOOG-L4: a leader that throws rejects all three followers and empties the map`;
`google/tests/lockups/single-flight.test.ts :: GOOG-L4: a caller that gives up early does not cancel the
caller that still has budget`; `google/tests/lockups/single-flight.test.ts :: GOOG-L4: the shared request is
cancelled only once every caller has given up`; `google/tests/lockups/single-flight.test.ts :: GOOG-L4: a
key abandoned by every caller is released, never left registered`.

### GOOG-I34. Coalescing keys are sorted before acquisition

**Lesson.** Unordered acquisition of two calendars by two workers deadlocks. The prior art de-duplicates
and **sorts** the calendar id list before taking advisory locks.
**Learned from.** `packages/calendar/src/core/source/ingest-lock.ts`; commit `1c5171d2`.
**Not applicable, and why.** This adapter never acquires two coalescing keys at once. `listGoogleChanges`
takes exactly one key — the request-shape fingerprint plus the resume token — holds nothing else while it
waits, and releases it before returning, so the hold-and-wait precondition for deadlock is absent and there
is no ordering decision to make. The sorting helper that once stood in for this entry was called by
nothing; keeping a sorted-key export that no acquisition site uses would prove the lesson over dead code,
so it was deleted. The two-scope concurrency case remains as the standing check that the claim stays true.
**Proved by.** conformance `CONF-L6`; `google/tests/lockups/ordered-keys.test.ts :: GOOG-L6: two callers in
opposite key orders both settle`; `google/tests/lockups/ordered-keys.test.ts :: GOOG-L6: two callers over
one key share a single request, so no second key is ever held`.

### GOOG-I35. Pagination has a page ceiling and one deadline over the whole loop

**Lesson.** `while (result.data.nextPageToken)` has neither a page ceiling nor a loop-wide deadline. A
pathological calendar, or a server that keeps returning a page token, wedges the tick. `maxResults` was
deliberately set to 250 rather than the 2500 maximum to cut payload transfer time.
**Learned from.** `fetch-events.ts:239`; `packages/calendar/src/providers/google/shared/api.ts`; commit
`24dab764`; `https://developers.google.com/workspace/calendar/api/v3/reference/events/list`.
**Honoured by.** `src/listing/paginate.ts` takes `maxPages` and the operation deadline; hitting either
returns `partial` with a `Continuation` (GOOG-I4), which is exactly RFC 6578's truncation rule.
`googleListingLimits` is an `as const` record naming `maxResults: 250` and `maxPages`. A budget spent
mid-walk hands back the pages already read as `truncated` with the page token in hand, so a slow calendar
makes forward progress across runs; `notAttempted` is reserved for a budget spent before the first page,
where there is nothing to continue from.
**Proved by.** `google/tests/lockups/page-ceiling.test.ts :: GOOG-L2: a server that always returns a page
token stops at the ceiling with a continuation`; `google/tests/lockups/page-ceiling.test.ts :: GOOG-L2: a
loop that runs out of budget mid-walk hands back the pages it read, not nothing`;
`google/tests/lockups/page-ceiling.test.ts :: GOOG-L2: a budget spent before the first page is notAttempted,
never a truncation of nothing`.

### GOOG-I36. No timer survives a completed operation

**Lesson.** An armed timer after the answer is a leaked handle that keeps a process alive and, in a fake-
timer test, silently fires into the next case.
**Learned from.** Conformance `CONF-L8`.
**Honoured by.** `raceDeadline` clears its timer in `finally`; `backoff` clears its sleep timer on both
settlement paths.
**Proved by.** conformance `CONF-L8`.

### GOOG-I37. An abort before the first request is `notAttempted` with zero transport calls

**Lesson.** A run aborted before it began is neither a success nor a failure of the provider, and it must
not spend a request proving that.
**Learned from.** Conformance `CONF-L12`; ledger entry 20 of the sync-protocol section.
**Honoured by.** `src/client/request.ts` checks `signal.aborted` before reaching the transport and returns
`{ kind: "notAttempted", reason: "aborted" }`.
**Proved by.** conformance `CONF-L12`.

### GOOG-I38. The SDK's defaults are themselves the lockup, and are switched off explicitly

**Lesson.** `googleapis-common` sets `options.retry = options.retry === undefined ? true : options.retry`,
so gaxios retries are ON by default — and gaxios's default `httpMethodsToRetry` is
`['GET','PUT','HEAD','OPTIONS','DELETE']`, which silently retries `events.update` (PUT) and
`events.delete`, both destructive. gaxios's `timeout` is documented as "No timeout by default", so a hung
request wedges forever. gaxios also has a known bug where cancellation triggers a retry
(googleapis/gaxios#120).
**Learned from.** `https://raw.githubusercontent.com/googleapis/nodejs-googleapis-common/main/src/apirequest.ts`
and `https://raw.githubusercontent.com/googleapis/gaxios/main/src/common.ts`, both verified 2026-08-16;
`https://github.com/googleapis/gaxios/issues/120`.
**Honoured by.** `src/client/calendar-client.ts` constructs the client once with
`retryConfig: { retry: 0 }`, an explicit `timeout`, and an injected `fetchImplementation`. Retry, deadline
and classification are ours (GOOG-I29, GOOG-I30, GOOG-I25). A hygiene test asserts the constructed client
carries `retry: 0`, so a dependency bump cannot quietly restore the destructive default.
**Proved by.** `google/tests/hygiene/sdk-defaults.test.ts :: GOOG-L1: the constructed client disables
gaxios retries and sets a timeout`.

### GOOG-I39. An unconditional update or delete is not expressible

**Lesson.** The existing Google destination writes carry no `If-Match` anywhere — grep for `If-Match|etag`
across `providers/google/destination` returns nothing — so a concurrent edit by the user is silently
clobbered. Google Calendar is the one Workspace API that fully documents optimistic concurrency:
`events.update` and `events.patch` accept `If-Match` and answer 412 when the etag is stale. A 412 must be
returned, never retried blind.
**Learned from.** grep over `packages/calendar/src/providers/google/destination/{provider,sync}.ts` (no
match); `https://developers.google.com/workspace/calendar/api/guides/version-resources`;
`https://developers.google.com/workspace/calendar/api/guides/errors` (412: *"re-fetch entity and reapply
changes"*).
**Honoured by.** The protocol's `update`, `delete` and `retire` intents carry a non-optional
`precondition: ObservedPrecondition`, so an unconditional write cannot be constructed.
`src/write/precondition.ts` renders `matchesVersion` as `If-Match: <etag>`; a 412 becomes
`{ kind: "conflict", remote, observed }` carrying the current version. Combined with GOOG-I38 this also
closes the retry-clobber path: a retried conditional PUT 412s rather than overwriting.
**Proved by.** conformance `CONF-O14`, `CONF-O39`, `CONF-O44`;
`google/tests/writes/precondition-required.test-d.ts :: GOOG-O39: an update without a precondition does not
type-check`; `google/tests/writes/stale-precondition.test.ts :: GOOG-O39: a spent precondition is a
conflict, not a second write`.

### GOOG-I40. A replayed create is a no-op: deterministic id, and 409 is success

**Lesson.** Client-supplied event ids are Google's documented idempotency mechanism — they "prevent
duplicate event creation if the operation fails at some point after it is successfully executed". A 409
"The requested identifier already exists" on a replay is the **success** signal. Google's error guide
suggests generating a new id on 409, which is a duplicate-manufacturing machine. The old
lookup→delete→re-insert conflict path left two permanently-stuck classes: tombstoned UIDs that 409 forever
while `events.list` no longer returns them, and already-deleted events whose conflict delete 410s.
**Learned from.** `https://developers.google.com/workspace/calendar/api/v3/reference/events#id`;
`https://developers.google.com/workspace/calendar/api/guides/create-events`;
`packages/calendar/src/core/events/identity.ts`; commits `6b50aa27`, `2abd56b3`, `05c2e670` *"deadlock
caused by conflicting mappings"*.
**Honoured by.** `src/write/event-id.ts` derives the Google `id` deterministically from
`(idempotencyKey, destination calendar id)` and encodes it as base32hex — lowercase `a`–`v` and `0`–`9`,
length-checked at the type boundary against Google's 5–1024 rule. Omitting the calendar id would make one
source event collide across two destination calendars on one account, so it is part of the input.
`classifyGoogleError` maps 409/`duplicate` to `alreadyExists`, which re-reads the existing event and
returns its `RemoteRef`.
**Proved by.** conformance `CONF-O14`, `CONF-O15`; `google/tests/writes/idempotent-create.test.ts ::
GOOG-O14: the same create issued twice leaves one object`.

### GOOG-I41. Provenance lives in `extendedProperties.private` **and** in the deterministic id

**Lesson.** Echo suppression by `iCalUID` suffix fails on exactly the items where it matters most: a
cancelled exception is guaranteed to carry only `id`, `recurringEventId` and `originalStartTime`, and the
prior art dropped any event with no `iCalUID` entirely. Self-authored skips must also be counted
**separately** from unrepresentable ones — folding them together left the "cannot parse" counter
permanently non-zero on every mirrored calendar and made real breakage invisible.
**Learned from.** `packages/calendar/src/core/events/identity.ts`; `fetch-events.ts:367-374`
(`selfAuthoredCount`); commit `fdd9ba62`;
`https://developers.google.com/workspace/calendar/api/v3/reference/events`.
**Honoured by.** `src/decode/provenance.ts` checks both channels: `extendedProperties.private`, which is
scoped to this calendar's copy and not shared with attendees, and the deterministic id from GOOG-I40, which
is the one signal present on a bare tombstone. Both channels are live in the listing path:
`src/write/minted-ids.ts` is a bounded, capacity-capped memory of the ids `createEvent` minted, held on the
provider instance and threaded through `FeedInputs` into `decodeProvenance` — it is not the empty set the
first cut passed. Cancelled items are run through provenance **before** they become removals, so our own
tombstone is counted as self-authored rather than handed back as a foreign deletion. An item that carries
no stamp and could not carry one — a cancelled tombstone with no `extendedProperties` at all — is
`indeterminate`, never asserted foreign. `capabilities.provenanceChannel` is `"extendedProperty"`.
`diagnostics.selfAuthored` is a separate `BoundedSample` from `diagnostics.unrepresentable`.
**Proved by.** conformance `CONF-O16`, `CONF-O17`, `CONF-O30`;
`google/tests/provenance/tombstone-echo.test.ts :: GOOG-O16: a cancelled exception carrying only an id is
still recognised as ours`; `google/tests/provenance/tombstone-echo.test.ts :: GOOG-O16: an event we wrote
lists back as ours through the adapter, not only in the decoder`;
`google/tests/provenance/tombstone-echo.test.ts :: GOOG-O16: our own tombstone is counted as self-authored,
never handed back as a removal`; `google/tests/provenance/tombstone-echo.test.ts :: GOOG-O16: a tombstone
that can carry no stamp at all is indeterminate, never asserted foreign`;
`google/tests/writes/minted-ids.test.ts :: GOOG-O40: the memory never grows past its capacity`.

### GOOG-I42. The echo verdict is three-state and honest

**Lesson.** "Did our write land as we sent it" has three answers, and an adapter that cannot observe its
own write must say so rather than claim a match.
**Learned from.** Sync-protocol ledger entry 8; conformance `CONF-O18`.
**Honoured by.** Google returns the created resource body, so `capabilities.echoesWrites` is `true` and
`src/write/echo.ts` compares the returned body's fingerprint against the submitted one, yielding
`matched` or `diverged` with a bounded field sample. `notObserved` is reachable only if the body is absent.
**Proved by.** conformance `CONF-O18`.

### GOOG-I43. Degenerate ranges are normalised at one seam, before the mapping and the fingerprint

**Lesson.** Google rejects any non-positive span with 400 "The specified time range is empty.", yet a timed
VEVENT with no DTEND ends at its DTSTART per RFC 5545 §3.6.1 — so a zero-duration event is legal input, not
corruption. Left unhandled the push fails, no mapping is recorded, and the same add is recomputed every
run: one calendar failed roughly fifty times an hour. The fix must land **before** the mapping and content
hash are computed, not inside the serializer, so the mapping, the hash and the pushed resource all agree on
one range.
**Learned from.** `packages/calendar/src/providers/google/destination/normalize-event.ts` (surviving
comment); `core/events/time-range.ts` (`resolveRepresentableTimeRange`); commit `b057d2e0`
*fix(calendar): mirror zero-duration events Google cannot represent (#616)*.
**Honoured by.** The prior art's answer is followed rather than inverted: the **source** side keeps the
range the feed states — `src/decode/event-time.ts` decodes a zero-duration span as stated and refuses only
an inverted one, and `withinGoogleWindow` already admits a degenerate range by the instant it names — and
the **destination** side widens once, at the one shaping seam, to `POINT_IN_TIME_DURATION_MS` (one minute).
`capabilities.representableRange` therefore declares `zeroDuration: "accept"` with
`minimumSpanSeconds: 60`, so the widening is announced rather than silent, and `invertedRange: "reject"`
stays a typed `{ kind: "unrepresentable", constraint: "invertedRange" }`. Widening in `normalize()` means
the mapping, the fingerprint and the pushed resource all agree on the widened range, so the second run
reads back a match instead of rewriting — the fifty-failures-an-hour loop the commit fixed. Shaping is a
fixed point: shaping twice equals shaping once.
**Proved by.** conformance `CONF-O28`, `CONF-O29`; `google/tests/writes/normalize-fixed-point.test.ts ::
GOOG-O28: normalising twice equals normalising once`; `google/tests/writes/normalize-fixed-point.test.ts ::
GOOG-O28: a zero-duration range is widened once, to the span the capability declares`.

### GOOG-I44. All-day ranges are snapped onto the UTC day grid and never silently converted

**Lesson.** Google writes all-day as a pair of DATEs and reads them back as UTC midnights, so a range not
already on day boundaries came back narrower than written, the mirror was judged changed, and every event
was deleted and re-created on every run — on Google, Outlook and CalDAV alike.
**Learned from.** Commit `b057d2e0` *"snap an all-day range onto the UTC days it touches"*;
`destination/serialize-event.ts` (`formatDateOnly`); tests *"anchors a zone ahead of/behind UTC on the UTC
midnight of its local calendar day"*, *"does not treat non-midnight 24-hour timed events as all-day"*.
**Honoured by.** `capabilities.allDay` is `"dateOnly"` and `representableRange.allDayGrid` is `"utcDay"`.
No snap is performed, and none is needed: the protocol's all-day arm is a `CalendarDate` pair, so an
off-grid all-day range is unrepresentable by construction — the type does what the prior art's snap did.
The one shaping `src/write/normalize.ts` does perform on that arm is the degenerate widening of GOOG-I43,
to the next UTC day. `src/decode/event-time.ts` decodes a `date` pair back to `{ kind: "allDay" }` and a
`dateTime` pair to `{ kind: "timed" }`, never collapsing the two.
**Proved by.** conformance `CONF-O45`, `CONF-O9`, `CONF-O20`;
`google/tests/writes/all-day-roundtrip.test.ts :: GOOG-O45: writing, reading back and diffing an all-day
event twice produces zero operations`.

### GOOG-I45. A provider-owned content region is projected exactly once

**Lesson.** Google owns the region of the description between its conference delimiters and deletes its
contents on write, because a mirrored copy carries no conference. Stripping just the two delimiter markers
— anchored on the marker, not the line — hands the meeting details over as ordinary prose Google keeps.
Related: Google stores a description's markup as sent, and running a render over its own output ate an
author's escaped `&lt;timeout&gt;30&lt;/timeout&gt;`.
**Learned from.** `packages/calendar/src/providers/google/destination/conference-block.ts` (surviving
comment); commit `58384b13`.
**Honoured by.** The projection lives in `src/write/normalize.ts`, runs exactly once at that named seam,
and `src/write/serialize.ts` writes what it is handed. The fixed-point test of GOOG-I43 covers it.
**Proved by.** `google/tests/writes/conference-block.test.ts :: GOOG-O20: projecting a description twice
equals projecting it once and preserves escaped markup`;
`google/tests/writes/conference-block.test.ts :: GOOG-O20: the delimiters go and the details they fenced
are kept as ordinary prose`; `google/tests/writes/conference-block.test.ts :: GOOG-O20: a marker wrapped in
markup is still the anchor, not the line it sits on`.

### GOOG-I46. A half-completed replace leaves a recoverable state

**Lesson.** A delete followed by a create where the create fails must not destroy the copy that blocked it,
and the next run must be able to finish the job.
**Learned from.** Conformance `CONF-O25`; commit `05c2e670` *"deadlock caused by conflicting mappings"*.
**Honoured by.** Each half is an independent conditional write with its own precondition and its own typed
outcome. The adapter never issues an unconditional recreate to clear a conflict.
**Proved by.** conformance `CONF-O25`.

### GOOG-I47. Moving an occurrence is one conditional update, never a delete and an add

**Lesson.** Expressing a move as delete-then-add double-books the occurrence when the second half fails and
loses the attendee state Google holds against the original resource.
**Learned from.** Commit `71ac9ee1`; conformance `CONF-O36`.
**Honoured by.** `src/write/update.ts` issues a single `events.patch` with `If-Match`. The precondition is
the adapter's only guard: choosing a target it is entitled to write is the caller's obligation, and the
adapter does not re-derive provenance before patching — an unconditional update is not expressible, so a
mistargeted write costs a typed `conflict`, not a silent overwrite. The patch body is built by
`patchBodyOf`, not by the create serializer: it asserts no `status`, so a patch cannot resurrect a
cancelled event, and it sends an explicit empty `recurrence` when the new content is a single occurrence,
because Google's documented patch semantics leave an omitted field unchanged and overwrite an array field
that is present. Reusing the create body left the old `RRULE` in place and produced an event that was
neither the old series nor the new single, diverging on every retry so it could never converge.
**Proved by.** conformance `CONF-O36`; `google/tests/writes/patch-clears-fields.test.ts :: GOOG-O47:
demoting a series to a single occurrence clears the rule Google would otherwise keep`;
`google/tests/writes/patch-clears-fields.test.ts :: GOOG-O47: the demotion echoes back as matched, so a
retry can converge`; `google/tests/writes/patch-clears-fields.test.ts :: GOOG-O47: a patch never asserts a
status, so it cannot resurrect a cancelled event`.

### GOOG-I48. The fingerprint is canonical, injected, and identity-free

**Lesson.** Change detection must survive key order, `Date`-vs-string and `undefined`-vs-`null`, or
re-ingesting the same input twice is work. And a fingerprint that includes the provider id changes when
nothing the user can see changed.
**Learned from.** Sync-protocol ledger entries 29 and 30; `core/events/content-hash.ts`.
**Honoured by.** `src/fingerprint.ts` canonicalises the `FingerprintContract.comparableFields` of
`EditableContent` with RFC 8785 key ordering and feeds the injected `hash`. The hash function is a
constructor argument, never imported (GOOG-I67).
**Proved by.** conformance `CONF-O21`, `CONF-O9`, `CONF-O20`;
`google/tests/fingerprint/permutation.test.ts :: GOOG-O21: two key orders of one content produce one
fingerprint`.

### GOOG-I49. Every discard is returned as data, split by reason, bounded beside an exact total

**Lesson.** Every counter the prior art added exists because something vanished invisibly. The cron job
originally collected the ingest wide event and never read it, so production had no record of what was
stored or discarded. Counters must be split by reason (`outsideSyncWindow`, `unrepresentable`,
`selfAuthored`, `withheld`), must be stable across repeated runs, and identifier lists must be a capped
sample beside an uncapped count.
**Learned from.** Commit `fdd9ba62` *fix(ingest): make dropped source events visible on the wide event
(#634)*; `packages/calendar/tests/ics/utils/ics-*-telemetry.test.ts`; user memory *wide logging*.
**Honoured by.** `ListingDiagnostics` rides the listing result as data. The adapter imports no logger and
performs no module-level side effect, which satisfies both the dependency-injection rule and the wide-
logging convention: the caller decides what to emit.
**Proved by.** conformance `CONF-O30`, `CONF-O31`, `CONF-O32`, `CONF-O19`.

### GOOG-I50. No event content ever appears in the loggable half of a listing

**Lesson.** Diagnostics get logged. A title or a description in a counter's sample is a privacy incident
with no upside.
**Learned from.** Conformance `CONF-O19`; sync-protocol ledger entry 22.
**Honoured by.** `BoundedSample.sample` carries identifiers only, and `src/listing/diagnostics.ts` builds
samples exclusively from `EventUid` and `RemoteEventId` values.
**Proved by.** conformance `CONF-O19`, `CONF-O23`.

### GOOG-I68. A watch channel is recreated with a fresh id, and the server's expiration is authoritative

**Lesson.** Google caps a channel at seven days and offers no renew verb, so "renewal" is
register-new-then-stop-old. Extending an existing channel is not expressible, and trusting our own
requested TTL rather than the `expiration` the server returned leaves a channel we believe is live and is
not. Expiries must be staggered so a fleet does not re-register in one minute.
**Learned from.** `packages/calendar/src/providers/google/push/watch-channel.ts`; commit `6b50aa27`;
`https://developers.google.com/workspace/calendar/api/guides/push`.
**Honoured by.** `src/push/profile.ts` is an `as const` record naming the seven-day maximum, the renewal
lead and the stagger window, with `renewal: "recreate"`, and `renewalInstantOf` turns them into the actual
instant to renew at: the server's expiration less the lead, plus a per-calendar offset derived from the
injected hash of the calendar id, so a fleet spreads deterministically instead of re-registering in one
minute (the `getDeterministicRefreshOffset` lesson of GOOG-I6). It never lands after the expiry it is
protecting. `src/push/watch.ts` registers the replacement before stopping the old channel, treats a channel
response with no `resourceId` as a failure rather than defaulting it to a value `channels.stop` could never
target, and returns the stop outcome beside the new channel so a superseded channel that could not be
closed is reported rather than swallowed. `stopWatchChannel` treats 404 and 410 as `alreadyGone`
(GOOG-I26).
**Proved by.** `google/tests/push/watch-lifecycle.test.ts :: GOOG-P3: a renewal registers a new channel
before it stops the old one`; `google/tests/push/watch-lifecycle.test.ts :: GOOG-P3: the server's
expiration is the one that is stored`; `google/tests/push/watch-lifecycle.test.ts :: GOOG-P3: a renewal
whose stop failed reports the channel it could not close`; `google/tests/push/watch-lifecycle.test.ts ::
GOOG-P3: renewal instants are staggered per calendar and never land after expiry`;
`google/tests/errors/per-verb-gone.test.ts :: GOOG-O26: a 410 on channels.stop leaves the channel already
gone, never a failure`.

### GOOG-I69. A push notification is a claim, not a fact, and the first one is a handshake

**Lesson.** Google's push delivery is header-only, lossy and unordered, and the very first delivery on a
new channel is a `sync` handshake that carries no change at all. Treating it as a change triggers an
ingest per registration; treating any notification as coverage lets a lost delivery become a permanent
hole. The decoder is internet-facing, so it must be total over arbitrary headers.
**Learned from.** `packages/calendar/src/providers/google/destination/provider.ts` (`buildPushRequest`);
`https://developers.google.com/workspace/calendar/api/guides/push`.
**Honoured by.** `src/push/receiver.ts` exports `decodePushSignal(inputs) -> PushSignal`, a total function
whose `handshake` arm is a no-op and whose `changed` arm carries identifiers only — never events, so a
notification can never be mistaken for coverage. Verification is inside the decoder rather than beside it:
it takes the channel lookup and the digest, and refuses a delivery for an unregistered channel
(`unknownChannel`) or one whose `X-Goog-Channel-Token` does not match the stored hash (`badToken`), so a
`changed` signal is not constructible without a verified channel. Every member of `PushRejection` is
reachable. A polling floor exists regardless of push.
**Proved by.** `google/tests/push/receiver.test.ts :: GOOG-P1: the first delivery is a handshake and never
triggers an ingest`; `google/tests/push/receiver.test.ts :: GOOG-P1: headers from the open internet decode
rather than throw`; `google/tests/push/receiver.test.ts :: GOOG-P1: a notification carries no events, so it
can never be coverage`; `google/tests/push/receiver.test.ts :: GOOG-P1: a changed signal is unconstructible
without a token the channel recognises`; `google/tests/push/receiver.test.ts :: GOOG-P1: a notification for
a channel nobody registered is refused before its state is read`.

### GOOG-I70. The channel token is verified in constant time against a stored hash

**Lesson.** The callback URL is public. The channel token is the only thing distinguishing a real Google
delivery from anyone else's POST, and a token compared with `===` against a stored plaintext copy leaks
both by timing and by database read.
**Learned from.** `https://developers.google.com/workspace/calendar/api/guides/push` (channel token);
user memory *fail loud on internal data*.
**Honoured by.** `src/push/secret.ts` stores only a SHA-256 hash and compares in constant time.
**Proved by.** `google/tests/push/secret.test.ts :: GOOG-P2: the presented token is compared against the
stored hash, never stored in the clear`; `google/tests/push/secret.test.ts :: GOOG-P2: a token that is
wrong in its first byte is refused`.

### GOOG-I71. The adapter owns no storage and expresses no type assertion

**Lesson.** Two of this repo's recurring failure modes are remote I/O inside a database transaction and a
`as SomeType` that quietly turned an absent field into a present one. An adapter that cannot reach a
database cannot hold a transaction open across a Google call, and a package with no assertions cannot lie
about what the SDK returned.
**Learned from.** `packages/calendar/src/core/sync-engine/ingest.ts` (remote I/O inside the transaction);
`fetch-events.ts` (the `start`/`end` guard that assumed a usable instant); commit `fdd9ba62`.
**Honoured by.** No module imports `@keeper.sh/database` and no module contains `as X`, `any` or
`@ts-ignore`; the narrowing happens once, in `src/decode/decode-event.ts`, through a discriminated union.
**Proved by.** `google/tests/hygiene/no-database.test.ts :: GOOG-H1: no module imports the database
package`; `google/tests/hygiene/no-database.test.ts :: GOOG-H1: no module reaches for a type assertion`;
`google/tests/hygiene/no-database.test.ts :: GOOG-H1: the contract is assembled from injected dependencies
alone`.

---

## Not applicable to sync-google

### GOOG-I51. Windows/CLDR timezone mapping — NOT APPLICABLE

**Lesson.** Windows identifiers ("Pacific Standard Time", "AUS Eastern Standard Time") arrive from
Microsoft-published feeds and must be mapped to IANA via the full CLDR table before zoning; partial
hand-rolled maps failed on the long tail.
**Learned from.** `packages/calendar/src/ics/utils/normalize-timezone.ts`;
`tests/ics/utils/outlook-windows-timezone.test.ts`; commits `ac6fa18c`, `7c276d8e`.
**Why not applicable.** Google Calendar states IANA zone ids on `start.timeZone`, so no Windows mapping is
needed on this path, and `@keeper.sh/sync-ical` already owns the CLDR table for the feeds that need it.
**What survives.** The validation half does apply and is adopted as GOOG-I28: a caller-supplied zone on a
write is validated as IANA rather than passed through.

### GOOG-I52. VTIMEZONE synthesis and observance projection — NOT APPLICABLE

**Lesson.** Resolving a wall time against projected VTIMEZONE observances put times in the hours before a
transition on the wrong side of it, because RRULE expansion of an observance drops its time-of-day.
**Learned from.** Commit `b057d2e0`; `packages/calendar/src/ics/utils/resolve-zoned-instants.ts`;
`tests/ics/utils/wall-time-*.test.ts`.
**Why not applicable.** Google's API is instant-based: `dateTime` is RFC 3339 with an offset, and there is
no VTIMEZONE to project. This package parses no iCalendar text at all; that layer is
`@keeper.sh/sync-ical`.

### GOOG-I53. Fall-back fold ambiguity — NOT APPLICABLE in form, adopted in rule

**Lesson.** A wall time in a fall-back fold names two instants and no zoned representation can disambiguate
them, so an instant in the second pass must be written in UTC. Keeper reads its own writes back, so the
error made a mirrored event near a DST boundary look moved and be deleted and re-created on every run,
forever.
**Learned from.** Commit `b057d2e0`; `packages/calendar/tests/ics/utils/timezone-instant.test.ts`.
**Why not applicable in form.** The adapter never resolves a wall time: it receives and sends instants.
**What survives.** The rule is restated so it is not lost: whenever a wall time plus a zone would be
ambiguous, `src/write/serialize.ts` sends the instant in UTC and states `timeZone` only as the display zone
Google should render in.

### GOOG-I54. All-day series re-anchoring and EXDATE/RECURRENCE-ID re-mapping — DEFERRED, recorded so it is not lost

**Lesson.** A DATE-valued series is floating per RFC 5545 §3.3.10, and Google states the calendar timezone
beside it. Expanding such a series in the master's stated zone moved every occurrence after a DST
transition off UTC midnight, and the whole-day snap then published it as a two-day span over a day its
predecessor already held. Re-anchoring a series onto UTC midnight must also re-map its EXDATEs, its
overrides' RECURRENCE-IDs and the rule's UNTIL — or a cancelled day comes back, a moved day double-books,
and the last day is trimmed.
**Learned from.** Commit `b057d2e0` *"expand an all-day series on the dates it names"*, *"carry recurrence
properties through re-anchoring"*; `tests/ics/utils/interpret-full-day-recurrence.test.ts`.
**Why deferred.** With `singleEvents: false` (GOOG-I19) this package never expands a recurrence rule. The
`RecurrencePayload` passes through opaque with `dialect: "rfc5545"`, and expansion belongs to whoever
already owns it. The rule is restated in full here so that adding expansion later cannot lose it: **any
re-anchoring must carry EXDATE, RECURRENCE-ID and UNTIL through the same transform as DTSTART.**

### GOOG-I55. Remote I/O outside database transactions — NOT APPLICABLE

**Lesson.** Remote I/O must stay outside database transactions, and a failed remote fetch must not wipe
existing events.
**Learned from.** Commits `0184ea19`, `1c5171d2` *"keep remote I/O outside database transactions"*.
**Why not applicable.** This adapter owns no database and opens no transactions. It returns listings and
write results; the persistence decision belongs to the caller. Recorded so a reviewer can confirm the
boundary was deliberate: the adapter never accepts a database handle as a dependency, and a hygiene test
asserts no `@keeper.sh/database` import.

### GOOG-I56. Postgres advisory locks — NOT APPLICABLE in mechanism, adopted in shape

**Lesson.** Ingest locks are advisory xact locks over a de-duplicated, sorted calendar id list, released by
transaction end whether the body returns or throws, with `statement_timeout` and
`idle_in_transaction_session_timeout` set so a wedged body cannot pin a connection.
**Learned from.** `packages/calendar/src/core/source/ingest-lock.ts`; commit `1c5171d2`.
**Why not applicable in mechanism.** No database, so no advisory locks.
**What survives.** The three properties are adopted in-process as GOOG-I32 and GOOG-I34: sorted
acquisition, release on throw, and a ceiling independent of the happy path.

### GOOG-I57. The batch endpoint and its chunk size — NOT APPLICABLE to v1

**Lesson.** Batch chunk size is 50, Google's documented ceiling; destination and cron ingestion share one
quota key because Google's quota is per user however it is spent.
**Learned from.** `packages/calendar/src/providers/google/shared/batch.ts`; commits `24dab764`, `f4b99005`.
**Why not applicable.** This adapter issues one request per operation behind an injected semaphore rather
than Google's multipart batch endpoint, which Google has deprecated for new use and which makes per-sub-
request error classification (GOOG-I25) materially harder. `capabilities.quotaScope` is `"perUser"`, so the
shared-quota lesson is carried by the injected limiter rather than by a batch module.

### GOOG-I58. `events.import` upsert-by-iCalUID — DELIBERATELY NOT RELIED UPON

**Lesson.** The prior art used `events.import` with a deterministic `iCalUID` for idempotency, and commit
`6b50aa27` explicitly flagged its upsert behaviour — especially resurrecting tombstoned UIDs — as
undocumented and unverified.
**Learned from.** `packages/calendar/src/providers/google/destination/provider.ts` (`buildPushRequest` and
its surviving comment); commit `6b50aa27`.
**Why not applicable.** `id` and `iCalUID` are mutually exclusive at creation, `events.import` carries
organizer-copy semantics we do not want, and the upsert behaviour is undocumented. The create path uses a
client-supplied deterministic `id` instead (GOOG-I40), which **is** documented as the idempotency
mechanism. Recorded so the reviewer can see the prior art's approach was rejected on evidence, not
overlooked.

---

## Dependencies taken and rejected

### GOOG-I59. Taken: `@googleapis/calendar@16.0.0`

The official generated client, scoped to one API rather than the umbrella `googleapis` package. It tracks
token refresh, pagination and retry semantics as the API changes, which a hand-rolled fetch wrapper does
not. Zero dependencies is explicitly **not** a goal for this package. Its own dependency is
`googleapis-common@^8`. Constructed once, with `retryConfig: { retry: 0 }`, an explicit `timeout` and an
injected `fetchImplementation` (GOOG-I38).

### GOOG-I60. Taken: `@keeper.sh/sync-protocol` (workspace)

The contract. Its types are imported, never redefined.

### GOOG-I61. Taken (dev): `@keeper.sh/sync-conformance` (workspace)

The acceptance criterion, wired before the adapter body is written.

### GOOG-I62. Rejected: the umbrella `googleapis` package

Same generated client, but pulls in every Google service. `@googleapis/calendar` is the scoped
distribution of exactly the same code.

### GOOG-I63. Rejected: a hand-rolled `fetch` wrapper over the REST API

Explicitly out of scope: the SDK's value is that it tracks the API's transport semantics over time. The
transport is injected (`fetchImplementation`), which gives hermetic tests without the maintenance burden of
owning the client.

### GOOG-I64. Rejected: `zod` / `arktype` re-validation of SDK responses

`@keeper.sh/data-schemas` carries `googleEventListSchema` for the hand-rolled path, but the SDK already
gives the shape. A second parse only adds a place for the two definitions to drift. The narrowing that
matters happens once, in `src/decode/decode-event.ts`, where `Schema$Event`'s `?: T | null` fields are
narrowed into a discriminated union — and the no-type-assertions rule makes that narrowing mandatory rather
than optional.

### GOOG-I65. Rejected: `ical.js`, `ts-ics`, `rrule`, `tsdav`, `node-ical`

This package talks JSON to Google and parses no iCalendar. `RecurrencePayload.value` passes through as an
opaque RFC 5545 string. Expansion and iCalendar text belong to `@keeper.sh/sync-ical`; CalDAV is a
different protocol.

### GOOG-I66. Rejected: `temporal-polyfill` / `@js-temporal/polyfill`

Temporal reached Stage 4 in March 2026 and ships unflagged in Node 26 and Chrome 144, but JavaScriptCore —
Bun's engine — has not shipped it (`bun -e 'console.log(typeof Temporal)'` prints `undefined` on the
installed Bun). A ~200KB polyfill in the hot path of every event decode buys nothing for a package whose
only time work is RFC 3339 and IANA zone names. `Date` plus `Intl` is enough. The migration cost stays
small because the domain time type is the protocol's `EventTime` discriminated union.

### GOOG-I67. Bun, vitest, and the injected hash

The test script is `TZ=UTC bun x --bun vitest run`, never bare `bun test` — the wrong runner produces bogus
`vi.hoisted is not a function` errors. Every delay in the package is `setTimeout`-based through the
injected clock, because `Bun.sleep` is a native primitive `vi.useFakeTimers` cannot patch; that lesson cost
this team real CI time. `Bun.CryptoHasher` is the default hash, but it arrives as a constructor argument so
no module imports a dependency it uses — `verifyChannelToken` takes the digest as a parameter like every
other hashing site in the package, and no `src/` module reaches for the ambient `Bun` global.

---

## The test id scheme

`GOOG-O*` is the overwrite family and `GOOG-L*` is the lockup family, mirroring the conformance suite's own
`CONF-O*`/`CONF-L*` split. Each id appears verbatim at the start of the test name that proves it and in the
**Proved by** line of the entry it enforces, so `google/tests/hygiene/ledger-citations.test.ts` can walk
this section against the suite mechanically, exactly as `conformance/tests/hygiene/ledger-citations.test.ts`
does for its own.

The conformance run itself is one file, `google/tests/conformance.test.ts`, which calls
`runConformance({ describe, it }, ...)`. Its case titles carry the `CONF-` ids unchanged; entries above cite
those ids directly where the suite already proves the property, and add a `GOOG-` test only where the
adapter has behaviour the suite cannot see — id encoding, header decoding, error classification, SDK
defaults and the Google-specific shapes of the listing pipeline.

## Module map

```
src/index.ts                        the public surface and nothing else
src/capabilities.ts                 googleCapabilities: the as const Capabilities<"google">
src/contract.ts                     createGoogleContract -> ProviderContract<"google">
src/provider.ts                     createGoogleProvider -> CalendarProvider<"google">
src/dependencies.ts                 GoogleDependencies: client, clock, gate, hash, installation, limits
src/limits.ts                       googleLimits as const: maxResults, maxPages, coverage ceiling
src/fingerprint.ts                  RFC 8785 canonical encoding fed to the injected hash
src/canonical.ts                    the sorted-key encoder every fingerprint and key is built from
src/internals.ts                    assembles semaphore, seam, single flight and cursor frontier once
src/conformance-obligations.ts      the seven ConformanceObligation implementations

src/client/calendar-client.ts       builds calendar_v3.Calendar: retry 0, explicit timeout, injected fetch
src/client/request.ts               the one seam: gate -> permit -> deadline -> retry -> classify
src/client/deadline.ts              mergeSignals, raceDeadline — the only place an await gets a ceiling
src/client/backoff.ts               bounded, abortable retry over the injected clock.sleep (GOOG-I77)
src/client/semaphore.ts             permits, released on return, on throw and on abort
src/client/single-flight.ts         coalescing by listing scope; own-entry release; failure fan-out

src/errors/gaxios-error.ts          total decoder from unknown to { status, reasons, retryAfter }
src/errors/classify.ts              (status, reasons, operation) -> GoogleFailure, an as const union
src/errors/gate-failure.ts          a failure the injected gate carried, read before classification
src/errors/to-provider-failure.ts   GoogleFailure -> ProviderFailure, switched exhaustively

src/cursor/cursor.ts                mint and parse the owned opaque cursor; cursorVersion
src/cursor/fingerprint.ts           the request-shape fingerprint the cursor is bound to

src/listing/list-changes.ts         the orchestration and the one producer of cursorLost
src/listing/build-feed.ts           collapsed items -> events, removals, withheld, self-authored
src/listing/request-shape.ts        as const parameter records per listing mode; singleEvents false
src/listing/paginate.ts             bounded pagination: page ceiling, loop deadline, PageWalk union
src/listing/collapse-revisions.ts   same id across pages; newest updated wins; unbuildable withholds
src/listing/assemble-series.ts      master and RECURRENCE-ID overrides, order-independent
src/listing/coverage.ts             provenCoverage — clamped, never the requested window
src/listing/diagnostics.ts          bounded samples beside exact totals; identifiers only

src/decode/decode-event.ts          Schema$Event -> cancelled | patch | undecodable
src/decode/event-time.ts            start/end -> EventTime; allDay and timed never collapse
src/decode/recurrence.ts            opaque RRULE/EXDATE passthrough and the RecurrenceAnchor
src/decode/identity.ts              RemoteEventId, DeleteHandle, EventUid, RemoteVersion from etag
src/decode/provenance.ts            extendedProperties.private and the deterministic id
src/decode/event-type.ts            Google eventType as const map, exhaustive
src/decode/cancellation.ts          status cancelled versus confirmed and tentative

src/window/membership.ts            withinGoogleWindow — the one window predicate, exported

src/write/write.ts                  the write orchestration, switched over WriteIntent.kind
src/write/create.ts                 deterministic id; 409 is alreadyExists
src/write/update.ts                 one conditional patch with If-Match
src/write/delete.ts                 410 and 404 are alreadyAbsent
src/write/normalize.ts              the one shaping seam: range, all-day grid, content projection
src/write/serialize.ts              EditableContent -> Schema$Event body; writes what it is handed
src/write/event-id.ts               base32hex deterministic id, length-checked at the boundary
src/write/precondition.ts           RemoteVersion <-> etag, If-Match, 412 -> typed conflict
src/write/echo.ts                   the three-state EchoVerdict from the returned body
src/write/remote.ts                 reads the copy a 409 or a 412 names: version and fingerprint
src/write/surroundings.ts           WriteSurroundings, so the write modules share no cycle

src/calendars/list-calendars.ts     tolerant enumeration; absent items, absent summary

src/push/profile.ts                 as const lifetime and renewal profile; recreate, never extend
src/push/watch.ts                   register, renew as register-new-then-stop-old, stop
src/push/receiver.ts                decodePushSignal(headers) -> PushSignal; total over any headers
src/push/secret.ts                  timing-safe channel token verification
```

## Public API

```ts
interface GoogleDependencies {
  readonly calendar: calendar_v3.Calendar
  readonly clock: {
    readonly now: () => Instant
    readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  }
  readonly gate: <Value>(
    operation: OperationName,
    execute: () => Promise<Value>,
  ) => Promise<Value>
  readonly hash: (input: string) => string
  readonly installation: InstallationId
  readonly concurrency: number
  readonly randomId: () => string
}

const createGoogleClient: (options: {
  readonly fetch: typeof fetch
  readonly auth: OAuth2Client
  readonly timeoutMs: number
}) => calendar_v3.Calendar

const createGoogleProvider: (dependencies: GoogleDependencies) => CalendarProvider<"google">

const createGoogleContract: (dependencies: GoogleDependencies) => ProviderContract<"google">

const googleCapabilities: Capabilities<"google">

const withinGoogleWindow: WindowMembership

const decodePushSignal: (headers: Headers) => PushSignal

type PushSignal =
  | { readonly kind: "handshake" }
  | { readonly kind: "changed"; readonly channelId: string; readonly resourceId: string }
  | { readonly kind: "unrecognised"; readonly reason: PushRejection }

const verifyChannelToken: (presented: string, storedHash: string) => boolean

const registerWatchChannel: (
  request: WatchRequest,
  context: OperationContext,
) => Promise<Result<WatchChannel>>

const stopWatchChannel: (
  channel: WatchChannel,
  context: OperationContext,
) => Promise<Result<{ readonly kind: "stopped" } | { readonly kind: "alreadyGone" }>>
```

`googleCapabilities` is the declaration the conformance suite gates on, and every field is a promise the
adapter keeps:

```ts
const googleCapabilities = {
  provider: "google",
  delta: { kind: "tokenized", windowBoundToCursor: true },
  deletionAuthority: "snapshotAbsence",
  removalsAreAmbiguous: false,
  precondition: "matchesVersion",
  provenanceChannel: "extendedProperty",
  quotaScope: "perUser",
  throttleSignals: [
    { status: 403, hasRetryAfter: false },
    { status: 429, hasRetryAfter: true },
  ],
  representableRange: {
    minimumSpanSeconds: 0,
    zeroDuration: "reject",
    invertedRange: "reject",
    allDayGrid: "utcDay",
  },
  allDay: "dateOnly",
  recurrenceWrite: "rfc5545",
  echoesWrites: true,
} as const satisfies Capabilities<"google">
```

`windowBoundToCursor: true` is forced by GOOG-I5: `syncToken` forbids `timeMin`/`timeMax`, so a cursor is
only meaningful under the window that minted it. `deletionAuthority: "snapshotAbsence"` is honest because a
full listing bounded by `timeMin`/`timeMax` really does prove that window, and `removalsAreAmbiguous: false`
is honest because Google names its cancellations. Both are gates the suite branches on, so declaring them
wrongly selects a different — and stricter, or wrong — set of cases rather than skipping any.

## Test index

The conformance run is the acceptance gate: `google/tests/conformance.test.ts` runs all forty-six `CONF-O`
and thirteen `CONF-L` cases against an in-memory Google built on the injected `fetch`, seeded through
`ProviderUnderTest.seed`. `google/tests/support/fake-google.ts` is that in-memory server: it speaks
`events.list`, `events.insert`, `events.patch`, `events.delete`, `calendarList.list` and `events.watch` over
`fetch`, and it is the only place the suite's `ProviderSeed` is translated into Google JSON.

Adapter-local `GOOG-` tests cover only what the suite cannot see from outside the protocol boundary: the
base32hex id encoding, push header decoding, error classification against real gaxios error shapes, the SDK
default-hardening assertion, the pagination ceiling, the series-assembly order independence, and the
hygiene rules (one window predicate, no `Bun.sleep`, no database import, no type assertions).

The families are `GOOG-O*` (overwrite), `GOOG-L*` (lockup), `GOOG-P*` (push, `tests/push/`), `GOOG-H*`
(hygiene, `tests/hygiene/`) and `GOOG-C1` (the conformance gate's own selection check).

## Red phase addendum (sync-google)

The suite was written before the implementation. Every module named in the module map exists with its real
signature and a body that calls `unimplemented(...)`, so a failing test fails on behaviour rather than on a
missing module. The sentinel takes the enclosing function's arguments purely so the red phase lints clean;
it disappears when each body is written.

Eleven of the two hundred tests are green in the red phase, and each is green for a stated reason rather
than by accident:

- **Four type-level assertions** in `google/tests/writes/precondition-required.test-d.ts`. The guarantee is
  structural and was delivered by `@keeper.sh/sync-protocol`: an unconditional update is unrepresentable.
  The adapter's obligation is only never to widen it, which is what the file asserts against
  `WriteIntent<"google">`. A test of an already-true structural fact cannot be made red honestly.
- **Three ledger-walk assertions** in `google/tests/hygiene/ledger-citations.test.ts`. They compare this
  document against the file names and test names in the suite. They were red until the ledger and the suite
  agreed, which is exactly their job; they stay green from then on.
- **Three static source scans** (`no-database` ×2, `no-bun-sleep` ×1). Each shares a file with a behavioural
  anchor that is red, so a scan cannot pass on an empty or absent package.
- **One `as const` declaration check** on `googleWatchProfile`. Like `googleCapabilities` and
  `googleListingLimits`, the profile is a declaration the conformance run needs at planning time, so it is
  real from the start.

The one remaining non-`unimplemented` failure is `GOOG-L1: every delay in the package goes through the
injected clock`, which fails because no module yet calls `clock.sleep`. It names its own reason.

## Green phase addendum (sync-google)

The implementation forced eleven decisions the design did not settle, and turned up five defects in the
material the adapter was written against. Every one is recorded here with the code and the test that hold it.

### GOOG-I72. The mirrored identity travels in an extended property, never in `iCalUID`

An event we author has to come back out of Google carrying the identity we mirrored, or the next run reads
it as a stranger. `iCalUID` is not the channel for that: `events.insert` does not honour a submitted
`iCalUID` (only `events.import` does, and GOOG-I58 rejects `import`), so Google would hand back
`<eventId>@google.com` and the mapping would be lost. The write stamps
`extendedProperties.private["keeper.sh/uid"]` beside the installation stamp, and `decodeIdentity` prefers it
over `iCalUID`. This is the channel the capability declaration already names
(`provenanceChannel: "extendedProperty"`), so it costs no new mechanism. `src/decode/identity.ts`,
`src/write/serialize.ts`; held by the conformance run's `CONF-O16` and `CONF-O36`.

### GOOG-I73. `revision` is the first integer in the etag, and an update never restamps the provenance

`RemoteEventFacts.revision` needs a number that increases with every change of an identity. Google's etag is
derived from the update time, so the first integer in it does; nothing else in the payload does (`sequence`
is the publisher's RFC 5545 SEQUENCE and is absent from most events). `revisionOfVersion` reads that integer
and defaults to `1`. Relatedly, `events.patch` is a merge, so an update sends **no** `extendedProperties` at
all: restamping them on every edit would overwrite the mirrored uid of GOOG-I72 with whatever the caller
happened to be holding. `src/decode/identity.ts`, `src/write/update.ts`.

### GOOG-I74. A superseded cursor is refused before the network, from an in-process frontier

A cursor the adapter has already replaced must not be replayed: the pages it names have been consumed, and a
delta taken from it would read against a base that no longer exists. The adapter owns the cursor, so it can
refuse one locally. `createCursorFrontier` holds the most recently minted value per request-shape
fingerprint; a cursor that is readable but is not the current frontier is answered `cursorLost` with no
request spent. The frontier advances only on the last page's success, so a failed run cannot move it
(GOOG-I9). `src/internals.ts`, `src/listing/list-changes.ts`; held by `CONF-O10` and `CONF-O24`.

### GOOG-I75. The injected gate may answer with a typed failure of its own, and the seam honours it

`GoogleDependencies.gate` is our code, not Google's: a quota gate can refuse a call before it is ever sent,
and it refuses with a `ProviderFailure`, not with a Gaxios error. `gateFailureOf` reads a carried
`failure.kind` off a rejection and maps it into the adapter's own failure vocabulary before
`classifyGoogleError` is consulted. Without it, a gate that refuses with `rateLimited` would be classified
from a status that was never set. `src/errors/gate-failure.ts`; held by `CONF-O23` and `CONF-L1`.

### GOOG-I76. `Retry-After` is only read when it names an instant

`decodeGaxiosError` is pure and has no clock, so it cannot turn `Retry-After: 30` into an instant. It reads
a retry-after that already names an instant, or an HTTP-date, and otherwise reports `null`. Nothing is lost
in practice: `retryDelayMs` clamps every provider-supplied delay to `retryBudget.retryDelayCeilingMs`, so a
delta-seconds value would have been clamped to the same ceiling the exponential fallback produces. The
capability declaration says `403` carries no retry-after and `429` does, and the classifier answers exactly
that. `src/errors/gaxios-error.ts`, `src/errors/classify.ts`; held by
`google/tests/errors/hostile-bodies.test.ts :: GOOG-O24: the status is read before anything can redact it`
and by `CONF-O46`.

### GOOG-I77. The retry delay is exponential under the budget's ceiling, and deliberately not jittered

The delay is `min(ceiling, max(0, retryAfter - now))` when the provider named a time, and
`min(ceiling, 100ms * 2^(attempt-1))` otherwise. There is no jitter: the only injected source of randomness
is `randomId`, which is reserved for channel identifiers, and inventing a second one would add a dependency
the ceiling already makes unnecessary at this concurrency. The property that matters — that a hostile
`Retry-After` cannot outlast the budget — is the one under test. `src/client/backoff.ts`; held by
`google/tests/lockups/retry-ceiling.test.ts :: GOOG-L1: a Retry-After in the next century cannot outlast the delay ceiling`.

### GOOG-I78. A 409 on create is resolved by reading the id that is taken

Google's 409 says only that the client-supplied id exists; it does not say whether what is there is what we
were about to write. Answering `alreadyExists` blindly would hide a user's concurrent edit, and answering
`conflict` blindly would stall an idempotent replay forever. `resolveDuplicate` reads the taken id once and
compares its normalised fingerprint against the submitted one: equal is `alreadyExists`, different is a
typed `conflict` carrying the version the calendar actually holds. Google's own advice — generate a new id —
stays rejected (GOOG-I40). `src/write/create.ts`; held by
`google/tests/writes/idempotent-create.test.ts :: GOOG-O14: a differing create against a taken id is refused, never blindly recreated`
and by `CONF-O14`, `CONF-O15`, `CONF-O20` and `CONF-O21`.

### GOOG-I79. A recurring event is always in scope, because nothing here expands it

`withinGoogleWindow` judges a single occurrence. With `singleEvents: false` the adapter never sees a series'
occurrences, so it cannot decide membership for one — and judging the series by its anchor would drop a
weekly series whose anchor predates the window. A decoded series is therefore always reported and never
becomes an `outOfScope` removal. The rule the predicate does own is unchanged and still lives in one module.
`src/listing/build-feed.ts`; held by `google/tests/listing/series-assembly.test.ts` and `CONF-O36`.

### GOOG-I80. `outOfOffice` mirrors as free, `workingLocation` is withheld, and transparency wins

`verdictForEventType` gives every published `eventType` a mirrored availability or a refusal;
`workingLocation` is withheld because a working-location block is not an appointment and the user could not
delete it from Keeper. When the event carries an explicit `transparency` that value wins, because the
publisher said it outright. An `eventType` Google has not published yet is `null` from `readEventType` and
the item is withheld — never silently `busy`. `src/decode/event-type.ts`, `src/decode/decode-event.ts`;
held by `google/tests/decode/event-type.test.ts :: GOOG-O27: an event type Google has not published is unrecognised, never busy`.

### GOOG-I81. A spent precondition is a `WriteOutcome`, not a transport failure

The protocol carries `conflict` twice: as a `WriteOutcome` with the remote reference and the observed
precondition, and as a `ProviderFailure` with the precondition alone. A conditional write that lost is a
completed operation with an answer, not a failed one, and the richer arm is the one that lets a caller retry
against the version it now knows. Every write path answers `{ ok: true, value: { kind: "conflict" } }`.
`src/write/update.ts`, `src/write/delete.ts`, `src/write/create.ts`; held by
`google/tests/writes/stale-precondition.test.ts :: GOOG-O39: the conflict carries the version the calendar actually holds`.

### GOOG-I82. A deadline is measured on the injected clock, not on the caller's `now`

`OperationContext` carries both a `deadline` and a `now`. The adapter measures its remaining budget with
`dependencies.clock` — the same clock whose `sleep` arms the deadline — so the two can never disagree, and a
caller cannot hand the adapter a frozen `now` that makes every deadline infinite. `src/client/deadline.ts`,
`src/listing/paginate.ts`; held by `CONF-L13`.

### Defects found in the material the adapter was written against

Three in `@keeper.sh/sync-conformance` and two in this package's own test support. All five are fixed in
place; the conformance package's own 309 tests, including its 119 negative controls, still pass.

1. **`CONF-O25`, `CONF-O36`, `CONF-O39` and `CONF-O44` fabricated provider identities.** They addressed the
   object a create had just made as `id-<idempotencyKey>` and `handle-<idempotencyKey>` — the reference
   provider's private convention. No provider whose identifiers are assigned server-side can satisfy that,
   and Google's are: the id is the client-supplied base32hex value and the delete handle is the same id. The
   cases now use the `RemoteRef` the create returned, which is identical for the reference provider and
   correct for every other one.
2. **`CONF-O39` demanded the failure arm of a conflict.** `CONF-O15` and `assertConflictNotOverwrite` both
   accept either arm; only `CONF-O39` insisted on `!ok`. It now accepts either, exactly as `CONF-O15` does,
   which keeps the property — never a silent second write — and drops the accidental one.
3. **`CONF-O27` contradicted `CONF-O5`.** It required every event the window predicate admits to appear in
   `listing.events`, ignoring the withheld arm — so an adapter that withholds a zero-duration event, which
   `CONF-O28` requires of any adapter declaring `zeroDuration: "reject"`, could not pass both. It now counts
   presence the way `CONF-O1` already did, over events *and* withheld identities.
4. **The fake Google kept vanished events instead of tombstoning them.** `ProviderSeed` is the provider's
   whole state, so an identity dropped from a later seed has been deleted. Google reports that as a
   `status: "cancelled"` item under `showDeleted: true`, and the fake now does the same: it replaces its feed
   and leaves a tombstone behind, keeping the `iCalUID` so the cancellation stays attributable. It also
   stores its feed as an ordered list rather than a map, because a real listing can carry the same id twice
   across pages — which is the whole point of `collapse-revisions`.
5. **The fake Google answered no `events.get`, and its OAuth2 client carried no credentials.** The client
   threw `No access, refresh token, API key or refresh handler callback is set` before any request reached
   the fake; it is now given an access token. The missing `events.get` handler made every 409 and 412
   resolution fail as a transport error.
