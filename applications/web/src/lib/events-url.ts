import { resolveViewerTimeZone } from "./event-day";

// Relative: Bun has no `globalThis.location`, and an eagerly built absolute key would throw in SSR.
export const buildEventsUrl = (from: Date, to: Date): string => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: resolveViewerTimeZone(),
  });
  return `/api/events?${params.toString()}`;
};
