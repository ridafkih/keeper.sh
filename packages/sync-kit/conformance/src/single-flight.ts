interface SingleFlightOptions<Value> {
  readonly retain: (value: Value) => boolean;
}

interface SingleFlight<Value> {
  readonly run: (key: string, body: () => Promise<Value>) => Promise<Value>;
  readonly abandon: (key: string) => void;
  readonly inFlightKeys: () => number;
}

const createSingleFlight = <Value>(options: SingleFlightOptions<Value>): SingleFlight<Value> => {
  const flights = new Map<string, Promise<Value>>();

  const forget = (key: string, started: Promise<Value>): void => {
    if (flights.get(key) !== started) {
      return;
    }
    flights.delete(key);
  };

  const release = (key: string, started: Promise<Value>, settled: Value): Value => {
    if (options.retain(settled)) {
      return settled;
    }
    forget(key, started);
    return settled;
  };

  const rethrow = (key: string, started: Promise<Value>, error: unknown): never => {
    forget(key, started);
    throw error;
  };

  const run = (key: string, body: () => Promise<Value>): Promise<Value> => {
    const joined = flights.get(key);
    if (joined) {
      return joined;
    }
    const started: Promise<Value> = body().then(
      (settled) => release(key, started, settled),
      (error: unknown) => rethrow(key, started, error),
    );
    flights.set(key, started);
    return started;
  };

  const abandon = (key: string): void => {
    flights.delete(key);
  };

  return { run, abandon, inFlightKeys: () => flights.size };
};

export { createSingleFlight };
export type { SingleFlight, SingleFlightOptions };
