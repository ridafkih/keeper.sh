type CanonicalRecord = { readonly [key in string]: CanonicalValue };

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | CanonicalRecord;

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const isCanonicalArray = (value: CanonicalValue): value is readonly CanonicalValue[] =>
  Array.isArray(value);

const isCanonicalRecord = (
  value: CanonicalValue,
): value is CanonicalRecord => typeof value === "object";

const canonicaliseMember = (value: CanonicalValue): string => {
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
    return `[${value.map((member) => canonicaliseMember(member)).join(",")}]`;
  }
  if (!isCanonicalRecord(value)) {
    return "null";
  }
  return `{${Object.keys(value)
    .toSorted(compareCodeUnits)
    .map((key) => `${JSON.stringify(key)}:${canonicaliseMember(value[key] ?? null)}`)
    .join(",")}}`;
};

const canonicalise = (value: CanonicalValue): string => canonicaliseMember(value);

export { canonicalise, compareCodeUnits };
export type { CanonicalValue };
