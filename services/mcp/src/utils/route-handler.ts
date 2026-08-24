type RouteHandler = (request: Request) => Response | Promise<Response>;

type HttpMethod = "GET" | "POST" | "DELETE";

interface RouteModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  DELETE?: RouteHandler;
}

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "DELETE"];

const isHttpMethod = (method: string): method is HttpMethod =>
  HTTP_METHODS.some((httpMethod) => httpMethod === method);

const isRouteModule = (module: unknown): module is RouteModule => {
  if (typeof module !== "object" || module === null) {
    return false;
  }

  const record: Record<string, unknown> = { ...module };

  return HTTP_METHODS.some(
    (method) => typeof record[method] === "function",
  );
};

export { isHttpMethod, isRouteModule };
export type { RouteHandler, RouteModule };
