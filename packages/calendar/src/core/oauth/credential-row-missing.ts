class CredentialRowMissingError extends Error {
  constructor(oauthCredentialId: string) {
    super(`OAuth credential ${oauthCredentialId} no longer exists; its update matched no row`);
    this.name = "CredentialRowMissingError";
  }
}

export { CredentialRowMissingError };
