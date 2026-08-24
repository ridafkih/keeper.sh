import { CalendarFetchError } from "@keeper.sh/calendar/ics";

interface SourceReference {
  id: string;
}

interface CreateSourceInput {
  userId: string;
  name: string;
  url: string;
}

interface SourceCreationPreflightDependencies {
  countExistingAccounts: (userId: string) => Promise<number>;
  canAddAccount: (userId: string, existingAccountCount: number) => Promise<boolean>;
  validateSourceUrl: (url: string) => Promise<void>;
}

interface CreateSourceDependencies<TSource extends SourceReference> {
  acquireAccountLock: (userId: string) => Promise<void>;
  countExistingAccounts: (userId: string) => Promise<number>;
  canAddAccount: (userId: string, existingAccountCount: number) => Promise<boolean>;
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
  public constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
    this.name = "SourceLimitError";
  }
}

const getInvalidSourceUrlDetails = (cause: unknown): {
  authRequired: boolean;
  message: string;
} => {
  if (cause instanceof CalendarFetchError) {
    return {
      authRequired: cause.authRequired,
      message: cause.message,
    };
  }

  return {
    authRequired: false,
    message: "Invalid calendar URL",
  };
};

class InvalidSourceUrlError extends Error {
  public readonly authRequired: boolean;

  public constructor(cause?: unknown) {
    const details = getInvalidSourceUrlDetails(cause);
    super(details.message);
    this.name = "InvalidSourceUrlError";
    this.authRequired = details.authRequired;
    this.cause = cause;
  }
}

const assertAccountCanBeAdded = async (
  userId: string,
  dependencies: Pick<
    SourceCreationPreflightDependencies,
    "canAddAccount" | "countExistingAccounts"
  >,
): Promise<void> => {
  const existingAccountCount = await dependencies.countExistingAccounts(userId);
  const allowed = await dependencies.canAddAccount(userId, existingAccountCount);
  if (!allowed) {
    throw new SourceLimitError();
  }
};

const runSourceCreationPreflight = async (
  input: CreateSourceInput,
  dependencies: SourceCreationPreflightDependencies,
): Promise<void> => {
  await assertAccountCanBeAdded(input.userId, dependencies);

  try {
    await dependencies.validateSourceUrl(input.url);
  } catch (error) {
    throw new InvalidSourceUrlError(error);
  }
};

const runCreateSource = async <TSource extends SourceReference>(
  input: CreateSourceInput,
  dependencies: CreateSourceDependencies<TSource>,
): Promise<TSource> => {
  await dependencies.acquireAccountLock(input.userId);
  await assertAccountCanBeAdded(input.userId, dependencies);

  const accountId = await dependencies.createCalendarAccount({
    displayName: input.url,
    userId: input.userId,
  });
  if (!accountId) {
    throw new Error("Failed to create calendar account");
  }

  const source = await dependencies.createSourceCalendar({
    accountId,
    name: input.name,
    url: input.url,
    userId: input.userId,
  });
  if (!source) {
    throw new Error("Failed to create source");
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
  runSourceCreationPreflight,
  runCreateSource,
};
export type {
  SourceReference,
  CreateSourceInput,
  SourceCreationPreflightDependencies,
  CreateSourceDependencies,
};
