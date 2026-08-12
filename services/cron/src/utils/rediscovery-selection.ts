interface RediscoveryCandidate {
  accountId: string;
  userId: string;
  provider: string;
  authType: string;
  calendarsRefreshAttemptedAt: Date | null;
  calendarsRefreshedAt: Date | null;
}

interface RediscoverySelectionOptions {
  now: Date;
  stalenessMs: number;
  batchLimit: number;
}

interface RediscoverySelection<TCandidate> {
  due: TCandidate[];
  truncated: boolean;
}

const NEVER_ATTEMPTED_ORDER = -1;

const isDue = (
  candidate: RediscoveryCandidate,
  options: RediscoverySelectionOptions,
): boolean => {
  if (candidate.calendarsRefreshAttemptedAt === null) {
    return true;
  }

  const elapsedMs = options.now.getTime() - candidate.calendarsRefreshAttemptedAt.getTime();

  return elapsedMs >= options.stalenessMs;
};

const toAttemptOrder = (candidate: RediscoveryCandidate): number =>
  candidate.calendarsRefreshAttemptedAt?.getTime() ?? NEVER_ATTEMPTED_ORDER;

const selectAccountsDueForRediscovery = <TCandidate extends RediscoveryCandidate>(
  candidates: TCandidate[],
  options: RediscoverySelectionOptions,
): RediscoverySelection<TCandidate> => {
  const due = candidates
    .filter((candidate) => isDue(candidate, options))
    .toSorted((left, right) => toAttemptOrder(left) - toAttemptOrder(right));

  return {
    due: due.slice(0, options.batchLimit),
    truncated: due.length > options.batchLimit,
  };
};

const excludeUnconfiguredCalDAVAccounts = <TCandidate extends { authType: string }>(
  candidates: TCandidate[],
  hasEncryptionKey: boolean,
): { selectable: TCandidate[]; excluded: number } => {
  if (hasEncryptionKey) {
    return { excluded: 0, selectable: candidates };
  }

  const selectable = candidates.filter((candidate) => candidate.authType !== "caldav");

  return { excluded: candidates.length - selectable.length, selectable };
};

const excludeAccountsWithoutImportedCalendars = <
  TCandidate extends { hasImportedCalendar: boolean },
>(
  candidates: TCandidate[],
): { selectable: TCandidate[]; excluded: number } => {
  const selectable = candidates.filter((candidate) => candidate.hasImportedCalendar);

  return { excluded: candidates.length - selectable.length, selectable };
};

export {
  excludeAccountsWithoutImportedCalendars,
  excludeUnconfiguredCalDAVAccounts,
  selectAccountsDueForRediscovery,
};
export type { RediscoveryCandidate, RediscoverySelection, RediscoverySelectionOptions };
