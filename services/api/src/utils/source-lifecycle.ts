import { CalendarFetchError } from "@keeper.sh/calendar/ics";

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

const runCreateSource = async <TSource extends SourceReference>(
  input: CreateSourceInput,
  dependencies: CreateSourceDependencies<TSource>,
): Promise<TSource> => {
  await dependencies.acquireAccountLock(input.userId);
  const existingAccountCount = await dependencies.countExistingAccounts(input.userId);
  const allowed = await dependencies.canAddAccount(input.userId, existingAccountCount);
  if (!allowed) {
    throw new SourceLimitError();
  }

  try {
    await dependencies.validateSourceUrl(input.url);
  } catch (error) {
    throw new InvalidSourceUrlError(error);
  }

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
  runCreateSource,
};
export type {
  SourceReference,
  CreateSourceInput,
  CreateSourceDependencies,
};
