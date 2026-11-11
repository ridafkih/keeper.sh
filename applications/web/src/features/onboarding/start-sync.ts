import { apiFetch } from "@/lib/fetcher";
import type { ProposalCalendar, SyncProposal } from "./sync-proposal";
import type { MappingPair } from "./sync-pairs";

interface SyncChoice {
  forward: boolean;
  backward: boolean;
  busyOnly: boolean;
}

interface SyncStartPlan {
  mappings: MappingPair[];
  titledSourceIds: string[];
}

const planSyncStart = (proposal: SyncProposal<ProposalCalendar>, choice: SyncChoice): SyncStartPlan => {
  const mappings: MappingPair[] = [];
  if (proposal.forward && choice.forward) {
    mappings.push({ destinationCalendarId: proposal.destination.id, sourceCalendarId: proposal.origin.id });
  }
  if (proposal.backward && choice.backward) {
    mappings.push({ destinationCalendarId: proposal.origin.id, sourceCalendarId: proposal.destination.id });
  }
  return {
    mappings,
    titledSourceIds: choice.busyOnly ? [] : mappings.map(({ sourceCalendarId }) => sourceCalendarId),
  };
};

const JSON_HEADERS = { "Content-Type": "application/json" };

const startSync = async ({ mappings, titledSourceIds }: SyncStartPlan): Promise<void> => {
  await Promise.all(titledSourceIds.map((sourceCalendarId) =>
    apiFetch(`/api/sources/${sourceCalendarId}`, {
      body: JSON.stringify({ excludeEventName: false }),
      headers: JSON_HEADERS,
      method: "PATCH",
    })));
  for (const { sourceCalendarId, destinationCalendarId } of mappings) {
    await apiFetch(`/api/sources/${sourceCalendarId}/destinations`, {
      body: JSON.stringify({ calendarId: destinationCalendarId, enabled: true }),
      headers: JSON_HEADERS,
      method: "PATCH",
    });
  }
};

export { planSyncStart, startSync };
export type { SyncChoice, SyncStartPlan };
