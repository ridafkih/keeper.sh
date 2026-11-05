import type { OperationName, ProviderId } from "@keeper.sh/sync-protocol";
import { raceDeadline, standardAnswers } from "../deadline";
import type { ProviderUnderTest } from "../options";
import type { ProviderDecorator } from "./decorate";
import { withListChanges, withWrite } from "./decorate";

const neverAnswers = <Value>(): Promise<Value> => Promise.withResolvers<Value>().promise;

const stallingOn = (matches: (operation: OperationName) => boolean): ProviderDecorator => {
  const decorate = <Provider extends ProviderId>(
    provider: ProviderUnderTest<Provider>,
  ): ProviderUnderTest<Provider> => {
    const stallingListings = withListChanges(provider, (request, context, inner) => {
      if (!matches("listChanges")) {
        return inner();
      }
      return raceDeadline(context, standardAnswers, neverAnswers);
    });
    return withWrite(stallingListings, (intent, context, inner) => {
      if (!matches("write")) {
        return inner();
      }
      return raceDeadline(context, standardAnswers, neverAnswers);
    });
  };
  return decorate;
};

export { stallingOn };
