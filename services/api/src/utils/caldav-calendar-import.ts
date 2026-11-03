class CalDAVSourceLimitError extends Error {
  constructor() {
    super("Account limit reached. Upgrade to Pro for unlimited accounts.");
  }
}

interface CalDAVCalendarSelection {
  calendarUrl: string;
  name: string;
}

interface CalDAVAccountCredentials {
  authMethod: string;
  password: string;
  provider: string;
  serverUrl: string;
  username: string;
}

interface ImportCalDAVCalendarsData extends CalDAVAccountCredentials {
  calendars: CalDAVCalendarSelection[];
}

interface ConnectedCalDAVCalendar extends CalDAVCalendarSelection {
  id: string;
  accountId: string;
}

type CalDAVCalendarImportStatus = "imported" | "already_connected";

interface ImportedCalDAVCalendar extends ConnectedCalDAVCalendar {
  status: CalDAVCalendarImportStatus;
}

interface CalDAVImportResult {
  accountId: string;
  calendars: ImportedCalDAVCalendar[];
}

interface CalDAVImportTransaction {
  lockUserAccounts: () => Promise<void>;
  findConnectedCalendars: (
    accountId: string,
    calendarUrls: string[],
  ) => Promise<ConnectedCalDAVCalendar[]>;
  findReusableAccountId: () => Promise<string | null>;
  countAccounts: () => Promise<number>;
  createAccount: () => Promise<string>;
  insertCalendars: (
    accountId: string,
    calendars: CalDAVCalendarSelection[],
  ) => Promise<ConnectedCalDAVCalendar[]>;
}

interface CalDAVImportDependencies {
  accountLimit: number;
  runInTransaction: <TResult>(
    work: (transaction: CalDAVImportTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

const uniqueByCalendarUrl = (
  calendars: CalDAVCalendarSelection[],
): CalDAVCalendarSelection[] => [
  ...new Map(calendars.map((calendar) => [calendar.calendarUrl, calendar])).values(),
];

const createImportAccount = async (
  transaction: CalDAVImportTransaction,
  accountLimit: number,
): Promise<string> => {
  const accountCount = await transaction.countAccounts();
  if (accountCount >= accountLimit) {
    throw new CalDAVSourceLimitError();
  }

  return transaction.createAccount();
};

const toCalendarsByUrl = (
  calendars: ConnectedCalDAVCalendar[],
): Map<string, ConnectedCalDAVCalendar> =>
  new Map(calendars.map((calendar) => [calendar.calendarUrl, calendar]));

const describeSelection = (
  selection: CalDAVCalendarSelection[],
  connected: Map<string, ConnectedCalDAVCalendar>,
  imported: Map<string, ConnectedCalDAVCalendar>,
): ImportedCalDAVCalendar[] =>
  selection.map(({ calendarUrl }): ImportedCalDAVCalendar => {
    const existing = connected.get(calendarUrl);
    if (existing) {
      return { ...existing, status: "already_connected" };
    }
    const created = imported.get(calendarUrl);
    if (!created) {
      throw new Error("A selected CalDAV calendar was neither found nor created");
    }
    return { ...created, status: "imported" };
  });

const findCalendarsConnectedToAccount = (
  transaction: CalDAVImportTransaction,
  accountId: string | null,
  selection: CalDAVCalendarSelection[],
): Promise<ConnectedCalDAVCalendar[]> => {
  if (!accountId) {
    return Promise.resolve([]);
  }
  return transaction.findConnectedCalendars(
    accountId,
    selection.map(({ calendarUrl }) => calendarUrl),
  );
};

const importCalDAVCalendarsWithDependencies = (
  requestedCalendars: CalDAVCalendarSelection[],
  dependencies: CalDAVImportDependencies,
): Promise<CalDAVImportResult> =>
  dependencies.runInTransaction(async (transaction) => {
    await transaction.lockUserAccounts();

    const selection = uniqueByCalendarUrl(requestedCalendars);
    const reusableAccountId = await transaction.findReusableAccountId();
    const connected = toCalendarsByUrl(
      await findCalendarsConnectedToAccount(transaction, reusableAccountId, selection),
    );
    const missing = selection.filter(({ calendarUrl }) => !connected.has(calendarUrl));

    if (reusableAccountId && missing.length === 0) {
      return {
        accountId: reusableAccountId,
        calendars: describeSelection(selection, connected, new Map()),
      };
    }

    const accountId =
      reusableAccountId ?? (await createImportAccount(transaction, dependencies.accountLimit));
    const imported = toCalendarsByUrl(await transaction.insertCalendars(accountId, missing));

    return {
      accountId,
      calendars: describeSelection(selection, connected, imported),
    };
  });

export {
  CalDAVSourceLimitError,
  importCalDAVCalendarsWithDependencies,
};
export type {
  CalDAVAccountCredentials,
  CalDAVCalendarImportStatus,
  CalDAVCalendarSelection,
  CalDAVImportDependencies,
  CalDAVImportResult,
  CalDAVImportTransaction,
  ConnectedCalDAVCalendar,
  ImportCalDAVCalendarsData,
};
