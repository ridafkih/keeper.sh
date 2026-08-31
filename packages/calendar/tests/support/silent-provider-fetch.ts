interface SilentProviderFetchOptions {
  onRequest?: (init: RequestInit) => void;
}

const createSilentProviderFetch = (options: SilentProviderFetchOptions = {}): typeof fetch =>
  ((_input: unknown, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    if (!signal) {
      throw new Error("silent provider fetch was handed a request that carried no abort signal");
    }

    options.onRequest?.(init as RequestInit);

    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => {
        reject(signal.reason);
      }, { once: true });
    });
  }) as unknown as typeof fetch;

export { createSilentProviderFetch };
export type { SilentProviderFetchOptions };
