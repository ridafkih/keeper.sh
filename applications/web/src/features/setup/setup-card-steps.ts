import { canPull, canPush, type CalendarLike } from "@/utils/calendars";

export type SetupStepKey = "connect" | "second" | "sync";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

export interface SetupSteps {
  show: boolean;
  steps: SetupStep[];
}

// The second step is about having something to sync between, not about a second account.
export const canFormSync = (calendars: readonly (CalendarLike & { id: string })[]): boolean =>
  calendars.some((from) => canPull(from) && calendars.some((to) => to.id !== from.id && canPush(to)));

export const resolveSetupSteps = ({
  sourceCount,
  pairable,
  syncCount,
  usesFeeds,
}: {
  sourceCount: number;
  pairable: boolean;
  syncCount: number;
  // Someone who only combines calendars into iCal feeds has no use for a sync.
  usesFeeds: boolean;
}): SetupSteps => ({
  show: syncCount === 0 && !usesFeeds,
  steps: [
    { done: sourceCount > 0, key: "connect" },
    { done: pairable, key: "second" },
    { done: syncCount > 0, key: "sync" },
  ],
});
