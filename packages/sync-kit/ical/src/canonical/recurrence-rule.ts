const partOrder = [
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "WKST",
  "BYSECOND",
  "BYMINUTE",
  "BYHOUR",
  "BYDAY",
  "BYMONTHDAY",
  "BYYEARDAY",
  "BYWEEKNO",
  "BYMONTH",
  "BYSETPOS",
] as const;

const localUntil = /^\d{8}T\d{6}$/u;
const listValuedParts = ["BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS"] as const;

type UntilAnchor = (floating: string) => string;

const utcUntilAnchor: UntilAnchor = (floating) => `${floating}Z`;

const orderedNames: readonly string[] = partOrder;
const listValuedNames: readonly string[] = listValuedParts;

const rankOf = (name: string): number => {
  const index = orderedNames.indexOf(name);
  if (index === -1) {
    return partOrder.length;
  }
  return index;
};

const canonicalUntil = (value: string, anchorUntil: UntilAnchor): string => {
  if (localUntil.test(value)) {
    return anchorUntil(value);
  }
  return value;
};

const canonicalList = (value: string): string =>
  [...new Set(value.split(","))].toSorted().join(",");

interface RulePart {
  readonly name: string;
  readonly value: string;
}

const canonicalPart = (name: string, value: string, anchorUntil: UntilAnchor): RulePart => {
  if (name === "UNTIL") {
    return { name, value: canonicalUntil(value, anchorUntil) };
  }
  if (listValuedNames.includes(name)) {
    return { name, value: canonicalList(value) };
  }
  return { name, value };
};

const declaredParts = (rule: string): readonly RulePart[] =>
  rule
    .split(";")
    .filter((part) => part.includes("="))
    .map((part) => {
      const separator = part.indexOf("=");
      return {
        name: part.slice(0, separator).trim().toUpperCase(),
        value: part.slice(separator + 1).trim().toUpperCase(),
      };
    });

const parsedParts = (rule: string, anchorUntil: UntilAnchor): readonly RulePart[] =>
  declaredParts(rule).map((part) => canonicalPart(part.name, part.value, anchorUntil));

const orderedParts = (parts: readonly RulePart[]): readonly RulePart[] =>
  [...parts].toSorted((left, right) => {
    const byRank = rankOf(left.name) - rankOf(right.name);
    if (byRank !== 0) {
      return byRank;
    }
    return left.name.localeCompare(right.name);
  });

const canonicalizeRecurrenceRule = (rule: string, anchorUntil: UntilAnchor): string =>
  orderedParts(parsedParts(rule, anchorUntil))
    .map((part) => `${part.name}=${part.value}`)
    .join(";");

export { canonicalizeRecurrenceRule, utcUntilAnchor };
export type { UntilAnchor };
