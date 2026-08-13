import { AsyncLocalStorage } from "node:async_hooks";
import { HTTP_STATUS } from "@keeper.sh/constants";

interface RequestFailure {
  reason: unknown;
}

interface RequestRecord {
  failure: RequestFailure | null;
  settledAt: number | null;
  startedAt: number;
  status: number | null;
}

interface RequestScope {
  clock: number;
  records: RequestRecord[];
}

interface RequestScopeView {
  hasUnrefutedUnauthorized: () => boolean;
  isPropagatedTransportFailure: (error: unknown) => boolean;
}

const MAX_CAUSE_DEPTH = 16;

const storage = new AsyncLocalStorage<RequestScope>();

const nextTick = (scope: RequestScope): number => {
  scope.clock += 1;
  return scope.clock;
};

const wasAccepted = (record: RequestRecord): boolean =>
  record.failure === null && record.status !== null && record.status < HTTP_STATUS.BAD_REQUEST;

const refutes = (accepted: RequestRecord, unauthorized: RequestRecord): boolean =>
  accepted.settledAt !== null && accepted.settledAt > unauthorized.startedAt;

const hasUnrefutedUnauthorized = (scope: RequestScope): boolean =>
  scope.records.some(
    (record) =>
      record.status === HTTP_STATUS.UNAUTHORIZED
      && !scope.records.some((other) => wasAccepted(other) && refutes(other, record)),
  );

const causeChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [error];
  let current = error;

  while (chain.length < MAX_CAUSE_DEPTH && current instanceof Error && "cause" in current) {
    const { cause } = current;
    if (chain.includes(cause)) {
      return chain;
    }
    chain.push(cause);
    current = cause;
  }

  return chain;
};

const isPropagatedTransportFailure = (scope: RequestScope, error: unknown): boolean => {
  const chain = causeChain(error);
  return scope.records.some(
    (record) => record.failure !== null && chain.includes(record.failure.reason),
  );
};

const recordRequest = async (perform: () => Promise<Response>): Promise<Response> => {
  const scope = storage.getStore();
  if (!scope) {
    return perform();
  }

  const index = scope.records.length;
  scope.records = [
    ...scope.records,
    { failure: null, settledAt: null, startedAt: nextTick(scope), status: null },
  ];

  const settle = (outcome: { failure: RequestFailure | null; status: number | null }): void => {
    const settledAt = nextTick(scope);
    scope.records = scope.records.map((record, position) => {
      if (position !== index) {
        return record;
      }
      return { ...record, ...outcome, settledAt };
    });
  };

  try {
    const response = await perform();
    settle({ failure: null, status: response.status });
    return response;
  } catch (error) {
    settle({ failure: { reason: error }, status: null });
    throw error;
  }
};

const runInRequestScope = <Result>(
  operation: (requests: RequestScopeView) => Promise<Result>,
): Promise<Result> => {
  const scope: RequestScope = { clock: 0, records: [] };
  return storage.run(scope, () =>
    operation({
      hasUnrefutedUnauthorized: () => hasUnrefutedUnauthorized(scope),
      isPropagatedTransportFailure: (error: unknown) => isPropagatedTransportFailure(scope, error),
    }));
};

export { recordRequest, runInRequestScope };
export type { RequestScopeView };
