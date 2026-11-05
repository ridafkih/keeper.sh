type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

type KeyOrder = (keys: readonly string[]) => readonly string[];

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const sortedKeys = (keys: readonly string[]): readonly string[] =>
  keys.toSorted(compareCodeUnits);

const insertionOrderKeys = (keys: readonly string[]): readonly string[] => keys;

const isCanonicalArray = (value: CanonicalValue): value is readonly CanonicalValue[] =>
  Array.isArray(value);

const canonicaliseWith = (order: KeyOrder, value: CanonicalValue): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (isCanonicalArray(value)) {
    return `[${value.map((member) => canonicaliseWith(order, member)).join(",")}]`;
  }
  return `{${order(Object.keys(value))
    .map((key) => `${JSON.stringify(key)}:${canonicaliseWith(order, value[key] ?? null)}`)
    .join(",")}}`;
};

const canonicalise = (value: CanonicalValue): string => canonicaliseWith(sortedKeys, value);

export {
  canonicalise,
  canonicaliseWith,
  compareCodeUnits,
  insertionOrderKeys,
  sortedKeys,
};
export type { CanonicalValue, KeyOrder };
