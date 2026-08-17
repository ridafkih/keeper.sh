import type {
  ChangeListing,
  ListChangesRequest,
  OperationContext,
  ProviderId,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import type { ProviderUnderTest } from "../options";

type ProviderDecorator = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
) => ProviderUnderTest<Provider>;

type ListingAnswer = (
  request: ListChangesRequest,
  context: OperationContext,
  inner: () => Promise<Result<ChangeListing>>,
) => Promise<Result<ChangeListing>>;

type WriteAnswer<Provider extends ProviderId> = (
  intent: WriteIntent<Provider>,
  context: OperationContext,
  inner: () => Promise<Result<WriteOutcome>>,
) => Promise<Result<WriteOutcome>>;

const withListChanges = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  answer: ListingAnswer,
): ProviderUnderTest<Provider> => ({
  ...provider,
  contract: {
    ...provider.contract,
    provider: {
      ...provider.contract.provider,
      listChanges: (request, context) =>
        answer(request, context, () => provider.contract.provider.listChanges(request, context)),
    },
  },
});

const withWrite = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  answer: WriteAnswer<Provider>,
): ProviderUnderTest<Provider> => ({
  ...provider,
  contract: {
    ...provider.contract,
    provider: {
      ...provider.contract.provider,
      write: (intent, context) =>
        answer(intent, context, () => provider.contract.provider.write(intent, context)),
    },
  },
});

const composeDecorators = (decorators: readonly ProviderDecorator[]): ProviderDecorator => {
  const composed = <Provider extends ProviderId>(
    provider: ProviderUnderTest<Provider>,
  ): ProviderUnderTest<Provider> => {
    const carried = { provider };
    for (const decorate of decorators) {
      carried.provider = decorate(carried.provider);
    }
    return carried.provider;
  };
  return composed;
};

const undecorated: ProviderDecorator = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
): ProviderUnderTest<Provider> => provider;

export { composeDecorators, undecorated, withListChanges, withWrite };
export type { ListingAnswer, ProviderDecorator, WriteAnswer };
