import type { ChangeListing, ProviderId, Result } from "@keeper.sh/sync-protocol";
import type { ProviderUnderTest } from "../options";
import type { ProviderDecorator } from "./decorate";
import { withListChanges } from "./decorate";

const truncated = (
  listing: Extract<ChangeListing, { kind: "snapshot" }>,
  events: number,
): Result<ChangeListing> => ({
  ok: true,
  value: {
    kind: "partial",
    scope: listing.scope,
    events: listing.events.slice(0, events),
    withheld: listing.withheld,
    continuation: { kind: "continuation", value: `truncated-${events}`, scope: listing.scope },
    diagnostics: listing.diagnostics,
  },
});

const truncatingAfter = (events: number): ProviderDecorator => {
  const decorate = <Provider extends ProviderId>(
    provider: ProviderUnderTest<Provider>,
  ): ProviderUnderTest<Provider> =>
    withListChanges(provider, async (request, context, inner) => {
      const answered = await inner();
      if (request.resume !== null || !answered.ok) {
        return answered;
      }
      if (answered.value.kind !== "snapshot" || answered.value.events.length <= events) {
        return answered;
      }
      return truncated(answered.value, events);
    });
  return decorate;
};

export { truncatingAfter };
