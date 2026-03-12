interface CredentialRefreshResult {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

const inFlightRefreshByCredentialId = new Map<string, Promise<CredentialRefreshResult>>();

const runWithCredentialRefreshLock = (
  oauthCredentialId: string,
  runRefresh: () => Promise<CredentialRefreshResult>,
): Promise<CredentialRefreshResult> => {
  const inFlight = inFlightRefreshByCredentialId.get(oauthCredentialId);
  if (inFlight) {
    return inFlight;
  }

  const refreshTask = runRefresh().finally(() => {
    if (inFlightRefreshByCredentialId.get(oauthCredentialId) === refreshTask) {
      inFlightRefreshByCredentialId.delete(oauthCredentialId);
    }
  });

  inFlightRefreshByCredentialId.set(oauthCredentialId, refreshTask);
  return refreshTask;
};

export { runWithCredentialRefreshLock };
export type { CredentialRefreshResult };
