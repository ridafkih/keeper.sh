const MS_PER_MINUTE = 60 * 1000;
const GOOGLE_WATCH_MAX_LIFETIME_MS = 7 * 24 * 60 * MS_PER_MINUTE;
const GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS = 10_080 * MS_PER_MINUTE;
const PROVIDER_LIFETIME_SAFETY_MS = 60 * MS_PER_MINUTE;
const RENEWAL_LEAD_DIVISOR = 5;
const EXPIRY_STAGGER_DIVISOR = 4;

type PushChannelRenewalMode = "extend" | "recreate";

interface PushProviderProfile {
  maxLifetimeMs: number;
  provider: string;
  renewalMode: PushChannelRenewalMode;
  requiresProviderAccountId: boolean;
  scopeKind: "calendar";
  supportsList: boolean;
}

const GOOGLE_PUSH_PROFILE: PushProviderProfile = {
  maxLifetimeMs: GOOGLE_WATCH_MAX_LIFETIME_MS,
  provider: "google",
  renewalMode: "recreate",
  requiresProviderAccountId: false,
  scopeKind: "calendar",
  supportsList: false,
};

const OUTLOOK_PUSH_PROFILE: PushProviderProfile = {
  maxLifetimeMs: GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS,
  provider: "outlook",
  renewalMode: "extend",
  requiresProviderAccountId: true,
  scopeKind: "calendar",
  supportsList: true,
};

const PUSH_PROVIDER_PROFILES: Record<string, PushProviderProfile> = {
  google: GOOGLE_PUSH_PROFILE,
  outlook: OUTLOOK_PUSH_PROFILE,
};

const resolvePushProviderProfile = (provider: string): PushProviderProfile | null =>
  PUSH_PROVIDER_PROFILES[provider] ?? null;

const resolveRenewalLeadMs = (maxLifetimeMs: number): number =>
  maxLifetimeMs / RENEWAL_LEAD_DIVISOR;

const resolveStaggerPeriodMs = (maxLifetimeMs: number): number =>
  maxLifetimeMs / EXPIRY_STAGGER_DIVISOR;

const clampToProviderLifetime = (
  requestedExpiresAt: Date,
  now: Date,
  maxLifetimeMs: number,
): Date => {
  const latestAllowed = now.getTime() + maxLifetimeMs - PROVIDER_LIFETIME_SAFETY_MS;
  return new Date(Math.min(requestedExpiresAt.getTime(), latestAllowed));
};

export {
  clampToProviderLifetime,
  GOOGLE_PUSH_PROFILE,
  GOOGLE_WATCH_MAX_LIFETIME_MS,
  GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS,
  OUTLOOK_PUSH_PROFILE,
  PROVIDER_LIFETIME_SAFETY_MS,
  PUSH_PROVIDER_PROFILES,
  resolvePushProviderProfile,
  resolveRenewalLeadMs,
  resolveStaggerPeriodMs,
};
export type { PushChannelRenewalMode, PushProviderProfile };
