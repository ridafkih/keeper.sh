import { createFileRoute } from "@tanstack/react-router";
import type { SyncTab } from "@/features/syncs/components/sync-page";

interface SyncSearch {
  tab?: SyncTab;
  // A calendar to add to the unsaved draft as the page opens; the page drops it from the URL once read.
  addCalendar?: string;
}

// The dashboard layout draws the sync page itself, so an outgoing page can stay on screen while it animates away.
export const Route = createFileRoute("/(dashboard)/dashboard/syncs/$syncId")({
  component: () => null,
  validateSearch: (search: Record<string, unknown>): SyncSearch => ({
    addCalendar: typeof search.addCalendar === "string" ? search.addCalendar : undefined,
    tab: search.tab === "activity" ? "activity" : undefined,
  }),
});
