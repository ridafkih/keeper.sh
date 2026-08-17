import type { calendar_v3 } from "@googleapis/calendar";
import { calendar_v3 as calendarApi } from "@googleapis/calendar";

type GoogleAuthClient = NonNullable<calendar_v3.Options["auth"]>;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface GoogleClientOptions {
  readonly fetch: FetchImplementation;
  readonly auth: GoogleAuthClient;
  readonly timeoutMs: number;
}

const noPreconnect = (): void => globalThis.undefined;

const forwardingFetch = (send: FetchImplementation): typeof fetch =>
  Object.assign(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => send(input, init),
    { preconnect: noPreconnect },
  );

const createGoogleClient = (options: GoogleClientOptions): calendar_v3.Calendar =>
  new calendarApi.Calendar({
    auth: options.auth,
    fetchImplementation: forwardingFetch(options.fetch),
    timeout: options.timeoutMs,
    retry: false,
    retryConfig: { retry: 0, httpMethodsToRetry: [], noResponseRetries: 0 },
  });

export { createGoogleClient };
export type { FetchImplementation, GoogleAuthClient, GoogleClientOptions };
