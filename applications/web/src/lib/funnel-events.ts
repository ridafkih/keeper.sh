import { FUNNEL_EVENT_PATH } from "@keeper.sh/data-schemas/client";
import type { FunnelEvent } from "@keeper.sh/data-schemas/client";

const reportFunnelEvent = (event: FunnelEvent): void => {
  if (typeof fetch === "undefined") return;
  fetch(FUNNEL_EVENT_PATH, {
    body: JSON.stringify(event),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => null);
};

export { reportFunnelEvent };
