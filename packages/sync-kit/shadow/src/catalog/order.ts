const nulSeparator = String.fromCodePoint(0);

const signatureOf = (parts: readonly string[]): string => parts.join(nulSeparator);

const byTextAscending = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

interface Signed<Entry> {
  readonly entry: Entry;
  readonly key: string;
}

const inSignatureOrder = <Entry>(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
): readonly Entry[] => {
  const signed: readonly Signed<Entry>[] = entries.map((entry) => ({ entry, key: keyOf(entry) }));
  return signed
    .toSorted((left, right) => byTextAscending(left.key, right.key))
    .map((item) => item.entry);
};

export { byTextAscending, inSignatureOrder, nulSeparator, signatureOf };
