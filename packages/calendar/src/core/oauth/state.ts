import { MS_PER_MINUTE } from "@keeper.sh/constants";

const STATE_EXPIRY_MINUTES = 10;
const STATE_PREFIX = "oauth:state:";
const MS_PER_SECOND = 1000;

// Where the web app sends someone after the callback; kept server side, so it can only name a known page.
type OAuthReturnTo = "onboarding";

interface PendingState {
  userId: string;
  destinationId: string | null;
  sourceCredentialId: string | null;
  returnTo?: OAuthReturnTo | null;
  expiresAt: number;
}

interface ValidatedState {
  userId: string;
  destinationId: string | null;
  sourceCredentialId: string | null;
  returnTo: OAuthReturnTo | null;
}

interface GenerateStateOptions {
  destinationId?: string;
  sourceCredentialId?: string;
  returnTo?: OAuthReturnTo;
}

interface OAuthStateStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  consume(key: string): Promise<string | null>;
}

const getStateKey = (state: string): string => `${STATE_PREFIX}${state}`;

const STATE_EXPIRY_SECONDS = STATE_EXPIRY_MINUTES * MS_PER_MINUTE / MS_PER_SECOND;

const generateState = async (
  store: OAuthStateStore,
  userId: string,
  options?: GenerateStateOptions,
): Promise<string> => {
  const state = crypto.randomUUID();
  const pendingState: PendingState = {
    destinationId: options?.destinationId ?? null,
    expiresAt: Date.now() + STATE_EXPIRY_MINUTES * MS_PER_MINUTE,
    returnTo: options?.returnTo ?? null,
    sourceCredentialId: options?.sourceCredentialId ?? null,
    userId,
  };

  await store.set(getStateKey(state), JSON.stringify(pendingState), STATE_EXPIRY_SECONDS);
  return state;
};

const validateState = async (
  store: OAuthStateStore,
  state: string,
): Promise<ValidatedState | null> => {
  const raw = await store.consume(getStateKey(state));
  if (!raw) {
    return null;
  }

  const entry: PendingState = JSON.parse(raw);

  if (Date.now() > entry.expiresAt) {
    return null;
  }

  return {
    destinationId: entry.destinationId,
    returnTo: entry.returnTo ?? null,
    sourceCredentialId: entry.sourceCredentialId,
    userId: entry.userId,
  };
};

export { generateState, validateState };
export type { ValidatedState, GenerateStateOptions, OAuthReturnTo, OAuthStateStore };
