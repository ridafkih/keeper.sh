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
