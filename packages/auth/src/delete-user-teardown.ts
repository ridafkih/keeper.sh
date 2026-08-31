import { widelog } from "widelogger";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const TEARDOWN_BLOCKED_SLUG = "delete-user-teardown-blocked";
const RESIDUE_WRITE_FAILED_SLUG = "delete-user-teardown-residue-write-failed";
const TEARDOWN_BUDGET_MS = 9000;
const TEARDOWN_BLOCKED_ERROR_NAME = "TeardownBlockedError";
const SYNC_TEARDOWN_TIMEOUT_MS = 8000;

interface DeleteUserTeardownStep {
  name: string;
  run: (userId: string) => Promise<void>;
  timeoutMs?: number;
}

type DeleteUserTeardown = (userId: string) => Promise<void>;

interface DeleteUserResidueDraft {
  externalId: string;
  kind: string;
  userId: string;
}

type DeleteUserResidueRecorder = (draft: DeleteUserResidueDraft) => Promise<void>;

interface DeleteUserTeardownOptions {
  recordResidue: DeleteUserResidueRecorder | null;
}

const NO_RESIDUE: DeleteUserTeardownOptions = { recordResidue: null };

const isBlockingTeardownFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === TEARDOWN_BLOCKED_ERROR_NAME;

const runWithDeadline = async (
  name: string,
  deadlineMs: number,
  run: () => Promise<void>,
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Teardown step ${name} exceeded its ${deadlineMs}ms deadline`));
    }, deadlineMs);
  });

  try {
    await Promise.race([run(), deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const reportStepFailure = (
  error: unknown,
  stepName: string,
  userId: string,
  slug: string,
): void => {
  const failure = {
    "delete_user.user_id": userId,
    prefix: `delete_user_teardown.${stepName}`,
    retriable: false,
    slug,
  };

  widelog.setFields({ "delete_user.user_id": userId });
  widelog.errorFields(error, failure);
};

const recordStepResidue = async (
  recordResidue: DeleteUserResidueRecorder | null,
  stepName: string,
  userId: string,
): Promise<void> => {
  if (recordResidue === null) {
    return;
  }

  try {
    await recordResidue({ externalId: userId, kind: stepName, userId });
  } catch (error) {
    reportStepFailure(error, stepName, userId, RESIDUE_WRITE_FAILED_SLUG);
  }
};

const createDeleteUserTeardown = (
  steps: DeleteUserTeardownStep[],
  budgetMs = TEARDOWN_BUDGET_MS,
  options: DeleteUserTeardownOptions = NO_RESIDUE,
): DeleteUserTeardown => {
  if (steps.length === 0) {
    throw new Error(
      "createDeleteUserTeardown was given an empty step list, which would quiesce nothing on account deletion",
    );
  }

  return async (userId: string) => {
    const expiresAt = Date.now() + budgetMs;

    for (const step of steps) {
      const remainingMs = expiresAt - Date.now();
      const deadlineMs = Math.min(step.timeoutMs ?? remainingMs, remainingMs);

      try {
        if (deadlineMs <= 0) {
          throw new Error(`Teardown budget of ${budgetMs}ms was spent before step ${step.name}`);
        }

        await runWithDeadline(step.name, deadlineMs, () => step.run(userId));
      } catch (error) {
        reportStepFailure(error, step.name, userId, TEARDOWN_FAILED_SLUG);

        await recordStepResidue(options.recordResidue, step.name, userId);

        if (isBlockingTeardownFailure(error)) {
          throw error;
        }
      }
    }
  };
};

const createSkippedDeleteUserTeardown =
  (reason: string): DeleteUserTeardown =>
  () => {
    widelog.setFields({ "delete_user.teardown_skipped": reason });
    return Promise.resolve();
  };

const deleteUserResidueUnavailable: DeleteUserResidueRecorder = (draft) =>
  Promise.reject(
    new Error(
      `No teardown residue store is wired on this deployment: ${draft.kind} residue for ${draft.userId} cannot be kept`,
    ),
  );

const deleteUserTeardownUnavailable: DeleteUserTeardown = (userId: string) =>
  Promise.reject(
    new Error(
      `Account deletion is unavailable on this deployment: no delete-user teardown is wired for ${userId}`,
    ),
  );

export {
  createDeleteUserTeardown,
  isBlockingTeardownFailure,
  recordStepResidue as recordDeleteUserResidue,
  TEARDOWN_BLOCKED_SLUG,
  TEARDOWN_BLOCKED_ERROR_NAME,
  RESIDUE_WRITE_FAILED_SLUG,
  createSkippedDeleteUserTeardown,
  deleteUserResidueUnavailable,
  deleteUserTeardownUnavailable,
  SYNC_TEARDOWN_TIMEOUT_MS,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
};
export type {
  DeleteUserResidueDraft,
  DeleteUserResidueRecorder,
  DeleteUserTeardown,
  DeleteUserTeardownOptions,
  DeleteUserTeardownStep,
};
