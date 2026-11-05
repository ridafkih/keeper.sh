type QueryValue = string | string[];
type QueryRecord = Record<string, QueryValue>;

const parseQueryString = (searchString: string): QueryRecord => {
  const query: QueryRecord = {};

  for (const [key, value] of new URLSearchParams(searchString)) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }

  return query;
};

const toQueryValues = (value: unknown): string[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(toQueryValues);
  }
  if (typeof value === "object") {
    return [JSON.stringify(value)];
  }
  return [String(value)];
};

const stringifyQueryRecord = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    for (const entry of toQueryValues(value)) {
      params.append(key, entry);
    }
  }

  const searchString = params.toString();
  if (searchString.length === 0) {
    return "";
  }
  return `?${searchString}`;
};

export { parseQueryString, stringifyQueryRecord };
export type { QueryRecord, QueryValue };
