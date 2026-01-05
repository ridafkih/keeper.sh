import { MS_PER_MINUTE } from "@keeper.sh/constants";

interface PendingState {
  userId: string;
  destinationId: string | null;
  expiresAt: number;
}

export interface ValidatedState {
  userId: string;
  destinationId: string | null;
}

const pendingStates = new Map<string, PendingState>();

export const generateState = (userId: string, destinationId?: string): string => {
  const state = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * MS_PER_MINUTE;
  pendingStates.set(state, {
    userId,
    destinationId: destinationId ?? null,
    expiresAt,
  });
  return state;
};

export const validateState = (state: string): ValidatedState | null => {
  const entry = pendingStates.get(state);
  if (!entry) return null;

  pendingStates.delete(state);

  if (Date.now() > entry.expiresAt) return null;

  return { userId: entry.userId, destinationId: entry.destinationId };
};
