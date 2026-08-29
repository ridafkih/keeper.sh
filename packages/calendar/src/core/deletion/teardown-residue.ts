import {
  GOOGLE_WATCH_MAX_LIFETIME_MS,
  GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS,
} from "../source/push-provider-profile";

const OAUTH_GRANT_RESIDUE_KIND = "oauth_grant";
const PUSH_CHANNEL_RESIDUE_KIND = "push_channel";
const POLAR_CUSTOMER_RESIDUE_KIND = "polar_customer";
const RESIDUE_REPAIR_MARGIN_MS = 24 * 60 * 60 * 1000;

const RESIDUE_LIFETIME_MS =
  Math.max(GOOGLE_WATCH_MAX_LIFETIME_MS, GRAPH_SUBSCRIPTION_MAX_LIFETIME_MS)
  + RESIDUE_REPAIR_MARGIN_MS;

const OAUTH_GRANT_RESIDUE_LIFETIME_MS = 60 * 60 * 1000;

const residueLifetimeMs = (kind: string): number => {
  if (kind === OAUTH_GRANT_RESIDUE_KIND) {
    return OAUTH_GRANT_RESIDUE_LIFETIME_MS;
  }

  return RESIDUE_LIFETIME_MS;
};

const TEARDOWN_RESIDUE_KINDS = [
  OAUTH_GRANT_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
  POLAR_CUSTOMER_RESIDUE_KIND,
] as const;

interface TeardownResidueCredential {
  accessToken: string;
  expiresAt: Date | null;
  refreshToken: string | null;
}

interface TeardownResidueDraft {
  credential?: TeardownResidueCredential;
  externalId?: string;
  kind: string;
  provider?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

interface TeardownResidueRecord extends TeardownResidueDraft {
  attempts?: number;
  createdAt?: Date;
  expiresAt?: Date;
  id: string;
}

interface TeardownResidueStore {
  clear: (residueId: string) => Promise<void>;
  delete?: (userId: string, kind: string, providerChannelId: string) => Promise<number>;
  deleteForUser: (userId: string, kind: string) => Promise<number>;
  list: () => Promise<TeardownResidueRecord[]>;
  purgeOrphaned: (now: Date) => Promise<string[]>;
  record: (draft: TeardownResidueDraft) => Promise<void>;
  spendRepairAttempt: (residueId: string) => Promise<number>;
}

type TeardownResidueRecorder = TeardownResidueStore["record"];

export {
  OAUTH_GRANT_RESIDUE_KIND,
  OAUTH_GRANT_RESIDUE_LIFETIME_MS,
  POLAR_CUSTOMER_RESIDUE_KIND,
  PUSH_CHANNEL_RESIDUE_KIND,
  RESIDUE_LIFETIME_MS,
  residueLifetimeMs,
  TEARDOWN_RESIDUE_KINDS,
};
export type {
  TeardownResidueCredential,
  TeardownResidueDraft,
  TeardownResidueRecord,
  TeardownResidueRecorder,
  TeardownResidueStore,
};
