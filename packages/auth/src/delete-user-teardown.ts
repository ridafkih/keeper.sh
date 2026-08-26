import { widelog } from "widelogger";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";
const TEARDOWN_BUDGET_MS = 9000;

interface DeleteUserTeardownStep {
  name: string;
  run: (userId: string) => Promise<void>;
  timeoutMs?: number;
}

type DeleteUserTeardown = (userId: string) => Promise<void>;

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

const createDeleteUserTeardown =
  (steps: DeleteUserTeardownStep[], budgetMs = TEARDOWN_BUDGET_MS): DeleteUserTeardown =>
  async (userId: string) => {
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
        widelog.errorFields(error, {
          prefix: `delete_user_teardown.${step.name}`,
          retriable: false,
          slug: TEARDOWN_FAILED_SLUG,
        });
      }
    }
  };

const runDeleteUserTeardown = createDeleteUserTeardown([]);

export {
  createDeleteUserTeardown,
  runDeleteUserTeardown,
  TEARDOWN_BUDGET_MS,
  TEARDOWN_FAILED_SLUG,
};
export type { DeleteUserTeardown, DeleteUserTeardownStep };
