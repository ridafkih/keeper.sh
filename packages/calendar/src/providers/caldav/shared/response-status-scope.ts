import { AsyncLocalStorage } from "node:async_hooks";
import { HTTP_STATUS } from "@keeper.sh/constants";

interface RequestRecord {
  failed: boolean;
  settledAt: number | null;
  startedAt: number;
  status: number | null;
}

interface RequestScope {
  clock: number;
  records: RequestRecord[];
}

interface RequestScopeView {
  hasTransportFailure: () => boolean;
  hasUnrefutedUnauthorized: () => boolean;
}

const storage = new AsyncLocalStorage<RequestScope>();

const nextTick = (scope: RequestScope): number => {
  scope.clock += 1;
  return scope.clock;
};

const wasAccepted = (record: RequestRecord): boolean =>
  !record.failed && record.status !== null && record.status < HTTP_STATUS.BAD_REQUEST;

const refutes = (accepted: RequestRecord, unauthorized: RequestRecord): boolean =>
  accepted.settledAt !== null && accepted.settledAt > unauthorized.startedAt;

const hasUnrefutedUnauthorized = (scope: RequestScope): boolean =>
  scope.records.some(
    (record) =>
      record.status === HTTP_STATUS.UNAUTHORIZED
      && !scope.records.some((other) => wasAccepted(other) && refutes(other, record)),
  );

const hasTransportFailure = (scope: RequestScope): boolean =>
  scope.records.some((record) => record.failed);

const recordRequest = async (perform: () => Promise<Response>): Promise<Response> => {
  const scope = storage.getStore();
  if (!scope) {
    return perform();
  }

  const index = scope.records.length;
  scope.records = [
    ...scope.records,
    { failed: false, settledAt: null, startedAt: nextTick(scope), status: null },
  ];

  const settle = (outcome: { failed: boolean; status: number | null }): void => {
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
    settle({ failed: false, status: response.status });
    return response;
  } catch (error) {
    settle({ failed: true, status: null });
    throw error;
  }
};

const runInRequestScope = <Result>(
  operation: (requests: RequestScopeView) => Promise<Result>,
): Promise<Result> => {
  const scope: RequestScope = { clock: 0, records: [] };
  return storage.run(scope, () =>
    operation({
      hasTransportFailure: () => hasTransportFailure(scope),
      hasUnrefutedUnauthorized: () => hasUnrefutedUnauthorized(scope),
    }));
};

export { recordRequest, runInRequestScope };
export type { RequestScopeView };
