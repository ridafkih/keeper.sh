type ErrorHandler = (error: unknown) => void;

interface QueuedPatch {
  patch: Record<string, unknown>;
  flush: (mergedPatch: Record<string, unknown>) => Promise<unknown>;
  onError: ErrorHandler;
}

const activePatchMutations = new Set<string>();
const patchQueue = new Map<string, QueuedPatch>();

function runFlush(
  promise: Promise<unknown>,
  onError: ErrorHandler,
  cleanup: () => void,
) {
  promise
    .catch(onError)
    .finally(cleanup);
}

function drainPatchQueue(key: string) {
  const pending = patchQueue.get(key);
  if (!pending) return;
  patchQueue.delete(key);

  activePatchMutations.add(key);
  runFlush(
    pending.flush({ ...pending.patch }),
    pending.onError,
    () => {
      activePatchMutations.delete(key);
      drainPatchQueue(key);
    },
  );
}

export function serializedPatch(
  key: string,
  patch: Record<string, unknown>,
  flush: (mergedPatch: Record<string, unknown>) => Promise<unknown>,
  onError?: ErrorHandler,
) {
  const handleError = onError ?? defaultOnError;

  if (activePatchMutations.has(key)) {
    const existing = patchQueue.get(key);

    if (existing) {
      Object.assign(existing.patch, patch);
      existing.flush = flush;
      existing.onError = handleError;
      return;
    }

    patchQueue.set(key, { patch: { ...patch }, flush, onError: handleError });
    return;
  }

  activePatchMutations.add(key);
  runFlush(
    flush(patch),
    handleError,
    () => {
      activePatchMutations.delete(key);
      drainPatchQueue(key);
    },
  );
}

interface QueuedCall {
  callback: () => Promise<unknown>;
  onError: ErrorHandler;
}

const activeCallMutations = new Set<string>();
const callQueue = new Map<string, QueuedCall>();

function drainCallQueue(key: string) {
  const pending = callQueue.get(key);
  if (!pending) return;
  callQueue.delete(key);

  activeCallMutations.add(key);
  runFlush(
    pending.callback(),
    pending.onError,
    () => {
      activeCallMutations.delete(key);
      drainCallQueue(key);
    },
  );
}

export function serializedCall(
  key: string,
  callback: () => Promise<unknown>,
  onError?: ErrorHandler,
) {
  const handleError = onError ?? defaultOnError;

  if (activeCallMutations.has(key)) {
    callQueue.set(key, { callback, onError: handleError });
    return;
  }

  activeCallMutations.add(key);
  runFlush(
    callback(),
    handleError,
    () => {
      activeCallMutations.delete(key);
      drainCallQueue(key);
    },
  );
}

function defaultOnError() {}
