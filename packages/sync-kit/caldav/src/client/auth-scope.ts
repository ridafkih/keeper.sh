const authVerdicts = ["authenticated", "denied", "undecided"] as const;
type AuthVerdict = (typeof authVerdicts)[number];

interface AuthScope {
  readonly record: (status: number) => void;
  readonly recordWithheldCredentials: () => void;
  readonly verdict: () => AuthVerdict;
  readonly credentialsWithheld: () => boolean;
}

const successful = (status: number): boolean => status >= 200 && status < 300;

const deniedStatus = 401;

const createAuthScope = (): AuthScope => {
  const state = { succeeded: false, denied: false, withheld: false };

  return {
    record: (status: number) => {
      if (successful(status)) {
        state.succeeded = true;
        state.withheld = false;
        return;
      }
      if (status === deniedStatus) {
        state.denied = true;
      }
    },
    recordWithheldCredentials: () => {
      state.withheld = true;
    },
    verdict: () => {
      if (state.succeeded) {
        return "authenticated";
      }
      if (state.denied) {
        return "denied";
      }
      return "undecided";
    },
    credentialsWithheld: () => state.withheld,
  };
};

export { authVerdicts, createAuthScope };
export type { AuthScope, AuthVerdict };
