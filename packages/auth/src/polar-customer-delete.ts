interface PolarCustomerDeletionClient {
  customers: {
    deleteExternal: (payload: { externalId: string }) => Promise<unknown>;
  };
}

const POLAR_CUSTOMER_DELETE_TIMEOUT_MS = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isResourceNotFoundError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  return error.error === "ResourceNotFound";
};

const deletePolarCustomerByExternalId = async (
  polarClient: PolarCustomerDeletionClient,
  externalId: string,
): Promise<void> => {
  const NO_FAILURE = Symbol("no-failure");
  const DEADLINE_REACHED = Symbol("deadline-reached");

  const failure = polarClient.customers
    .deleteExternal({ externalId })
    .then(
      (): unknown => NO_FAILURE,
      (error: unknown) => error,
    );

  const deadline = Promise.withResolvers<typeof DEADLINE_REACHED>();
  const deadlineTimer = setTimeout(
    () => deadline.resolve(DEADLINE_REACHED),
    POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
  );

  try {
    const outcome = await Promise.race([failure, deadline.promise]);

    if (outcome === DEADLINE_REACHED) {
      throw new Error(
        `Polar customer deletion for ${externalId} exceeded ${POLAR_CUSTOMER_DELETE_TIMEOUT_MS}ms`,
      );
    }

    if (outcome === NO_FAILURE || isResourceNotFoundError(outcome)) {
      return;
    }

    throw outcome;
  } finally {
    clearTimeout(deadlineTimer);
  }
};

export { deletePolarCustomerByExternalId, POLAR_CUSTOMER_DELETE_TIMEOUT_MS };
export type { PolarCustomerDeletionClient };
