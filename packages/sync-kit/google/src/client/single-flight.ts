interface SingleFlight<Value> {
  readonly run: (
    key: string,
    lead: (signal: AbortSignal) => Promise<Value>,
    joiner: AbortSignal,
  ) => Promise<Value>;
  readonly inFlightKeys: () => readonly string[];
}

interface Flight<Value> {
  readonly promise: Promise<Value>;
  readonly control: AbortController;
  joined: number;
}

const createSingleFlight = <Value>(): SingleFlight<Value> => {
  const flights = new Map<string, Flight<Value>>();

  const forget = (key: string, flight: Flight<Value>): void => {
    if (flights.get(key) !== flight) {
      return;
    }
    flights.delete(key);
  };

  const joinedTo = (key: string, flight: Flight<Value>, joiner: AbortSignal): Promise<Value> => {
    flight.joined += 1;
    const listening = new AbortController();
    const depart = (): void => {
      listening.abort();
      flight.joined -= 1;
      if (flight.joined > 0) {
        return;
      }
      forget(key, flight);
      flight.control.abort();
    };
    joiner.addEventListener("abort", depart, { once: true, signal: listening.signal });
    const awaited = async (): Promise<Value> => {
      try {
        return await flight.promise;
      } finally {
        listening.abort();
        forget(key, flight);
      }
    };
    return awaited();
  };

  const started = (key: string, lead: (signal: AbortSignal) => Promise<Value>): Flight<Value> => {
    const control = new AbortController();
    const flight: Flight<Value> = {
      promise: Promise.resolve().then(() => lead(control.signal)),
      control,
      joined: 0,
    };
    flights.set(key, flight);
    return flight;
  };

  return {
    run: (key: string, lead: (signal: AbortSignal) => Promise<Value>, joiner: AbortSignal) => {
      const held = flights.get(key);
      if (held) {
        return joinedTo(key, held, joiner);
      }
      return joinedTo(key, started(key, lead), joiner);
    },
    inFlightKeys: () => [...flights.keys()],
  };
};

export { createSingleFlight };
export type { SingleFlight };
