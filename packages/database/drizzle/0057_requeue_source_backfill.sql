UPDATE "calendars"
SET "syncToken" = null
WHERE "calendarType" IN ('oauth', 'caldav')
  AND EXISTS (
    SELECT 1
    FROM "event_states"
    WHERE "event_states"."calendarId" = "calendars"."id"
      AND (
        "event_states"."sourceEventType" IS NULL
        OR "event_states"."isAllDay" IS NULL
      )
  );
