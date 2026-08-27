import { AsyncLocalStorage } from "node:async_hooks";
import { widelog } from "widelogger";

type DeleteUserAttemptStage = "committed" | "finished" | "started";

interface UnfinishedDeleteUserAttempt {
  committed: boolean;
  userId: string;
}

interface DeleteUserAttempt {
  commit: (userId: string) => void;
  finish: () => void;
  start: (userId: string) => void;
  unfinished: () => UnfinishedDeleteUserAttempt | null;
}

interface UserRowDeleter {
  deleteUser: (userId: string) => Promise<void>;
}

interface DeleteUserCompensation {
  compensate: (userId: string) => Promise<void>;
  finish: (userId: string) => Promise<void>;
  prepare: () => Promise<void>;
  userRowExists: UserRowProbe;
}

const createDeleteUserAttempt = (): DeleteUserAttempt => {
  let startedUserId: string | null = null;
  let stage: DeleteUserAttemptStage = "started";

  return {
    commit: (userId: string) => {
      if (startedUserId !== userId) {
        return;
      }

      if (stage === "started") {
        stage = "committed";
      }
    },
    finish: () => {
      stage = "finished";
    },
    start: (userId: string) => {
      startedUserId = userId;
    },
    unfinished: () => {
      if (startedUserId === null || stage === "finished") {
        return null;
      }

      return { committed: stage === "committed", userId: startedUserId };
    },
  };
};

type AuthRequestHandler = (request: Request) => Promise<Response>;

type UserRowProbe = (userId: string) => Promise<boolean>;

const userRowSurvived = async (
  userId: string,
  userRowExists: UserRowProbe,
): Promise<boolean> => {
  try {
    return await userRowExists(userId);
  } catch (error) {
    widelog.errorFields(error, {
      retriable: false,
      slug: "delete-user-row-probe-failed",
    });
    return true;
  }
};

const settleDeleteUserAttempt = async (
  unfinished: UnfinishedDeleteUserAttempt,
  compensate: (userId: string) => Promise<void>,
  finish: (userId: string) => Promise<void>,
  userRowExists: UserRowProbe,
): Promise<void> => {
  if (unfinished.committed) {
    await finish(unfinished.userId);
    return;
  }

  if (!(await userRowSurvived(unfinished.userId, userRowExists))) {
    widelog.setFields({ "delete_user.committed_without_acknowledgement": true });
    await finish(unfinished.userId);
    return;
  }

  await compensate(unfinished.userId);
};

interface DeleteUserCompensationScope {
  finishDeleteUserAttempt: () => void;
  instrumentUserRowDelete: (adapter: UserRowDeleter) => void;
  startDeleteUserAttempt: (userId: string) => void;
  withDeleteUserCompensation: (
    handler: AuthRequestHandler,
    compensation: DeleteUserCompensation,
  ) => AuthRequestHandler;
}

const createDeleteUserCompensationScope = (): DeleteUserCompensationScope => {
  const attempts = new AsyncLocalStorage<DeleteUserAttempt>();
  const instrumentedDeleters = new WeakSet<UserRowDeleter>();

  const commitDeleteUserAttempt = (userId: string): void => {
    attempts.getStore()?.commit(userId);
  };

  return {
    finishDeleteUserAttempt: () => {
      attempts.getStore()?.finish();
    },
    instrumentUserRowDelete: (adapter: UserRowDeleter) => {
      if (instrumentedDeleters.has(adapter)) {
        return;
      }

      const deleteUserRow = adapter.deleteUser;

      if (typeof deleteUserRow !== "function") {
        throw new TypeError("internal adapter does not expose a deleteUser function");
      }

      adapter.deleteUser = async (userId: string) => {
        await deleteUserRow.call(adapter, userId);
        commitDeleteUserAttempt(userId);
      };

      instrumentedDeleters.add(adapter);
    },
    startDeleteUserAttempt: (userId: string) => {
      attempts.getStore()?.start(userId);
    },
    withDeleteUserCompensation: (
      handler: AuthRequestHandler,
      { compensate, finish, prepare, userRowExists }: DeleteUserCompensation,
    ): AuthRequestHandler => {
      if (typeof userRowExists !== "function") {
        throw new TypeError(
          "withDeleteUserCompensation requires a userRowExists probe; without one a committed delete would be rolled back",
        );
      }

      return async (request: Request): Promise<Response> => {
        const attempt = createDeleteUserAttempt();

        await prepare();

        try {
          return await attempts.run(attempt, () => handler(request));
        } finally {
          const unfinished = attempt.unfinished();

          if (unfinished !== null) {
            await settleDeleteUserAttempt(unfinished, compensate, finish, userRowExists);
          }
        }
      };
    },
  };
};

export { createDeleteUserCompensationScope };
export type {
  AuthRequestHandler,
  DeleteUserAttempt,
  DeleteUserCompensation,
  DeleteUserCompensationScope,
  UserRowDeleter,
  UserRowProbe,
};
