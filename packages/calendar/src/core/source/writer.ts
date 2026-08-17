interface SourceEventUpdate {
  description?: string;
  endTime?: Date;
  isAllDay?: boolean;
  location?: string;
  startTime?: Date;
  startTimeZone?: string;
  summary?: string;
}

/*
 * A refusal is not a failure. The provider was reachable and the write was understood; it
 * was declined because applying it would reach past the user, and no retry can change that.
 */
type SourceWriteRefusal =
  | "event_authored_by_someone_else"
  | "event_body_is_rich_text"
  | "event_has_attendees";

interface SourceWriteResult {
  error?: string;
  /*
   * The request left, and no answer came back. Every status the provider can return says
   * what it did with the write; a socket that dies mid-flight says nothing, so a delete
   * reported this way may already have destroyed the real event. The record of it must
   * stand until a later read settles it.
   */
  indeterminate?: boolean;
  refused?: SourceWriteRefusal;
  retryable?: boolean;
  success: boolean;
}

/*
 * A throttle, a gateway failure and a request that timed out are the provider saying "not
 * right now". They are indistinguishable from a permanent refusal once the status is
 * discarded, and the pass that cannot tell them apart spends its failure budget on a few
 * throttled minutes, reverts the pair to one-way and discards the edit the user made on
 * the copy — over an outage that would have cleared on its own. The write is retried
 * instead; it is still counted, on a longer budget, so a provider that never recovers
 * still ends in a paused pair the user is told about rather than in a silent forever loop.
 */
const REQUEST_TIMEOUT = 408;
const TOO_EARLY = 425;
const TOO_MANY_REQUESTS = 429;
const PRECONDITION_FAILED = 412;
const INTERNAL_SERVER_ERROR = 500;
const BAD_GATEWAY = 502;
const SERVICE_UNAVAILABLE = 503;
const GATEWAY_TIMEOUT = 504;

/*
 * A CalDAV etag no longer matching is the same kind of answer: the object moved under the
 * write, and the next pass reads it again and writes against what is there now.
 */
const RETRYABLE_WRITE_STATUSES: ReadonlySet<number> = new Set([
  REQUEST_TIMEOUT,
  PRECONDITION_FAILED,
  TOO_EARLY,
  TOO_MANY_REQUESTS,
  INTERNAL_SERVER_ERROR,
  BAD_GATEWAY,
  SERVICE_UNAVAILABLE,
  GATEWAY_TIMEOUT,
]);

const isRetryableWriteStatus = (status: number): boolean =>
  RETRYABLE_WRITE_STATUSES.has(status);

const UNAUTHORIZED = 401;

/*
 * On a provider signed in by OAuth, 401 means the bearer token was stale — and that is the
 * one write failure a retry provably fixes. The writer is rebuilt from the credential row
 * on every pass, so a rotation by a concurrent refresh, a revoke-and-regrant or a
 * reconnected account clears it by itself. Spending it on the permanent budget instead
 * reverts the pair to one-way inside five passes, discards the edit the user made on the
 * copy, and — unlike a lapsed plan — nothing ever turns two-way back on. It is still
 * counted, on the longer budget, so a grant that never comes back still ends in a paused
 * pair the user is told about.
 *
 * It is deliberately not the rule for CalDAV: there the credential is a password the user
 * stored, no refresh exists to fix it, and asking again with the same password cannot
 * change the answer. That one has to pause quickly, with something the user can act on.
 */
const isRetryableOAuthWriteStatus = (status: number): boolean =>
  status === UNAUTHORIZED || isRetryableWriteStatus(status);

/*
 * The flag is carried only when it is true, so a failure nothing can retry keeps the exact
 * shape it has always had and reads as the plain answer it is.
 */
const toWriteFailure = (error: string, retryable: boolean): SourceWriteResult => ({
  error,
  ...(retryable && { retryable: true }),
  success: false,
});

/*
 * A connection reset, a DNS blip, a read that timed out on this side: the write was sent
 * and no status came back. It is the same "not right now" a 503 is — the difference is
 * only that the provider never got to say it — so it must be answered the same way, and
 * never thrown. An exception out of a writer is spent as a permanent defect: five of them
 * revert the pair to one-way, discard the edits the user made on the copies, and nothing
 * retries once the pair is off. It is marked indeterminate as well as retryable, because
 * unlike a status this answer cannot say whether the source event survived.
 */
const toTransportWriteFailure = (error: unknown, fallback: string): SourceWriteResult => ({
  error: (error instanceof Error && error.message) || fallback,
  indeterminate: true,
  retryable: true,
  success: false,
});

/*
 * Stated once so the three writers cannot drift apart under it: the final write is the
 * one call whose exception nothing else on the path can interpret.
 */
const attemptSourceWrite = async <Sent>(
  send: () => Promise<Sent>,
  fallback: string,
): Promise<{ failure: SourceWriteResult } | { sent: Sent }> => {
  try {
    return { sent: await send() };
  } catch (error) {
    return { failure: toTransportWriteFailure(error, fallback) };
  }
};

interface CalendarSourceWriter {
  deleteEvent: (
    reference: { sourceEventId: string | null; sourceEventUid: string },
    signal?: AbortSignal,
  ) => Promise<SourceWriteResult>;
  updateEvent: (
    reference: { sourceEventId: string | null; sourceEventUid: string },
    updates: SourceEventUpdate,
    signal?: AbortSignal,
  ) => Promise<SourceWriteResult>;
}

const ATTENDEE_REFUSAL: SourceWriteResult = {
  error: "Keeper.sh does not write to a source event other people are invited to.",
  refused: "event_has_attendees",
  success: false,
};

const UNREADABLE_ATTENDEE_REFUSAL: SourceWriteResult = {
  error:
    "Keeper.sh could not read the guest list on the source event, so it did not write to it.",
  refused: "event_has_attendees",
  success: false,
};

/*
 * Who a write would reach besides the user. "Nobody else" is the only answer that lets it
 * through, and it is an answer about the event, never about the account: an entry that
 * names the organizer names the person already holding the event, so an event whose only
 * ATTENDEE is its own ORGANIZER notifies no one. Reading it that way needs no address for
 * the account, which is what lets a CalDAV server that signs the user in by a bare username
 * answer the same as the other two.
 */
type SourceEventAudience = "no_one_else" | "others" | "unreadable";

/*
 * The one refusal on this path that is irreversible for somebody other than the user:
 * moving or cancelling a meeting mails everyone invited, and no answer afterwards recalls
 * that. Every other write is the user's own data and the provider's grant is what decides
 * it — the server already answered whether this account may write here, and every native
 * client acts on that answer.
 *
 * It is decided on the guest list the writer can see, and it deliberately does not ask who
 * the account is. A CalDAV server that signs the user in by a bare username gives no
 * address to weigh anything against, so that question has no answer there — and a question
 * that cannot be answered must never itself become a refusal, which is what withheld
 * two-way sync from those servers entirely.
 *
 * "Unreadable" is a different thing from an unidentifiable account and is refused: an event
 * whose guest list the writer could not follow — an ICS whose sub-component never closes, a
 * representation the provider itself marks as partial — may carry guests, and destroying it
 * mails them. The rule is stated once so the three providers cannot drift apart under it.
 */
const refuseWhenOthersAreInvited = (
  event: { audience: SourceEventAudience },
): SourceWriteResult | null => {
  switch (event.audience) {
    case "no_one_else": {
      return null;
    }
    case "others": {
      return ATTENDEE_REFUSAL;
    }
    default: {
      return UNREADABLE_ATTENDEE_REFUSAL;
    }
  }
};

/*
 * What a write reaches beyond the user, named once. Permission is asked per consequence
 * rather than per verb, because the verb does not say who hears about it: deleting a solo
 * event is the user's own business, and moving a meeting mails everyone on it.
 *
 * "foreign_event" is the one answer no grant widens. A calendar a colleague shared carries
 * their bookings, and the provider's write grant says the account may write there — it does
 * not say the event is the user's to destroy.
 */
type SourceWriteConsequence = "foreign_event" | "own_event" | "shared_event";

const resolveConsequence = (event: {
  audience: SourceEventAudience;
  authorship: SourceEventAuthorship;
}): SourceWriteConsequence => {
  if (event.authorship === "someone_else") {
    return "foreign_event";
  }
  if (event.audience === "no_one_else") {
    return "own_event";
  }
  return "shared_event";
};

const AUTHORSHIP_REFUSAL: SourceWriteResult = {
  error: "Keeper.sh does not write to a source event somebody else created.",
  refused: "event_authored_by_someone_else",
  success: false,
};

/*
 * Who put the event on the calendar. "Unknown" is the honest answer wherever the provider
 * names no author, or the account is signed in without an address to weigh one against —
 * a CalDAV login by bare username — and it is deliberately not a refusal: a question that
 * cannot be answered must never become one, which is what withheld two-way sync from
 * those servers entirely.
 */
type SourceEventAuthorship = "someone_else" | "the_account" | "unknown";

/*
 * A calendar a colleague shared with write access is the one place a source write reaches
 * past the user with no guest on the event at all. The provider's grant says the account
 * may write there; it does not say the event is the user's to destroy, and deleting a
 * colleague's booking is as irreversible for them as cancelling a meeting is for its
 * guests. What acts here is a mirror concluding on its own that a copy went missing, not a
 * person clicking delete in a native client, so the answer when the event is provably
 * somebody else's is to leave it alone and tell the user why.
 *
 * Only a provable answer refuses. Where the author cannot be established the write goes
 * through exactly as before, so no account that works today stops working.
 */
const refuseWhenSomebodyElseAuthoredIt = (
  event: { authorship: SourceEventAuthorship },
): SourceWriteResult | null => {
  if (event.authorship === "someone_else") {
    return AUTHORSHIP_REFUSAL;
  }
  return null;
};

/*
 * How far a write may reach, in one order, each level including the ones before it. The
 * order is blast radius and nothing else: whose data the write touches, and how many
 * people hear about it.
 *
 * It is deliberately separate from the mode. The mode says which verbs are allowed, this
 * says who they may be aimed at, and the two compose: reach at "any_event" with mode
 * "edits" may change a colleague's event and may never delete one.
 */
const WRITE_BACK_REACH_LEVELS = [
  "own_events",
  "my_meetings",
  "my_meetings_notifying",
  "any_event",
] as const;

type WriteBackReach = typeof WRITE_BACK_REACH_LEVELS[number];

const isWriteBackReach = (value: string): value is WriteBackReach =>
  WRITE_BACK_REACH_LEVELS.includes(value as WriteBackReach);

const reachRank = (reach: WriteBackReach): number =>
  WRITE_BACK_REACH_LEVELS.indexOf(reach);

const reaches = (granted: WriteBackReach, needed: WriteBackReach): boolean =>
  reachRank(granted) >= reachRank(needed);

/*
 * Which writes the people on a meeting hear about. A time that moved and an event that was
 * cancelled are mailed to every attendee; a retitled meeting shows the new title the next
 * time they look and sends nothing. The split exists so the permission that notifies people
 * can be withheld without withholding the one that does not.
 */
const notifiesAttendees = (write: {
  isDelete: boolean;
  updates?: SourceEventUpdate;
}): boolean => {
  if (write.isDelete) {
    return true;
  }
  const updates = write.updates ?? {};
  const NOTIFYING_FIELDS = ["startTime", "endTime", "isAllDay", "startTimeZone"] as const;
  return NOTIFYING_FIELDS.some((field) => field in updates);
};

/*
 * The single gate every provider asks. The refusal keeps naming which question it answers:
 * a guest list that was read and had people on it reads differently to one that could not
 * be read at all, and an event somebody else created reads differently again.
 */
const neededFor = (write: {
  isDelete: boolean;
  updates?: SourceEventUpdate;
}): WriteBackReach => {
  if (notifiesAttendees(write)) {
    return "my_meetings_notifying";
  }
  return "my_meetings";
};

const refuseWhenOutOfReach = (
  event: {
    audience: SourceEventAudience;
    authorship: SourceEventAuthorship;
    isDelete: boolean;
    updates?: SourceEventUpdate;
  },
  granted: WriteBackReach,
): SourceWriteResult | null => {
  const consequence = resolveConsequence(event);
  if (consequence === "foreign_event") {
    if (reaches(granted, "any_event")) {
      return null;
    }
    return AUTHORSHIP_REFUSAL;
  }
  if (consequence === "own_event") {
    return null;
  }
  if (reaches(granted, neededFor(event))) {
    return null;
  }
  if (event.audience === "unreadable") {
    return UNREADABLE_ATTENDEE_REFUSAL;
  }
  return ATTENDEE_REFUSAL;
};

/*
 * Every provider reports its guest list differently and none of them reports it as an
 * address the account can be recognised by, so each writer normalises to plain addresses
 * and the decision itself is made here, once.
 */
const MAILTO_PREFIX = /^mailto:/u;
const NO_OTHER_GUESTS = 0;

const normalizeAttendeeAddress = (address: string | null | undefined): string =>
  (address ?? "").trim().toLowerCase().replace(MAILTO_PREFIX, "");

const resolveAudience = (input: {
  attendees: readonly { address?: string | null; isAccount?: boolean }[];
  organizer: string | null | undefined;
}): SourceEventAudience => {
  const organizer = normalizeAttendeeAddress(input.organizer);
  const others = input.attendees.filter((attendee) => {
    if (attendee.isAccount === true) {
      return false;
    }
    const address = normalizeAttendeeAddress(attendee.address);
    return address === "" || address !== organizer;
  });
  if (others.length > NO_OTHER_GUESTS) {
    return "others";
  }
  return "no_one_else";
};

/*
 * The account's own address is the only thing an author can be weighed against, and some
 * of the accounts Keeper.sh holds have none. isAccount is the provider answering a NEARBY
 * question — Google's creator.self, Graph's isOrganizer — and both of them answer it about
 * the calendar the copy sits on, not about the signed-in account: creator.self is "whether
 * the creator corresponds to the calendar on which this copy of the event appears", and
 * isOrganizer is "true if the calendar owner is the organizer". On a calendar a colleague
 * shared with write access the owner is the colleague, so every booking they make on it
 * carries the flag — which is exactly the event the refusal exists for. So the flag stands
 * in only where nothing can contradict it, and two addresses that provably disagree do.
 * It is still believed only when it says yes: a missing "yes" is not a "no" on either
 * provider.
 *
 * Both sides have to be addresses before either is weighed. A provider that answers the
 * account's sign-in with a display name and no address is stored under that name, and
 * comparing "John Smith" with an author's address answers "somebody else" for every event
 * on the calendar — pausing a connection where nothing is wrong, on a question that was
 * never actually asked.
 *
 * An author who is not the account is only somebody else when the event is somebody else's.
 * A scheduling app, an assistant or a booking integration writing onto the user's own
 * calendar stamps its own service address into the author field while the event itself is
 * held by the account — the provider names the account as the event's owner — and that
 * event is the user's to edit in every native client they have. So an owner the account
 * matches settles the question before the author is weighed. It is a narrower answer than
 * it looks: on a colleague's shared calendar the owner is the colleague, never the account,
 * so a colleague's booking is still refused.
 */
const IS_ADDRESS = /^[^\s@]+@[^\s@]+$/u;

const resolveAuthorship = (input: {
  account: string | null | undefined;
  author: string | null | undefined;
  isAccount?: boolean;
  owner?: string | null | undefined;
}): SourceEventAuthorship => {
  const account = normalizeAttendeeAddress(input.account);
  const author = normalizeAttendeeAddress(input.author);
  const addressesDisagree =
    IS_ADDRESS.test(account) && IS_ADDRESS.test(author) && account !== author;
  if (input.isAccount === true && !addressesDisagree) {
    return "the_account";
  }
  if (IS_ADDRESS.test(account) && account === normalizeAttendeeAddress(input.owner)) {
    return "the_account";
  }
  if (!IS_ADDRESS.test(account) || !IS_ADDRESS.test(author)) {
    return "unknown";
  }
  if (account === author) {
    return "the_account";
  }
  return "someone_else";
};

/*
 * Outlook hands Keeper.sh every body as text, so a body that carries markup was never
 * stored and cannot be reconstructed. Writing the text projection back replaces the real
 * event's links, formatting and the join block a meeting provider wrote into it, with
 * nothing anywhere to restore them from.
 */
const RICH_BODY_REFUSAL: SourceWriteResult = {
  error: "Keeper.sh does not replace a formatted source description with plain text.",
  refused: "event_body_is_rich_text",
  success: false,
};

export {
  attemptSourceWrite,
  isRetryableOAuthWriteStatus,
  isRetryableWriteStatus,
  normalizeAttendeeAddress,
  isWriteBackReach,
  refuseWhenOutOfReach,
  WRITE_BACK_REACH_LEVELS,
  refuseWhenOthersAreInvited,
  refuseWhenSomebodyElseAuthoredIt,
  resolveAudience,
  resolveAuthorship,
  RICH_BODY_REFUSAL,
  toTransportWriteFailure,
  toWriteFailure,
};
export type {
  CalendarSourceWriter,
  SourceWriteConsequence,
  WriteBackReach,
  SourceEventAudience,
  SourceEventAuthorship,
  SourceEventUpdate,
  SourceWriteRefusal,
  SourceWriteResult,
};
