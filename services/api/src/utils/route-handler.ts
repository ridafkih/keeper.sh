import type { RouteHandler } from "./middleware";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

interface RouteModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
  HEAD?: RouteHandler;
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

const isHttpMethod = (method: string): method is HttpMethod =>
  HTTP_METHODS.some((httpMethod) => httpMethod === method);

const isRouteModule = (module: unknown): module is RouteModule => {
  if (typeof module !== "object" || module === null) {
    return false;
  }

  const record: Record<string, unknown> = { ...module };

  return HTTP_METHODS.some(
    (method) => isHttpMethod(method) && typeof record[method] === "function",
  );
};

/*
 * Bun 1.3.14's FileSystemRouter repeats an outer dynamic segment when a nested dynamic
 * route is registered beneath it: matching /api/sources/:id/destinations/:destination
 * yields id as ["<id>", "<id>"] while its own :destination stays a string. Its type says
 * Record<string, string>, so nothing catches it until the value reaches a query and
 * Postgres rejects "<id>,<id>" as a uuid.
 */
const routeParamValue = (name: string, value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`Route param "${name}" is neither a string nor a list of strings.`);
  }
  const [first, ...rest] = value;
  if (typeof first !== "string") {
    throw new TypeError(`Route param "${name}" resolved to a non-string value.`);
  }
  const conflicting = rest.filter((entry) => entry !== first);
  if (conflicting.length > 0) {
    throw new Error(
      `Route param "${name}" resolved to conflicting values: ${value.join(", ")}.`,
    );
  }
  return first;
};

const normalizeRouteParams = (params: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, routeParamValue(name, value)]),
  );

export { isHttpMethod, isRouteModule, normalizeRouteParams };
