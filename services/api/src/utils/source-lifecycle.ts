import { CalendarFetchError } from "@keeper.sh/calendar";
import {
  createSourceProvisioningDispatcher,
} from "@keeper.sh/machine-orchestration";
import {
  TransitionPolicy,
} from "@keeper.sh/state-machines";

interface SourceReference {
  id: string;
}

interface CreateSourceInput {
  userId: string;
  name: string;
  url: string;
}

interface CreateSourceDependencies<TSource extends SourceReference> {
  acquireAccountLock: (userId: string) => Promise<void>;
  countExistingAccounts: (userId: string) => Promise<number>;
  canAddAccount: (userId: string, existingAccountCount: number) => Promise<boolean>;
  validateSourceUrl: (url: string) => Promise<void>;
  createCalendarAccount: (payload: {
    userId: string;
    displayName: string;
  }) => Promise<string | undefined>;
  createSourceCalendar: (payload: {
    accountId: string;
    name: string;
    url: string;
    userId: string;
  }) => Promise<TSource | undefined>;
  spawnBackgroundJob: (
    jobName: string,
    fields: Record<string, unknown>,
    callback: () => Promise<void>,
  ) => void;
  fetchAndSyncSource: (source: TSource) => Promise<void>;
  enqueuePushSync: (userId: string) => Promise<void>;
}

class SourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

class InvalidSourceUrlError extends Error {
  public readonly authRequired: boolean;

  constructor(cause?: unknown) {
    if (cause instanceof CalendarFetchError) {
      super(cause.message);
      this.authRequired = cause.authRequired;
    } else {
      super("Invalid calendar URL");
      this.authRequired = false;
    }
    this.cause = cause;
  }
}

class SourceCalendarAccountCreateError extends Error {
  constructor() {
    super("Failed to create calendar account");
  }
}

class SourceCalendarCreateError extends Error {
  constructor() {
    super("Failed to create source");
  }
}

class SourceProvisioningInvariantError extends Error {
  constructor() {
    super("Invariant violated: source provisioning did not request bootstrap sync");
  }
}

const runCreateSource = async <TSource extends SourceReference>(
  input: CreateSourceInput,
  dependencies: CreateSourceDependencies<TSource>,
): Promise<TSource> => {
  const requestId = crypto.randomUUID();
  const provisioningDispatcher = createSourceProvisioningDispatcher({
    actorId: "api-source-lifecycle",
    mode: "create_single",
    provider: "ics",
    requestId,
    transitionPolicy: TransitionPolicy.REJECT,
    userId: input.userId,
  });
  const dispatchProvisioningEvent = provisioningDispatcher.dispatch;

  await dependencies.acquireAccountLock(input.userId);
  const existingAccountCount = await dependencies.countExistingAccounts(input.userId);
  const allowed = await dependencies.canAddAccount(input.userId, existingAccountCount);
  if (!allowed) {
    dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });
    dispatchProvisioningEvent({ type: "QUOTA_DENIED" });
    throw new SourceLimitError();
  }

  try {
    await dependencies.validateSourceUrl(input.url);
  } catch (error) {
    dispatchProvisioningEvent({
      reason: "invalid_source",
      type: "VALIDATION_FAILED",
    });
    throw new InvalidSourceUrlError(error);
  }
  dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });
  dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
  dispatchProvisioningEvent({ type: "DEDUPLICATION_PASSED" });

  const accountId = await dependencies.createCalendarAccount({
    displayName: input.url,
    userId: input.userId,
  });
  if (!accountId) {
    throw new SourceCalendarAccountCreateError();
  }
  dispatchProvisioningEvent({
    accountId,
    type: "ACCOUNT_CREATED",
  });

  const source = await dependencies.createSourceCalendar({
    accountId,
    name: input.name,
    url: input.url,
    userId: input.userId,
  });
  if (!source) {
    throw new SourceCalendarCreateError();
  }
  dispatchProvisioningEvent({
    sourceIds: [source.id],
    type: "SOURCE_CREATED",
  });
  const completionTransition = dispatchProvisioningEvent({
    mode: "create_single",
    sourceIds: [source.id],
    type: "BOOTSTRAP_SYNC_TRIGGERED",
  });
  const bootstrapRequested = completionTransition.outputs.some(
    (output) => output.type === "BOOTSTRAP_REQUESTED",
  );
  if (!bootstrapRequested) {
    throw new SourceProvisioningInvariantError();
  }

  dependencies.spawnBackgroundJob("ical-source-sync", { userId: input.userId, calendarId: source.id }, async () => {
    await dependencies.fetchAndSyncSource(source);
    await dependencies.enqueuePushSync(input.userId);
  });

  return source;
};

export {
  SourceLimitError,
  InvalidSourceUrlError,
  SourceCalendarAccountCreateError,
  SourceCalendarCreateError,
  SourceProvisioningInvariantError,
  runCreateSource,
};
export type {
  SourceReference,
  CreateSourceInput,
  CreateSourceDependencies,
};
