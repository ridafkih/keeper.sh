import env from "@keeper.sh/env/next/backend";
import {
  proxyableMethods,
  type ProxyableMethods,
} from "@keeper.sh/data-schemas";
import { NextRequest } from "next/server";

type RequestHandler = (request: NextRequest) => Promise<Response>;

/**
 * Agnostically proxies requests to the Bun API served at the
 * `process.env.API_URL` from the Next.js API handler.
 *
 * TODO: Evaluate whether we should just CORS the Bun API directly.
 */
const forward: RequestHandler = (request) => {
  const { pathname, search } = new URL(request.url);
  const url = new URL(pathname, env.API_URL);
  url.search = search;

  return fetch(url.toString(), {
    method: request.method,
    redirect: "manual",
    ...(request.headers && { headers: request.headers }),
    ...(request.body && { body: request.body }),
  });
};

const toBunApiHandler = <
  MethodArray extends readonly ProxyableMethods[],
  MethodList extends MethodArray[number],
  Handlers extends Record<MethodList, RequestHandler> = Record<
    MethodArray[number],
    RequestHandler
  >,
>(
  allowedMethods: MethodArray,
): Handlers => {
  proxyableMethods.array().assert(allowedMethods);

  const hasAllAllowedMethods = (
    candidate: typeof partialHandlers,
  ): candidate is Handlers => {
    for (const allowedMethod of allowedMethods) {
      if (allowedMethod in candidate) continue;
      return false;
    }

    return true;
  };

  const partialHandlers: Partial<Record<string, unknown>> = {};

  for (const allowedMethod of allowedMethods) {
    partialHandlers[allowedMethod] = forward;
  }

  if (!hasAllAllowedMethods(partialHandlers)) {
    throw Error(
      "This should never happen, all allowed methods were not passed to the Next.js-Bun API forwarding handler generator.",
    );
  }

  return partialHandlers;
};

export const { GET, POST, PUT, DELETE, HEAD } = toBunApiHandler([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "HEAD",
]);
