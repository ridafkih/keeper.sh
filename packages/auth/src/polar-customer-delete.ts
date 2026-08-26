interface PolarCustomerDeletionClient {
  customers: {
    deleteExternal: (payload: { externalId: string }) => Promise<unknown>;
  };
}

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
  try {
    await polarClient.customers.deleteExternal({
      externalId,
    });
  } catch (error) {
    if (isResourceNotFoundError(error)) {
      return;
    }

    throw error;
  }
};

export { deletePolarCustomerByExternalId };
export type { PolarCustomerDeletionClient };
