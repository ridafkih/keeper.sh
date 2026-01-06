-- Remove keeper events that were incorrectly synced from source calendars
-- These are events created by Keeper (UID ends with @keeper.sh) that should not
-- appear in event_states since they're destination events, not source events
DELETE FROM event_states WHERE "sourceEventUid" LIKE '%@keeper.sh';
