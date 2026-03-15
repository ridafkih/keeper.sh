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

export { isHttpMethod, isRouteModule };
