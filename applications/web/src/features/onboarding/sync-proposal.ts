interface ProposalCalendar {
  id: string;
  name: string;
  accountId: string;
  capabilities: string[];
}

interface ProposalAccount {
  id: string;
  createdAt: string;
}

interface SyncProposal<TCalendar extends ProposalCalendar = ProposalCalendar> {
  origin: TCalendar;
  destination: TCalendar;
  forward: boolean;
  backward: boolean;
}

interface ProposeSyncInput<TCalendar extends ProposalCalendar> {
  calendars: TCalendar[];
  accounts: ProposalAccount[];
  chosenDestinationId?: string;
}

const byConnectionOrder = (accounts: ProposalAccount[]): ProposalAccount[] =>
  [...accounts].sort((first, second) => first.createdAt.localeCompare(second.createdAt));

const isWritable = (calendar: ProposalCalendar): boolean => calendar.capabilities.includes("push");

const isReadable = (calendar: ProposalCalendar): boolean => calendar.capabilities.includes("pull");

const resolvePrimaryCalendar = <TCalendar extends ProposalCalendar>(
  calendars: TCalendar[],
  accountId: string,
): TCalendar | null => {
  const accountCalendars = calendars.filter((calendar) => calendar.accountId === accountId);
  return accountCalendars.find(isWritable) ?? accountCalendars[0] ?? null;
};

const resolveOrigin = <TCalendar extends ProposalCalendar>(
  calendars: TCalendar[],
  accounts: ProposalAccount[],
): TCalendar | null => {
  for (const account of byConnectionOrder(accounts)) {
    const primary = resolvePrimaryCalendar(calendars, account.id);
    if (primary) return primary;
  }
  return null;
};

const listSameAccountDestinations = <TCalendar extends ProposalCalendar>(
  calendars: TCalendar[],
  origin: ProposalCalendar,
): TCalendar[] =>
  calendars.filter((calendar) =>
    calendar.accountId === origin.accountId && calendar.id !== origin.id && isWritable(calendar));

const resolveNewestAccountDestination = <TCalendar extends ProposalCalendar>(
  calendars: TCalendar[],
  accounts: ProposalAccount[],
  origin: ProposalCalendar,
): TCalendar | null => {
  const laterAccounts = byConnectionOrder(accounts)
    .filter((account) => account.id !== origin.accountId)
    .reverse();
  for (const account of laterAccounts) {
    const primary = resolvePrimaryCalendar(calendars, account.id);
    if (primary) return primary;
  }
  return null;
};

const resolveDestination = <TCalendar extends ProposalCalendar>(
  { calendars, accounts, chosenDestinationId }: ProposeSyncInput<TCalendar>,
  origin: ProposalCalendar,
): TCalendar | null => {
  const chosen = calendars.find((calendar) => calendar.id === chosenDestinationId);
  if (chosen && chosen.id !== origin.id) return chosen;
  return resolveNewestAccountDestination(calendars, accounts, origin);
};

const proposeSync = <TCalendar extends ProposalCalendar>(
  input: ProposeSyncInput<TCalendar>,
): SyncProposal<TCalendar> | null => {
  const origin = resolveOrigin(input.calendars, input.accounts);
  if (!origin) return null;

  const destination = resolveDestination(input, origin);
  if (!destination) return null;

  const forward = isReadable(origin) && isWritable(destination);
  const backward = isReadable(destination) && isWritable(origin);
  if (!forward && !backward) return null;

  return { backward, destination, forward, origin };
};

export { listSameAccountDestinations, proposeSync, resolveOrigin };
export type { ProposalAccount, ProposalCalendar, ProposeSyncInput, SyncProposal };
