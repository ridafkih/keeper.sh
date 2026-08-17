import { truncationMarker } from "./limits";

const sampleSeparator = ",";

interface SampleBounds {
  readonly count: number;
  readonly bytes: number;
  readonly identifierBytes: number;
}

const byteLengthOf = (value: string): number => new TextEncoder().encode(value).length;

const truncatedTo = (value: string, bytes: number): string => {
  if (byteLengthOf(value) <= bytes) {
    return value;
  }
  const kept: string[] = [];
  const budget = { used: 0 };
  for (const character of value) {
    const size = byteLengthOf(character);
    if (budget.used + size > bytes) {
      break;
    }
    kept.push(character);
    budget.used += size;
  }
  return `${kept.join("")}${truncationMarker}`;
};

const distinct = (values: readonly string[]): readonly string[] => [...new Set(values)];

const separatorBytesBefore = (taken: number): number => {
  if (taken === 0) {
    return 0;
  }
  return byteLengthOf(sampleSeparator);
};

interface BoundedIdentifiers {
  readonly sample: string;
  readonly omitted: number;
}

const boundedSampleOf = (values: readonly string[], bounds: SampleBounds): BoundedIdentifiers => {
  const wanted = distinct(values);
  const sample: string[] = [];
  const budget = { used: 0 };
  for (const value of wanted) {
    if (sample.length >= bounds.count) {
      break;
    }
    const identifier = truncatedTo(value, bounds.identifierBytes);
    const size = byteLengthOf(identifier) + separatorBytesBefore(sample.length);
    if (budget.used + size > bounds.bytes) {
      break;
    }
    sample.push(identifier);
    budget.used += size;
  }
  return { sample: sample.join(sampleSeparator), omitted: wanted.length - sample.length };
};

const boundedIdentifiers = (values: readonly string[], bounds: SampleBounds): string =>
  boundedSampleOf(values, bounds).sample;

export { boundedIdentifiers, boundedSampleOf, byteLengthOf, truncatedTo };
export type { BoundedIdentifiers, SampleBounds };
