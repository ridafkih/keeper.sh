UPDATE "calendars" SET "unavailableSince" = COALESCE("unavailableSince", "providerMissingSince"), "providerMissingSince" = NULL WHERE "providerMissingSince" IS NOT NULL;
