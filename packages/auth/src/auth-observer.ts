import { APIError, createAuthMiddleware } from "better-auth/api";
import { writeAuthStderr } from "./runtime-environment";

interface AuthRequestOutcome {
  userId: string | null;
  provider: string | null;
  errorCode: string | null;
}

type AuthLogLevel = "debug" | "info" | "warn" | "error";

interface AuthLogEntry {
  level: AuthLogLevel;
  message: string;
}

interface AuthObserver {
  onRequestResolved: (outcome: AuthRequestOutcome) => void;
  onAuthLog: (entry: AuthLogEntry) => void;
  onUserCreated: (userId: string) => void;
  onUserDeleted: (userId: string) => void;
}

const USERNAME_SIGN_UP_PATH = "/username-only/sign-up";

const PATH_PROVIDERS: Record<string, string> = {
  "/passkey/verify-authentication": "passkey",
  "/sign-in/email": "email",
  "/sign-up/email": "email",
  "/username-only/sign-in": "username",
  [USERNAME_SIGN_UP_PATH]: "username",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, key: string): string | null => {
  if (!isRecord(value) || typeof value[key] !== "string") {
    return null;
  }
  return value[key];
};

const readUserId = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value.user, "id");
};

interface AfterHookContext {
  path: string;
  body?: unknown;
  params?: unknown;
  context: {
    newSession?: unknown;
    session?: unknown;
    returned?: unknown;
  };
}

const resolveProvider = ({ path, body, params }: AfterHookContext): string | null => {
  const pathProvider = PATH_PROVIDERS[path];
  if (pathProvider) {
    return pathProvider;
  }
  if (path === "/sign-in/social") {
    return readString(body, "provider");
  }
  return readString(params, "id") ?? readString(params, "providerId");
};

const resolveUserId = ({ context }: AfterHookContext): string | null => {
  const { newSession, session, returned } = context;
  if (returned instanceof APIError) {
    return readUserId(newSession) ?? readUserId(session);
  }
  return readUserId(newSession) ?? readUserId(session) ?? readUserId(returned);
};

const resolveErrorCode = ({ context }: AfterHookContext): string | null => {
  if (!(context.returned instanceof APIError)) {
    return null;
  }
  return readString(context.returned.body, "code");
};

const observeAuthRequest = (observer: AuthObserver, context: AfterHookContext): void => {
  const outcome: AuthRequestOutcome = {
    errorCode: resolveErrorCode(context),
    provider: resolveProvider(context),
    userId: resolveUserId(context),
  };

  observer.onRequestResolved(outcome);

  if (context.path === USERNAME_SIGN_UP_PATH && !outcome.errorCode && outcome.userId) {
    observer.onUserCreated(outcome.userId);
  }
};

const createAuthObserverHook = (observer: AuthObserver) =>
  createAuthMiddleware((context) => {
    observeAuthRequest(observer, context);
    return Promise.resolve();
  });

const createObserverHooks = (observer: AuthObserver | undefined) => {
  if (!observer) {
    return {};
  }
  return { after: createAuthObserverHook(observer) };
};

const createObservedLogger = (observer: AuthObserver | undefined) => ({
  log: (level: AuthLogLevel, message: string) => {
    writeAuthStderr(`${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}\n`);
    observer?.onAuthLog({ level, message });
  },
});

const createAuthObservation = (observer: AuthObserver | undefined) => ({
  hooks: createObserverHooks(observer),
  logger: createObservedLogger(observer),
  userCreated: (userId: string): void => observer?.onUserCreated(userId),
  userDeleted: (userId: string): void => observer?.onUserDeleted(userId),
});

export { createAuthObservation };
export type { AuthLogEntry, AuthObserver, AuthRequestOutcome };
