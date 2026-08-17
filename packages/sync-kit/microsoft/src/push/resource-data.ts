interface RichHint {
  readonly kind: "richHint";
  readonly changeType: string;
  readonly hasResourceData: boolean;
}

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const readRichHint = (entry: unknown): RichHint | null => {
  const changeType = readProperty(entry, "changeType");
  if (typeof changeType !== "string" || changeType.length === 0) {
    return null;
  }
  const resourceData = readProperty(entry, "resourceData");
  return {
    kind: "richHint",
    changeType,
    hasResourceData: typeof resourceData === "object" && resourceData !== null,
  };
};

export { readRichHint };
export type { RichHint };
