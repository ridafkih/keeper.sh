type DeltaLink =
  | { readonly kind: "advance"; readonly deltaLink: string }
  | { readonly kind: "continue"; readonly nextLink: string }
  | { readonly kind: "lost" };

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const linkNamed = (page: unknown, name: string): string | null => {
  const value = readProperty(page, name);
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const readDeltaLink = (page: unknown): DeltaLink => {
  const nextLink = linkNamed(page, "@odata.nextLink");
  if (nextLink !== null) {
    return { kind: "continue", nextLink };
  }
  const deltaLink = linkNamed(page, "@odata.deltaLink");
  if (deltaLink !== null) {
    return { kind: "advance", deltaLink };
  }
  return { kind: "lost" };
};

export { readDeltaLink };
export type { DeltaLink };
