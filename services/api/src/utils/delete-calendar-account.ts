interface DeleteCalendarAccountContext {
  accountId: string;
  userId: string;
}

const DEREGISTRATION_FAILED_SLUG = "webhook-deregistration-failed";

interface DeleteCalendarAccountDependencies {
  deleteAccountRow: (context: DeleteCalendarAccountContext) => Promise<boolean>;
  deregisterPushChannels: (accountId: string) => Promise<number>;
  isOwnedByUser: (context: DeleteCalendarAccountContext) => Promise<boolean>;
  recordError: (error: unknown, slug: string) => void;
  scheduleReplacementSync: (userId: string) => void;
}

const stopPushChannels = async (
  accountId: string,
  dependencies: DeleteCalendarAccountDependencies,
): Promise<void> => {
  try {
    await dependencies.deregisterPushChannels(accountId);
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
  }
};

const runDeleteCalendarAccount = async (
  context: DeleteCalendarAccountContext,
  dependencies: DeleteCalendarAccountDependencies,
): Promise<boolean> => {
  if (!await dependencies.isOwnedByUser(context)) {
    return false;
  }

  await stopPushChannels(context.accountId, dependencies);

  if (!await dependencies.deleteAccountRow(context)) {
    return false;
  }

  dependencies.scheduleReplacementSync(context.userId);
  return true;
};

export { DEREGISTRATION_FAILED_SLUG, runDeleteCalendarAccount };
export type { DeleteCalendarAccountContext, DeleteCalendarAccountDependencies };
