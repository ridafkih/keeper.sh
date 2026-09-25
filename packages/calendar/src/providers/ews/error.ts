class EwsError extends Error {
  readonly authRequired: boolean;
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(`EWS request failed (${code})`);
    this.name = "EwsError";
    this.code = code;
    this.status = status;
    this.authRequired =
      status === 401 ||
      code === "ErrorInvalidClientAccessToken" ||
      (code === "OAuthTokenRejected" && status === 400);
  }
}

export { EwsError };
