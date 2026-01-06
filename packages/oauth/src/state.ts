import { MS_PER_MINUTE } from "@keeper.sh/constants";

const STATE_EXPIRY_MINUTES = 10;

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

const pendingStates = new Map<string, PendingState>();

interface GenerateStateOptions {
  destinationId?: string;
  sourceCredentialId?: string;
}

const generateState = (userId: string, options?: GenerateStateOptions): string => {
  const state = crypto.randomUUID();
  const expiresAt = Date.now() + STATE_EXPIRY_MINUTES * MS_PER_MINUTE;
  pendingStates.set(state, {
    destinationId: options?.destinationId ?? null,
    expiresAt,
    sourceCredentialId: options?.sourceCredentialId ?? null,
    userId,
  });
  return state;
};

const validateState = (state: string): ValidatedState | null => {
  const entry = pendingStates.get(state);
  if (!entry) {
    return null;
  }

  pendingStates.delete(state);

  if (Date.now() > entry.expiresAt) {
    return null;
  }

  return {
    destinationId: entry.destinationId,
    sourceCredentialId: entry.sourceCredentialId,
    userId: entry.userId,
  };
};

export { generateState, validateState };
export type { ValidatedState, GenerateStateOptions };
