import type { Entitlements } from "@/hooks/use-entitlements";

// Plan-free deployments report every feature on, so this is only ever true for a free plan in commercial mode.
export const isSyncLocked = (entitlements: Entitlements | undefined): boolean =>
  Boolean(entitlements && !entitlements.canUseEventFilters);

// An API from before the calendar cap leaves it out, which reads as no limit.
export const syncCalendarLimit = (entitlements: Entitlements | undefined): number | null =>
  entitlements?.syncCalendars?.limit ?? null;

export const UPGRADE_ACTION = { label: "Upgrade to Pro", to: "/dashboard/upgrade" };
