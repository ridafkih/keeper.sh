import { createFileRoute } from "@tanstack/react-router";
import { readNewSyncSearch } from "@/features/syncs/sync-draft";

// The dashboard layout draws the new-sync page in place of the calendar, like a sync's own page.
export const Route = createFileRoute("/(dashboard)/dashboard/syncs/new")({
  component: () => null,
  validateSearch: readNewSyncSearch,
});
