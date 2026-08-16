import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "@/components/ui/primitives/back-button";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ErrorState } from "@/components/ui/primitives/error-state";
import { Text } from "@/components/ui/primitives/text";
import { DeletedEventsRecord } from "@/features/dashboard/components/deleted-events-record";
import type { WriteBackDeletion } from "@/features/dashboard/components/deleted-events-record";

const DELETED_EVENTS_ENDPOINT = "/api/write-back/deletions";

export const Route = createFileRoute("/(dashboard)/dashboard/deleted-events")({
  component: DeletedEventsPage,
});

function DeletedEventsPage() {
  const { data, error, isLoading, mutate } = useSWR<{
    deletions: WriteBackDeletion[];
    truncated?: boolean;
  }>(DELETED_EVENTS_ENDPOINT);

  return (
    <div className="flex flex-col gap-3">
      <BackButton />
      <DashboardSection
        title="Deleted Events"
        description="Originals Keeper.sh deleted for you because their copy was deleted. Kept for 30 days."
        level={1}
      />
      {error && (
        <ErrorState message="Failed to load deleted events." onRetry={() => mutate()} />
      )}
      {isLoading && <Text size="sm" tone="muted">Loading...</Text>}
      {data && (
        <DeletedEventsRecord deletions={data.deletions} truncated={data.truncated === true} />
      )}
    </div>
  );
}

export { DELETED_EVENTS_ENDPOINT };
