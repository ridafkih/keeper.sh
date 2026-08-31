interface SilentProviderFetchOptions {
  onRequest?: (request: Request) => void;
}

const requestOf = (input: unknown, init?: RequestInit): Request => {
  if (input instanceof Request) {
    if (init) {
      return new Request(input, init);
    }
    return input;
  }
  if (input instanceof URL) {
    return new Request(input.toString(), init);
  }
  if (typeof input === "string") {
    return new Request(input, init);
  }
  throw new Error("silent provider fetch was handed an unrecognised request input");
};

const signalOf = (input: unknown, init?: RequestInit): AbortSignal | null => {
  if (init?.signal) {
    return init.signal;
  }
  if (input instanceof Request) {
    return input.signal;
  }
  return null;
};

const createSilentProviderFetch = (options: SilentProviderFetchOptions = {}): typeof fetch =>
  ((input: unknown, init?: RequestInit): Promise<Response> => {
    const signal = signalOf(input, init);
    if (!signal) {
      throw new Error("silent provider fetch was handed a request that carried no abort signal");
    }

    options.onRequest?.(requestOf(input, init));

    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }) as unknown as typeof fetch;

export { createSilentProviderFetch };
export type { SilentProviderFetchOptions };
