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
  findConnectedCalendars: (calendarUrls: string[]) => Promise<ConnectedCalDAVCalendar[]>;
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

const resolveImportAccountId = async (
  transaction: CalDAVImportTransaction,
  accountLimit: number,
): Promise<string> => {
  const reusableAccountId = await transaction.findReusableAccountId();
  if (reusableAccountId) {
    return reusableAccountId;
  }

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

const resolveConnectedAccountId = (calendars: ConnectedCalDAVCalendar[]): string => {
  const [firstCalendar] = calendars;
  if (!firstCalendar) {
    throw new Error("A CalDAV import resolved no account");
  }
  return firstCalendar.accountId;
};

const importCalDAVCalendarsWithDependencies = (
  requestedCalendars: CalDAVCalendarSelection[],
  dependencies: CalDAVImportDependencies,
): Promise<CalDAVImportResult> =>
  dependencies.runInTransaction(async (transaction) => {
    await transaction.lockUserAccounts();

    const selection = uniqueByCalendarUrl(requestedCalendars);
    const connectedCalendars = await transaction.findConnectedCalendars(
      selection.map(({ calendarUrl }) => calendarUrl),
    );
    const connected = toCalendarsByUrl(connectedCalendars);
    const missing = selection.filter(({ calendarUrl }) => !connected.has(calendarUrl));

    if (missing.length === 0) {
      return {
        accountId: resolveConnectedAccountId(connectedCalendars),
        calendars: describeSelection(selection, connected, new Map()),
      };
    }

    const accountId = await resolveImportAccountId(transaction, dependencies.accountLimit);
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
