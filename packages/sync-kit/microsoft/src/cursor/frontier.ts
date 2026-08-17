interface CursorFrontier {
  readonly latest: (scopeFingerprint: string) => string | null;
  readonly advance: (scopeFingerprint: string, providerLink: string) => void;
  readonly isSuperseded: (scopeFingerprint: string, providerLink: string) => boolean;
}

const createCursorFrontier = (): CursorFrontier => {
  const held = new Map<string, string>();

  const latest = (scopeFingerprint: string): string | null =>
    held.get(scopeFingerprint) ?? null;

  return {
    latest,
    advance: (scopeFingerprint: string, providerLink: string) => {
      held.set(scopeFingerprint, providerLink);
    },
    isSuperseded: (scopeFingerprint: string, providerLink: string) => {
      const known = latest(scopeFingerprint);
      if (known === null) {
        return false;
      }
      return known !== providerLink;
    },
  };
};

export { createCursorFrontier };
export type { CursorFrontier };
