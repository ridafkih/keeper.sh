import { MS_PER_MINUTE } from "@keeper.sh/constants";

const STATE_EXPIRY_MINUTES = 10;
const STATE_PREFIX = "oauth:state:";
const MS_PER_SECOND = 1000;

interface PendingState {
  userId: string;
  destinationId: string | null;
  sourceCredentialId: string | null;
  expiresAt: number;
}

interface ValidatedState {
  userId: string;
  destinationId: string | null;
  sourceCredentialId: string | null;
}

interface GenerateStateOptions {
  destinationId?: string;
  sourceCredentialId?: string;
}

interface OAuthStateStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  consume(key: string): Promise<string | null>;
}

const createInMemoryStateStore = (): OAuthStateStore => {
  const pendingStates = new Map<string, { value: string; expiresAt: number }>();

  return {
    set(key, value, ttlSeconds) {
      pendingStates.set(key, {
        expiresAt: Date.now() + ttlSeconds * MS_PER_SECOND,
        value,
      });
      return Promise.resolve();
    },
    consume(key) {
      const entry = pendingStates.get(key);
      if (!entry) {
        return Promise.resolve(null);
      }

      pendingStates.delete(key);

      if (Date.now() > entry.expiresAt) {
        return Promise.resolve(null);
      }

      return Promise.resolve(entry.value);
    },
  };
};

let stateStore: OAuthStateStore = createInMemoryStateStore();

const configureStateStore = (store: OAuthStateStore): void => {
  stateStore = store;
};

const getStateKey = (state: string): string => `${STATE_PREFIX}${state}`;

const STATE_EXPIRY_SECONDS = STATE_EXPIRY_MINUTES * MS_PER_MINUTE / MS_PER_SECOND;

const generateState = async (userId: string, options?: GenerateStateOptions): Promise<string> => {
  const state = crypto.randomUUID();
  const pendingState: PendingState = {
    destinationId: options?.destinationId ?? null,
    expiresAt: Date.now() + STATE_EXPIRY_MINUTES * MS_PER_MINUTE,
    sourceCredentialId: options?.sourceCredentialId ?? null,
    userId,
  };

  await stateStore.set(getStateKey(state), JSON.stringify(pendingState), STATE_EXPIRY_SECONDS);
  return state;
};

const validateState = async (state: string): Promise<ValidatedState | null> => {
  const raw = await stateStore.consume(getStateKey(state));
  if (!raw) {
    return null;
  }

  const entry: PendingState = JSON.parse(raw);

  if (Date.now() > entry.expiresAt) {
    return null;
  }

  return {
    destinationId: entry.destinationId,
    sourceCredentialId: entry.sourceCredentialId,
    userId: entry.userId,
  };
};

export { generateState, validateState, configureStateStore, createInMemoryStateStore };
export type { ValidatedState, GenerateStateOptions, OAuthStateStore };
