import { isApiRequest, isDocumentRequest, proxyRequest } from "./proxy/http";
import { buildHtmlResponse } from "./template";
import type { Runtime, ServerConfig } from "./types";

export async function handleApplicationRequest(
  request: Request,
  runtime: Runtime,
  config: ServerConfig,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (isApiRequest(requestUrl)) {
    return proxyRequest(request, config.apiProxyOrigin);
  }

  if (!isDocumentRequest(request)) {
    return runtime.handleAssetRequest(request);
  }

  const routerResponse = await runtime.renderApp(request);
  const isRedirect = routerResponse.status >= 300 && routerResponse.status < 400;
  if (isRedirect) {
    return routerResponse;
  }

  const template = await runtime.renderTemplate(requestUrl.pathname);
  return buildHtmlResponse(routerResponse, template);
}
