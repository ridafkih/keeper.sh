type RouteHandler = (request: Request) => Response | Promise<Response>;

const withWideEvent =
  (handler: (request: Request) => Response | Promise<Response>): RouteHandler =>
  (request) =>
    handler(request);

export { withWideEvent };
export type { RouteHandler };
