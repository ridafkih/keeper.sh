const BASIC_MULTILINGUAL_PLANE_MAX = 0xFF_FF;

const startsSurrogatePair = (value: string, index: number): boolean =>
  (value.codePointAt(index) ?? 0) > BASIC_MULTILINGUAL_PLANE_MAX;

const truncateToCodeUnits = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  if (startsSurrogatePair(value, maxLength - 1)) {
    return value.slice(0, maxLength - 1);
  }

  return value.slice(0, maxLength);
};

export { truncateToCodeUnits };
