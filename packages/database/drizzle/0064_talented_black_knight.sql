DELETE FROM "calendar_snapshots"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("calendarId") "id"
  FROM "calendar_snapshots"
  ORDER BY "calendarId", "createdAt" DESC
);--> statement-breakpoint
ALTER TABLE "calendar_snapshots" ADD CONSTRAINT "calendar_snapshots_calendarId_unique" UNIQUE("calendarId");