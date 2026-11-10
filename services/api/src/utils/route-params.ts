import type { AuthenticatedRouteCallback } from "./middleware";

const withParamAsId =
  (paramName: string, handler: AuthenticatedRouteCallback): AuthenticatedRouteCallback =>
  ({ params, ...context }) => {
    const value = params[paramName];
    if (typeof value !== "string") {
      return handler({ ...context, params: {} });
    }
    return handler({ ...context, params: { id: value } });
  };

export { withParamAsId };
