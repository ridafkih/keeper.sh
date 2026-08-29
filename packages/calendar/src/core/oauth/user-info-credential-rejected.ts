class UserInfoCredentialRejectedError extends Error {
  readonly oauthReauthRequired = true;
  readonly status: number;

  constructor(status: number) {
    super(`Failed to fetch user info: ${status}`);
    this.name = "UserInfoCredentialRejectedError";
    this.status = status;
  }
}

export { UserInfoCredentialRejectedError };
