const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Failures caused by our own client registration, not the user's grant. They can surface as
 * `invalid_grant` alongside the genuine cases, and telling a user to reconnect over one sends
 * them through a flow that cannot succeed — so they never raise reauthentication demand.
 */
// AADSTS7000215 is an invalid client secret, AADSTS7000222 an expired one, and
// AADSTS700016 an application missing from the directory.
const OPERATOR_FAULT_SIGNALS = [
  "invalid_client",
  "aadsts7000215",
  "aadsts7000222",
  "aadsts700016",
  "unauthorized_client",
];

const isOperatorFaultError = (message: string): boolean =>
  OPERATOR_FAULT_SIGNALS.some((signal) => message.includes(signal));

/**
 * Whether a failure is ours rather than the user's. Callers report these separately: an
 * operator fault breaks every account on the provider at once, and suppressing the
 * reauthentication demand also removes the only symptom a user would have seen.
 */
const isOAuthOperatorFaultError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return isOperatorFaultError(error.message.toLowerCase());
};

const isOAuthReauthRequiredError = (error: unknown): boolean => {
  if (isRecord(error) && "oauthReauthRequired" in error) {
    return error.oauthReauthRequired === true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (isOperatorFaultError(message)) {
      return false;
    }
    return message.includes("invalid_grant");
  }

  return false;
};

export { isOAuthOperatorFaultError, isOAuthReauthRequiredError, isOperatorFaultError };
