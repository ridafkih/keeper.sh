import env from "@keeper.sh/env/next/backend";
import { proxyableMethods } from "@keeper.sh/data-schemas";
import type { ProxyableMethods } from "@keeper.sh/data-schemas";
import type { NextRequest } from "next/server";

type RequestHandler = (request: NextRequest) => Promise<Response>;

/**
 * Agnostically proxies requests to the Bun API served at the
 * `process.env.API_URL` from the Next.js API handler.
 *
 * TODO: Evaluate whether we should just CORS the Bun API directly.
 */
const forward: RequestHandler = async (request) => {
  if (!env.API_URL) {
    return new Response(null, { status: 501 });
  }

  const { pathname, search } = new URL(request.url);

  if (!env.API_URL) {
    return new Response("The API_URL has not been configured", {
      status: 501,
    });
  }

  const url = new URL(pathname, env.API_URL);
  url.search = search;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Host", url.host);
  requestHeaders.delete("Accept-Encoding");

  const response = await fetch(url.toString(), {
    method: request.method,
    redirect: "manual",
    headers: requestHeaders,
    ...(request.body && request.method !== "OPTIONS" && { body: request.body }),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("Content-Encoding");
  responseHeaders.delete("Content-Length");

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
};

const toBunApiHandler = <
  MethodArray extends readonly ProxyableMethods[],
  MethodList extends MethodArray[number],
  Handlers extends Record<MethodList, RequestHandler> = Record<MethodArray[number], RequestHandler>,
>(
  allowedMethods: MethodArray,
): Handlers => {
  proxyableMethods.array().assert(allowedMethods);

  const hasAllAllowedMethods = (candidate: typeof partialHandlers): candidate is Handlers => {
    for (const allowedMethod of allowedMethods) {
      if (allowedMethod in candidate) {
        continue;
      }
      return false;
    }

    return true;
  };

  const partialHandlers: Partial<Record<string, unknown>> = {};

  for (const allowedMethod of allowedMethods) {
    partialHandlers[allowedMethod] = forward;
  }

  if (!hasAllAllowedMethods(partialHandlers)) {
    throw new Error(
      "This should never happen, all allowed methods were not passed to the Next.js-Bun API forwarding handler generator.",
    );
  }

  return partialHandlers;
};

export const { GET, POST, PUT, DELETE, HEAD, OPTIONS } = toBunApiHandler([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
