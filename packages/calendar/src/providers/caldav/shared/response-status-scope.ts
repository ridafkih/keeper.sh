import { AsyncLocalStorage } from "node:async_hooks";

interface ResponseStatusScope {
  status: number | null;
}

const storage = new AsyncLocalStorage<ResponseStatusScope>();

const recordResponseStatus = (status: number | null): void => {
  const scope = storage.getStore();
  if (!scope) {
    return;
  }
  scope.status = status;
};

const runInResponseStatusScope = <Result>(
  operation: (getResponseStatus: () => number | null) => Promise<Result>,
): Promise<Result> => {
  const scope: ResponseStatusScope = { status: null };
  return storage.run(scope, () => operation(() => scope.status));
};

export { recordResponseStatus, runInResponseStatusScope };
