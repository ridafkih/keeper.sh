interface MintedEventIds {
  readonly remember: (eventId: string) => void;
  readonly known: () => ReadonlySet<string>;
  readonly size: () => number;
}

const createMintedEventIds = (capacity: number): MintedEventIds => {
  const held = new Set<string>();

  const evictOldest = (): void => {
    const oldest = held.values().next();
    if (oldest.done) {
      return;
    }
    held.delete(oldest.value);
  };

  return {
    remember: (eventId: string) => {
      held.delete(eventId);
      held.add(eventId);
      if (held.size > capacity) {
        evictOldest();
      }
    },
    known: () => held,
    size: () => held.size,
  };
};

export { createMintedEventIds };
export type { MintedEventIds };
