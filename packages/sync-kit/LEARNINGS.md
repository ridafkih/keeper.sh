# sync-kit learnings ledger

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
