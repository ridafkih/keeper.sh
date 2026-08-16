const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const REFRESH_BUFFER_MINUTES = 5;
const RATE_LIMIT_SECONDS = 60;

const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
const MS_PER_WEEK = DAYS_PER_WEEK * MS_PER_DAY;

const SECONDS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = HOURS_PER_DAY * SECONDS_PER_HOUR;

const TOOLTIP_CLEAR_DELAY_MS = 1500;
const TOAST_TIMEOUT_MS = 3000;
const WEBSOCKET_RECONNECT_DELAY_MS = 3000;
const TOKEN_TTL_MS = 30_000;
const TOKEN_REFRESH_BUFFER_MS = REFRESH_BUFFER_MINUTES * MS_PER_MINUTE;
const RATE_LIMIT_DELAY_MS = RATE_LIMIT_SECONDS * MS_PER_SECOND;
const SYNC_TTL_SECONDS = SECONDS_PER_DAY;

const PROVIDER_PUSH_REQUEST_TIMEOUT_MS = 30_000;
/*
 * Deliberately below SOURCE_INGEST_LOCK_TIMEOUT_MS: a write-back holds the source
 * ingest advisory lock, whose waiters error out rather than queue after 30 seconds.
 */
const TWO_WAY_SOURCE_WRITE_TIMEOUT_MS = 10_000;
const TWO_WAY_WRITE_BACK_PASS_BUDGET_MS = 20_000;
/*
 * A per-pass circuit breaker cannot see a slow leak: a couple of spurious deletions per
 * pass stays under its floor and still destroys thousands of real events in a day.
 */
const TWO_WAY_DELETE_DAILY_CAP = 50;
const TWO_WAY_DELETE_DAILY_WINDOW_MS = MS_PER_DAY;
/*
 * The hourly epoch budget has no cumulative memory, so an oscillation slower than its
 * threshold is handed a fresh budget every hour and writes to a real calendar forever.
 * This sits far above any plausible human editing rate for a single event and far below
 * the 1440 passes a Pro mapping runs in a day.
 */
const TWO_WAY_WRITE_BACK_DAILY_CAP = 20;
const TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS = MS_PER_DAY;
/*
 * How long an answer about vanished copies stays good for. Long enough for the passes it
 * takes to probe and delete them, short enough that the bulk breaker is armed again well
 * before anything else could go wrong unattended.
 */
const TWO_WAY_DELETE_APPROVAL_TTL_MS = 30 * MS_PER_MINUTE;
/*
 * An edit destroys the previous values of a real event as surely as a deletion destroys
 * the event, and it leaves no tombstone to restore from. One destination-side event can
 * move every copy at once — a calendar timezone change, a tzdata update, an import over
 * the mirror — and read as the user having edited all of them. The floor sits above what
 * a person plausibly edits inside one pass, and the ratio above what a bulk provider-side
 * shift leaves untouched, so a real editing session still writes through.
 */
const TWO_WAY_EDIT_ABSOLUTE_FLOOR = 10;
/*
 * A ratio alone cannot see a shift that moved a large minority of a large calendar, and a
 * large minority of real events is exactly what nobody can put back: an edit carries no
 * confirmation, no per-event probe, no tombstone and no per-calendar daily cap, so the
 * count in a single pass is the only bound there is. The same figure the floor already
 * calls more than a person plausibly edits inside one pass is therefore also the most any
 * one source calendar may take from one pass, whatever the calendar's size. The dashboard
 * discloses this number, so it lives beside the other bounds the product states rather
 * than inside the classifier that enforces it.
 */
const TWO_WAY_EDIT_ABSOLUTE_CEILING = TWO_WAY_EDIT_ABSOLUTE_FLOOR;
/*
 * The delete breaker's ratio has the same blind spot the edit ceiling was added to close,
 * against the one operation nothing can undo: fifty copies vanishing out of three hundred
 * mappings is a sixth of the calendar, below any ratio worth setting, and destroys fifty
 * real events. Whatever removed them — a retention policy ageing out a folder, a client
 * rebuilding the calendar, a bulk action — is not a person deleting meetings one at a time,
 * and the only honest response is to ask. This sits at the breaker's own floor rather than
 * at the edit ceiling because a deletion cannot be repaired by the one-way path the way an
 * overwritten edit can, and because answering the question once carries the rest of the
 * batch through inside the approval window.
 */
const TWO_WAY_DELETE_ABSOLUTE_CEILING = 5;
/*
 * How old the stored copy of a source calendar may be before two-way sync stops writing to
 * it. Every guard that refuses a write-back because the original moved compares the copy on
 * the destination against that stored copy, so once it stops being refreshed those guards
 * are comparing it against itself and will happily overwrite or delete an original the user
 * changed in the meantime. A source is re-read about once a minute, and an ingest that
 * starts failing backs off for up to six hours per attempt, so this sits far above the
 * healthy interval and far below the gap a broken one opens.
 */
const TWO_WAY_SOURCE_INGEST_MAX_AGE_MS = 30 * MS_PER_MINUTE;
/*
 * Two write-backs to the same event closer together than this are counted as one run. A
 * destination generating changes on its own produces one on every pass, roughly a minute
 * apart; a person editing the same event produces one per edit. Counting only the closely
 * spaced ones is what keeps an ordinary editing session out of the runaway detector.
 */
const TWO_WAY_WRITE_BACK_RUNAWAY_GAP_MS = 3 * MS_PER_MINUTE;
const PROVIDER_INGEST_REQUEST_TIMEOUT_MS = 90_000;
const INGEST_SOURCE_TIMEOUT_MS = 120_000;

const KEEPER_EVENT_SUFFIX = "@keeper.sh";
const KEEPER_USER_EVENT_SUFFIX = "@user.keeper.sh";
const KEEPER_CATEGORY = "keeper.sh";

export {
  MS_PER_SECOND,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  SECONDS_PER_MINUTE,
  SECONDS_PER_HOUR,
  SECONDS_PER_DAY,
  TOOLTIP_CLEAR_DELAY_MS,
  TOAST_TIMEOUT_MS,
  WEBSOCKET_RECONNECT_DELAY_MS,
  TOKEN_TTL_MS,
  TOKEN_REFRESH_BUFFER_MS,
  RATE_LIMIT_DELAY_MS,
  SYNC_TTL_SECONDS,
  PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
  TWO_WAY_DELETE_ABSOLUTE_CEILING,
  TWO_WAY_DELETE_APPROVAL_TTL_MS,
  TWO_WAY_DELETE_DAILY_CAP,
  TWO_WAY_DELETE_DAILY_WINDOW_MS,
  TWO_WAY_EDIT_ABSOLUTE_CEILING,
  TWO_WAY_EDIT_ABSOLUTE_FLOOR,
  TWO_WAY_SOURCE_INGEST_MAX_AGE_MS,
  TWO_WAY_SOURCE_WRITE_TIMEOUT_MS,
  TWO_WAY_WRITE_BACK_DAILY_CAP,
  TWO_WAY_WRITE_BACK_DAILY_WINDOW_MS,
  TWO_WAY_WRITE_BACK_PASS_BUDGET_MS,
  TWO_WAY_WRITE_BACK_RUNAWAY_GAP_MS,
  PROVIDER_INGEST_REQUEST_TIMEOUT_MS,
  INGEST_SOURCE_TIMEOUT_MS,
  KEEPER_EVENT_SUFFIX,
  KEEPER_USER_EVENT_SUFFIX,
  KEEPER_CATEGORY,
};
