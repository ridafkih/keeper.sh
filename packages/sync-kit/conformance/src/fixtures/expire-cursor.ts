import type { ProviderId } from "@keeper.sh/sync-protocol";
import type { ProviderUnderTest } from "../options";
import { cursorLostListing } from "../reference/listing";
import type { ProviderDecorator } from "./decorate";
import { withListChanges } from "./decorate";

const expiringCursorAfter = (pages: number): ProviderDecorator => {
  const decorate = <Provider extends ProviderId>(
    provider: ProviderUnderTest<Provider>,
  ): ProviderUnderTest<Provider> => {
    const walk = { drained: 0 };
    return withListChanges(provider, async (request, context, inner) => {
      walk.drained += 1;
      const answered = await inner();
      if (walk.drained <= pages || request.resume === null) {
        return answered;
      }
      return { ok: true, value: cursorLostListing(request.scope) };
    });
  };
  return decorate;
};

export { expiringCursorAfter };
