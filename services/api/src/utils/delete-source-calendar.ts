interface DeleteSourceCalendarContext {
  calendarId: string;
  userId: string;
}

interface DeletionCandidate {
  capabilities: string[];
  missingAtProvider: boolean;
}

type DeleteSourceCalendarOutcome = "deleted" | "not-found" | "receives-events";

const DEREGISTRATION_FAILED_SLUG = "webhook-deregistration-failed";
const PUSH_CAPABILITY = "push";

interface DeleteSourceCalendarDependencies {
  deleteCalendarRow: (context: DeleteSourceCalendarContext) => Promise<boolean>;
  deregisterPushChannels: (calendarId: string) => Promise<number>;
  loadCandidate: (context: DeleteSourceCalendarContext) => Promise<DeletionCandidate | null>;
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

const isDeletable = (candidate: DeletionCandidate): boolean =>
  candidate.missingAtProvider || !candidate.capabilities.includes(PUSH_CAPABILITY);

const runDeleteSourceCalendar = async (
  context: DeleteSourceCalendarContext,
  dependencies: DeleteSourceCalendarDependencies,
): Promise<DeleteSourceCalendarOutcome> => {
  const candidate = await dependencies.loadCandidate(context);
  if (!candidate) {
    return "not-found";
  }

  if (!isDeletable(candidate)) {
    return "receives-events";
  }

  await stopPushChannels(context.calendarId, dependencies);

  if (!await dependencies.deleteCalendarRow(context)) {
    return "not-found";
  }

  return "deleted";
};

export { DEREGISTRATION_FAILED_SLUG, runDeleteSourceCalendar };
export type {
  DeleteSourceCalendarContext,
  DeleteSourceCalendarDependencies,
  DeleteSourceCalendarOutcome,
  DeletionCandidate,
};
