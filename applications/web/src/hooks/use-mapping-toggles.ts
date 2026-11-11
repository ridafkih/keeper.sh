import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/fetcher";
import { enqueueMappingToggle } from "@/lib/mapping-toggles";
import { useMutateEntitlements } from "@/hooks/use-entitlements";

type MappingRoute = "destinations" | "sources";
type MappingResponseKey = "destinationIds" | "sourceIds";
type MappingData = Partial<Record<MappingResponseKey, string[]>>;

const RESPONSE_KEYS: Record<MappingRoute, MappingResponseKey> = {
  destinations: "destinationIds",
  sources: "sourceIds",
};

const EMPTY_IDS: string[] = [];

const readMappedIds = (body: unknown, responseKey: MappingResponseKey): string[] => {
  if (typeof body !== "object" || body === null || !(responseKey in body)) {
    throw new Error(`Mapping response is missing ${responseKey}`);
  }
  const ids: unknown = Reflect.get(body, responseKey);
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error(`Mapping response has an invalid ${responseKey}`);
  }
  return ids;
};

const resolveMappingEndpoint = (calendarId: string | undefined, route: MappingRoute): string | null => {
  if (!calendarId) return null;
  return `/api/sources/${calendarId}/${route}`;
};

function useMappingToggles(calendarId: string | undefined, route: MappingRoute) {
  const responseKey = RESPONSE_KEYS[route];
  const endpoint = resolveMappingEndpoint(calendarId, route);
  const { data } = useSWR<MappingData>(endpoint);
  const { mutate } = useSWRConfig();
  const { adjustMappingCount, revalidateEntitlements } = useMutateEntitlements();
  const mappedIds = data?.[responseKey] ?? EMPTY_IDS;

  const toggle = (targetCalendarId: string, enabled: boolean) => {
    if (!endpoint) return;
    adjustMappingCount(enabled ? 1 : -1);
    enqueueMappingToggle(endpoint, { calendarId: targetCalendarId, enabled }, {
      currentIds: mappedIds,
      onError: (failed) => {
        adjustMappingCount(failed.enabled ? -1 : 1);
      },
      publish: (calendarIds) => {
        void mutate(endpoint, { [responseKey]: calendarIds }, { revalidate: false });
      },
      send: async (pendingToggle) => {
        try {
          const response = await apiFetch(endpoint, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingToggle),
          });
          return readMappedIds(await response.json(), responseKey);
        } finally {
          void revalidateEntitlements();
        }
      },
    });
  };

  return { mappedIds, toggle };
}

export { useMappingToggles };
export type { MappingRoute };
