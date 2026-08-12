const EMPTY_LIST_COUNT = 0;

const assertAllIdsOwned = (
  requestedIds: string[],
  validIds: string[],
  errorMessage: string,
): void => {
  const validIdSet = new Set(validIds);
  const invalidIds = requestedIds.filter((requestedId) => !validIdSet.has(requestedId));
  if (invalidIds.length > EMPTY_LIST_COUNT) {
    throw new Error(errorMessage);
  }
};

export { assertAllIdsOwned };
