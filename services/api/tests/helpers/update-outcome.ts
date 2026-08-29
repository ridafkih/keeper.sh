type UpdateOutcome = unknown[] & { count: number };

const rowsUpdated = (count: number): UpdateOutcome =>
  Object.assign([] as unknown[], { count });

const oneRowUpdated = (): UpdateOutcome => rowsUpdated(1);

export { oneRowUpdated, rowsUpdated };
export type { UpdateOutcome };
