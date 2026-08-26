import { AsyncLocalStorage } from "node:async_hooks";

interface DeleteUserAttempt {
  commit: () => void;
  start: (userId: string) => void;
  uncommittedUserId: () => string | null;
}

const deleteUserAttempts = new AsyncLocalStorage<DeleteUserAttempt>();

const createDeleteUserAttempt = (): DeleteUserAttempt => {
  let startedUserId: string | null = null;
  let committed = false;

  const uncommittedUserId = (): string | null => {
    if (committed) {
      return null;
    }

    return startedUserId;
  };

  return {
    commit: () => {
      committed = true;
    },
    start: (userId: string) => {
      startedUserId = userId;
    },
    uncommittedUserId,
  };
};

const startDeleteUserAttempt = (userId: string): void => {
  deleteUserAttempts.getStore()?.start(userId);
};

const commitDeleteUserAttempt = (): void => {
  deleteUserAttempts.getStore()?.commit();
};

type AuthRequestHandler = (request: Request) => Promise<Response>;

const withDeleteUserCompensation = (
  handler: AuthRequestHandler,
  compensate: (userId: string) => Promise<void>,
): AuthRequestHandler =>
  async (request: Request): Promise<Response> => {
    const attempt = createDeleteUserAttempt();

    try {
      return await deleteUserAttempts.run(attempt, () => handler(request));
    } finally {
      const uncommittedUserId = attempt.uncommittedUserId();

      if (uncommittedUserId !== null) {
        await compensate(uncommittedUserId);
      }
    }
  };

export {
  commitDeleteUserAttempt,
  startDeleteUserAttempt,
  withDeleteUserCompensation,
};
export type { AuthRequestHandler, DeleteUserAttempt };
