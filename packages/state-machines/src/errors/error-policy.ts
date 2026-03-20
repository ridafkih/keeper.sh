enum ErrorPolicy {
  RETRYABLE = "retryable",
  TERMINAL = "terminal",
  REQUIRES_REAUTH = "requires_reauth",
}

const isRetryablePolicy = (policy: ErrorPolicy): boolean =>
  policy === ErrorPolicy.RETRYABLE;

const isTerminalPolicy = (policy: ErrorPolicy): boolean =>
  policy === ErrorPolicy.TERMINAL || policy === ErrorPolicy.REQUIRES_REAUTH;

export { ErrorPolicy, isRetryablePolicy, isTerminalPolicy };
