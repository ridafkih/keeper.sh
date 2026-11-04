import type { AuthObserver, AuthRequestOutcome } from "@keeper.sh/auth";
import { widelog } from "./logging";
import { emitUserLifecycleEvent } from "./lifecycle-events";

const recordAuthRequestOutcome = ({ userId, provider, errorCode }: AuthRequestOutcome): void => {
  if (userId) {
    widelog.set("user.id", userId);
  }
  if (provider) {
    widelog.set("auth.provider", provider);
  }
  if (errorCode) {
    widelog.set("auth.error_code", errorCode);
  }
};

const authObserver: AuthObserver = {
  onRequestResolved: recordAuthRequestOutcome,
  onUserCreated: (userId) => emitUserLifecycleEvent("user.created", userId),
  onUserDeleted: (userId) => emitUserLifecycleEvent("user.deleted", userId),
};

export { authObserver };
