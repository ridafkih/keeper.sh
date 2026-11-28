import type { SyncOperation } from "../types";

interface OperationOutcomes {
  failed: string[];
  succeeded: string[];
}

interface OperationDeferralLedger {
  readDeferredOperationKeys: () => Promise<ReadonlySet<string>>;
  recordOperationOutcomes: (outcomes: OperationOutcomes) => Promise<void>;
}

interface SettledResult {
  success: boolean;
}

const createOperationOutcomes = (): OperationOutcomes => ({ failed: [], succeeded: [] });

const getOperationKey = (operation: SyncOperation): string => {
  if (operation.type === "remove") {
    return `remote:${operation.uid}\u0000${operation.deleteId}`;
  }
  return `event:${operation.event.id}`;
};

const collectOperationOutcomes = (
  operations: SyncOperation[],
  results: (SettledResult | undefined)[],
): OperationOutcomes => {
  const outcomes = createOperationOutcomes();
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (!operation) {
      continue;
    }
    if (results[index]?.success) {
      outcomes.succeeded.push(getOperationKey(operation));
    } else {
      outcomes.failed.push(getOperationKey(operation));
    }
  }
  return outcomes;
};

const appendOperationOutcomes = (target: OperationOutcomes, source: OperationOutcomes): void => {
  target.failed.push(...source.failed);
  target.succeeded.push(...source.succeeded);
};

const hasOperationOutcomes = (outcomes: OperationOutcomes): boolean =>
  outcomes.failed.length > 0 || outcomes.succeeded.length > 0;

const orderDeferredOperationsLast = (
  operations: SyncOperation[],
  deferredOperationKeys: ReadonlySet<string>,
): { deferredCount: number; operations: SyncOperation[] } => {
  const fresh: SyncOperation[] = [];
  const deferred: SyncOperation[] = [];
  for (const operation of operations) {
    if (deferredOperationKeys.has(getOperationKey(operation))) {
      deferred.push(operation);
    } else {
      fresh.push(operation);
    }
  }
  return { deferredCount: deferred.length, operations: [...fresh, ...deferred] };
};

export {
  appendOperationOutcomes,
  collectOperationOutcomes,
  createOperationOutcomes,
  getOperationKey,
  hasOperationOutcomes,
  orderDeferredOperationsLast,
};
export type { OperationDeferralLedger, OperationOutcomes };
