# Reorganize providers into @keeper.sh/calendar

## Context

The current `@keeper.sh/providers` package contains all calendar provider implementations (Google, Outlook, CalDAV, etc.), sync infrastructure, and a registry. The separate `@keeper.sh/calendar` package handles ICS parsing, snapshot management, and date utilities. ICS handling is treated as a special case separate from other providers, but it should be a provider like any other.

This reorganization:
1. Absorbs `@keeper.sh/calendar` into `@keeper.sh/providers`
2. Restructures providers into `providers/` (handlers) and `utils/` (registry, shared logic)
3. Renames the package from `@keeper.sh/providers` to `@keeper.sh/calendar`
4. Inlines date-utils into their consumers (they are not widely shared)

## Step 1: Inline date-utils into consumers

`date-utils` exports are only used in two places:

**`normalizeDateRange` + `parseDateRangeParams`** — only in `services/api/src/`:
- `routes/api/events/index.ts`
- `routes/api/v1/events/index.ts`
- `routes/api/v1/calendars/[calendarId]/invites.ts`
- `queries/get-events-in-range.ts`

Move these two functions into `services/api/src/utils/date-range.ts` and update the 4 imports.

**`getStartOfToday`** — only in `packages/providers/src/`:
- `caldav/destination/sync.ts`
- `core/oauth/sync-window.ts`

Inline `getStartOfToday` into each file (it's a 5-line function).

Delete `packages/calendar/src/date-utils/` entirely (the remaining exports like `formatDate`, `formatWeekday`, etc. are unused — the web app has its own implementations).

## Step 2: Move calendar package contents into providers

Move all remaining `packages/calendar/src/` files into `packages/providers/src/ics/`:

```
packages/providers/src/ics/
  index.ts              # barrel (re-exports from calendar's current index.ts, minus date-utils)
  types.ts              # from calendar/src/types.ts
  utils/
    diff-events.ts      # + test files
    parse-ics-events.ts # + test files
    parse-ics-calendar.ts # + test files
    pull-remote-calendar.ts
    create-snapshot.ts
    snapshot-sync-plan.ts # + test file
    sync-source-from-snapshot.ts
    write-event-states.ts # + test file
    fetch-and-sync-source.ts
    ics-fixtures.test.ts
    types.ts
```

Update internal imports within these files (they reference `@keeper.sh/constants`, `@keeper.sh/database` — those stay as-is since they are external deps).

Update all external consumers to import from `@keeper.sh/providers/ics` instead of `@keeper.sh/calendar`:
- `services/cron/src/jobs/sync-sources-ical.ts` — `pullRemoteCalendar`
- `services/cron/src/utils/sync-calendar-events.ts` — `fetchAndSyncSource`, `Source`
- `services/api/src/utils/sources.ts` — `fetchAndSyncSource`, `pullRemoteCalendar`
- `services/api/src/utils/source-lifecycle.ts` — `CalendarFetchError`
- `services/api/src/utils/source-lifecycle.test.ts` — `CalendarFetchError`
- `packages/providers/src/caldav/shared/ics.ts` — `parseIcsCalendar` (becomes relative `../../ics/...`)
- `packages/providers/src/caldav/destination/sync.ts` — was `getStartOfToday` (already inlined in step 1)
- `packages/providers/src/core/oauth/sync-window.ts` — was `getStartOfToday` (already inlined)

Add `@keeper.sh/providers/ics` subpath export to providers `package.json`.

Remove `@keeper.sh/calendar` from all `package.json` dependencies. Delete `packages/calendar/`.

## Step 3: Restructure providers/src into providers/ and utils/

Current top-level structure in `packages/providers/src/`:
```
caldav/    google/    outlook/    fastmail/    icloud/    core/    registry/    index.ts
```

Move to:
```
packages/providers/src/
  providers/        # provider implementations (was top-level)
    caldav/
    google/
    outlook/
    fastmail/
    icloud/
  utils/            # shared infrastructure
    registry/       # was registry/
  core/             # stays (sync infrastructure, oauth, events, source)
  ics/              # added in step 2
  index.ts          # updated barrel
```

Update subpath exports in package.json:
```json
{
  ".": "./src/index.ts",
  "./caldav": "./src/providers/caldav/index.ts",
  "./google": "./src/providers/google/index.ts",
  "./outlook": "./src/providers/outlook/index.ts",
  "./fastmail": "./src/providers/fastmail/index.ts",
  "./icloud": "./src/providers/icloud/index.ts",
  "./ics": "./src/ics/index.ts"
}
```

Update all internal relative imports within providers package (caldav → `../providers/caldav`, registry → `../utils/registry`, etc.).

## Step 4: Rename package from @keeper.sh/providers to @keeper.sh/calendar

- Update `packages/providers/package.json`: change `name` to `@keeper.sh/calendar`
- Rename directory: `packages/providers/` → `packages/calendar/`
- Find-replace all imports across codebase:
  - `@keeper.sh/providers/caldav` → `@keeper.sh/calendar/caldav`
  - `@keeper.sh/providers/google` → `@keeper.sh/calendar/google`
  - `@keeper.sh/providers/outlook` → `@keeper.sh/calendar/outlook`
  - `@keeper.sh/providers/fastmail` → `@keeper.sh/calendar/fastmail`
  - `@keeper.sh/providers/icloud` → `@keeper.sh/calendar/icloud`
  - `@keeper.sh/providers/ics` → `@keeper.sh/calendar/ics`
  - `@keeper.sh/providers` → `@keeper.sh/calendar`
- Update all `package.json` dependency references
- Update test mocks in `services/api/src/utils/account-locks.test.ts`

## Files to modify

**Delete:**
- `packages/calendar/` (entire directory, after contents moved)

**New files:**
- `services/api/src/utils/date-range.ts` (inlined date-utils for api)
- `packages/providers/src/ics/index.ts` (barrel for absorbed calendar)

**Move (within providers):**
- `caldav/` → `providers/caldav/`
- `google/` → `providers/google/`
- `outlook/` → `providers/outlook/`
- `fastmail/` → `providers/fastmail/`
- `icloud/` → `providers/icloud/`
- `registry/` → `utils/registry/`

**Rename:**
- `packages/providers/` → `packages/calendar/`

**Update imports (~30 files):**
- All files importing from `@keeper.sh/calendar` (12 files)
- All files importing from `@keeper.sh/providers` (15 files)
- All internal relative imports within the providers package (~55 files)
- Test mocks referencing old package names

## Verification

1. `bun install` — workspace resolution
2. `bun run types` — TypeScript compilation
3. `bun run test` — all tests pass
4. `bun run lint` — oxlint passes
5. `bun run unused` — knip passes
6. `grep -r '@keeper.sh/providers\|@keeper.sh/calendar' --include='*.ts' | grep -v node_modules` — verify no stale refs to old names
