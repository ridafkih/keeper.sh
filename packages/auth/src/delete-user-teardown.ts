import { widelog } from "widelogger";

const TEARDOWN_FAILED_SLUG = "delete-user-teardown-failed";

interface DeleteUserTeardownStep {
  name: string;
  run: (userId: string) => Promise<void>;
}

type DeleteUserTeardown = (userId: string) => Promise<void>;

const createDeleteUserTeardown =
  (steps: DeleteUserTeardownStep[]): DeleteUserTeardown =>
  async (userId: string) => {
    for (const step of steps) {
      try {
        await step.run(userId);
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

export { createDeleteUserTeardown, runDeleteUserTeardown, TEARDOWN_FAILED_SLUG };
export type { DeleteUserTeardown, DeleteUserTeardownStep };
