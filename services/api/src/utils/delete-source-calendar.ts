interface DeleteSourceCalendarContext {
  calendarId: string;
  userId: string;
}

const DEREGISTRATION_FAILED_SLUG = "webhook-deregistration-failed";
const PUSH_CAPABILITY = "push";

interface DeleteSourceCalendarDependencies {
  deleteCalendarRow: (context: DeleteSourceCalendarContext) => Promise<boolean>;
  deregisterPushChannels: (calendarId: string) => Promise<number>;
  isOwnedByUser: (context: DeleteSourceCalendarContext) => Promise<boolean>;
  loadCapabilities: (context: DeleteSourceCalendarContext) => Promise<string[]>;
  recordError: (error: unknown, slug: string) => void;
}

const stopPushChannels = async (
  calendarId: string,
  dependencies: DeleteSourceCalendarDependencies,
): Promise<void> => {
  try {
    await dependencies.deregisterPushChannels(calendarId);
  } catch (error) {
    dependencies.recordError(error, DEREGISTRATION_FAILED_SLUG);
  }
};

const runDeleteSourceCalendar = async (
  context: DeleteSourceCalendarContext,
  dependencies: DeleteSourceCalendarDependencies,
): Promise<boolean> => {
  if (!await dependencies.isOwnedByUser(context)) {
    return false;
  }

  const capabilities = await dependencies.loadCapabilities(context);
  if (capabilities.includes(PUSH_CAPABILITY)) {
    return false;
  }

  await stopPushChannels(context.calendarId, dependencies);

  return await dependencies.deleteCalendarRow(context);
};

export { DEREGISTRATION_FAILED_SLUG, runDeleteSourceCalendar };
export type { DeleteSourceCalendarContext, DeleteSourceCalendarDependencies };
