import { normalizeCalDAVCalendarKey } from "@keeper.sh/calendar/caldav";

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
  findHeldCalendars: () => Promise<ConnectedCalDAVCalendar[]>;
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

const uniqueByCalendarKey = (
  calendars: CalDAVCalendarSelection[],
): CalDAVCalendarSelection[] => [
  ...new Map(
    calendars.map((calendar) => [normalizeCalDAVCalendarKey(calendar.calendarUrl), calendar]),
  ).values(),
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

const toCalendarsByKey = (
  calendars: ConnectedCalDAVCalendar[],
): Map<string, ConnectedCalDAVCalendar> =>
  new Map(calendars.map((calendar) => [normalizeCalDAVCalendarKey(calendar.calendarUrl), calendar]));

const describeSelection = (
  selection: CalDAVCalendarSelection[],
  held: Map<string, ConnectedCalDAVCalendar>,
  imported: Map<string, ConnectedCalDAVCalendar>,
): ImportedCalDAVCalendar[] =>
  selection.map(({ calendarUrl }): ImportedCalDAVCalendar => {
    const key = normalizeCalDAVCalendarKey(calendarUrl);
    const existing = held.get(key);
    if (existing) {
      return { ...existing, status: "already_connected" };
    }
    const created = imported.get(key);
    if (!created) {
      throw new Error("A selected CalDAV calendar was neither found nor created");
    }
    return { ...created, status: "imported" };
  });

const resolveHoldingAccountId = (
  reusableAccountId: string | null,
  held: ConnectedCalDAVCalendar[],
): string => {
  const accountId = reusableAccountId ?? held[0]?.accountId;
  if (!accountId) {
    throw new Error("A fully connected CalDAV selection has no holding account");
  }
  return accountId;
};

const importCalDAVCalendarsWithDependencies = (
  requestedCalendars: CalDAVCalendarSelection[],
  dependencies: CalDAVImportDependencies,
): Promise<CalDAVImportResult> =>
  dependencies.runInTransaction(async (transaction) => {
    await transaction.lockUserAccounts();

    const selection = uniqueByCalendarKey(requestedCalendars);
    const reusableAccountId = await transaction.findReusableAccountId();
    const held = toCalendarsByKey(await transaction.findHeldCalendars());
    const missing = selection.filter(
      ({ calendarUrl }) => !held.has(normalizeCalDAVCalendarKey(calendarUrl)),
    );
    const heldSelection = selection.flatMap(({ calendarUrl }) => {
      const calendar = held.get(normalizeCalDAVCalendarKey(calendarUrl));
      if (!calendar) {
        return [];
      }
      return [calendar];
    });

    if (missing.length === 0) {
      return {
        accountId: resolveHoldingAccountId(reusableAccountId, heldSelection),
        calendars: describeSelection(selection, held, new Map()),
      };
    }

    const accountId =
      reusableAccountId ?? (await createImportAccount(transaction, dependencies.accountLimit));
    const imported = toCalendarsByKey(await transaction.insertCalendars(accountId, missing));

    return {
      accountId,
      calendars: describeSelection(selection, held, imported),
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
