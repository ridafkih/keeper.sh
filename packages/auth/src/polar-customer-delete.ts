import { writeAuthStderr } from "./runtime-environment";

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

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.detail === "string") {
    return error.detail;
  }

  return "Unknown error";
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

    writeAuthStderr(
      `[auth] Failed to delete Polar customer for user ${externalId}: ${toErrorMessage(error)}\n`,
    );
  }
};

export { deletePolarCustomerByExternalId };
export type { PolarCustomerDeletionClient };
