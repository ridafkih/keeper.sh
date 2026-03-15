import { RouterServer, renderRouterToStream } from "@tanstack/react-router/ssr/server";
import { createRequestHandler } from "@tanstack/react-router/ssr/server";
import { createAppRouter } from "./router";
import type { ViteAssets } from "./lib/router-context";

export function render(request: Request, viteAssets: ViteAssets): Promise<Response> {
  const handleRequest = createRequestHandler({
    createRouter: () => createAppRouter({ request, viteAssets }),
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
