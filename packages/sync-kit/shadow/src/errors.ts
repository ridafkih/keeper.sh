class ShadowInternalDataError extends Error {
  readonly invariant: string;

  constructor(invariant: string) {
    super(`sync-shadow broke its own invariant: ${invariant}`);
    this.name = "ShadowInternalDataError";
    this.invariant = invariant;
  }
}

export { ShadowInternalDataError };
