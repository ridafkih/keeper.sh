const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const REAUTHENTICATION_FLAGS = ["authRequired", "oauthReauthRequired"];

const requiresReauthentication = (error: unknown): boolean =>
  REAUTHENTICATION_FLAGS.some((flag) => hasErrorFlag(error, flag));

export { hasErrorFlag, requiresReauthentication };
