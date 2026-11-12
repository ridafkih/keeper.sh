import { context, widelog } from "./logging";

type UserLifecycleEvent = "user.deleted";

const emitUserLifecycleEvent = (event: UserLifecycleEvent, userId: string): void => {
  context(() => {
    widelog.set("operation.name", event);
    widelog.set("operation.type", "lifecycle");
    widelog.set("user.id", userId);
    widelog.set("outcome", "success");
    widelog.flush();
  });
};

export { emitUserLifecycleEvent };
export type { UserLifecycleEvent };
