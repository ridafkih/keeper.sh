import type { AuthLogEntry, AuthObserver, AuthRequestOutcome } from "@keeper.sh/auth";
import { widelog } from "./logging";
import { emitUserLifecycleEvent } from "./lifecycle-events";
import { noteUserCreated } from "./user-created";
import { redactSensitiveText } from "./auth-error-detail";

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

const recordAuthLog = ({ level, message }: AuthLogEntry): void => {
  widelog.append("auth.log", `${level}: ${redactSensitiveText(message)}`);
};

const authObserver: AuthObserver = {
  onRequestResolved: recordAuthRequestOutcome,
  onAuthLog: recordAuthLog,
  onUserCreated: (userId, attribution) => {
    noteUserCreated(userId, attribution);
  },
  onUserDeleted: (userId) => emitUserLifecycleEvent("user.deleted", userId),
};

export { authObserver };
