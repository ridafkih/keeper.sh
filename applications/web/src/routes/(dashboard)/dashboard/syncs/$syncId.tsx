import { createFileRoute } from "@tanstack/react-router";
import type { SyncTab } from "@/features/syncs/components/sync-page";

// The dashboard layout draws the sync page itself, so an outgoing page can stay on screen while it animates away.
export const Route = createFileRoute("/(dashboard)/dashboard/syncs/$syncId")({
  component: () => null,
  validateSearch: (search: Record<string, unknown>): { tab?: SyncTab } => ({
    tab: search.tab === "activity" ? "activity" : undefined,
  }),
});
