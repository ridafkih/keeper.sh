import { RouterServer, renderRouterToStream } from "@tanstack/react-router/ssr/server";
import { createRequestHandler } from "@tanstack/react-router/ssr/server";
import { createAppRouter } from "./router";

export function render(request: Request): Promise<Response> {
  const handleRequest = createRequestHandler({
    createRouter: () => createAppRouter({ request }),
    request,
  });

  return handleRequest(({ responseHeaders, router }) =>
    renderRouterToStream({
      children: <RouterServer router={router} />,
      request,
      responseHeaders,
      router,
    }));
}
