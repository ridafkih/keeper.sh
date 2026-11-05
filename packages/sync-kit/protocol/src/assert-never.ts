const describeUnserializable = (value: unknown): string => {
  if (typeof value !== "object") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if ("kind" in value && typeof value.kind === "string") {
    return value.kind;
  }
  return Object.keys(value).join(",");
};

const describeVariant = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return describeUnserializable(value);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`unreachable variant: ${describeVariant(value)}`);
};

export { assertNever };
