class FlightAbandoned extends Error {
  constructor() {
    super("the caller left the coalesced request before it settled");
    this.name = "FlightAbandoned";
  }
}

interface SingleFlight<Value> {
  readonly run: (
    key: string,
    lead: (signal: AbortSignal) => Promise<Value>,
    joiner: AbortSignal,
  ) => Promise<Value>;
  readonly inFlightKeys: () => readonly string[];
}

interface Flight<Value> {
  readonly settled: Promise<Value>;
  readonly leading: AbortController;
  joiners: number;
  abandoned: number;
}

const createSingleFlight = <Value>(): SingleFlight<Value> => {
  const flights = new Map<string, Flight<Value>>();

  const start = (key: string, lead: (signal: AbortSignal) => Promise<Value>): Flight<Value> => {
    const leading = new AbortController();
    const flight: Flight<Value> = {
      settled: lead(leading.signal),
      leading,
      joiners: 0,
      abandoned: 0,
    };
    flights.set(key, flight);
    const forget = (): void => {
      flights.delete(key);
    };
    flight.settled.then(forget).catch(forget);
    return flight;
  };

  const joined = (flight: Flight<Value>, joiner: AbortSignal): Promise<Value> => {
    flight.joiners += 1;
    if (joiner.aborted) {
      flight.abandoned += 1;
      if (flight.abandoned === flight.joiners) {
        flight.leading.abort();
      }
      return Promise.reject(new FlightAbandoned());
    }
    const departure = Promise.withResolvers<Value>();
    const listening = new AbortController();
    joiner.addEventListener(
      "abort",
      () => {
        flight.abandoned += 1;
        if (flight.abandoned === flight.joiners) {
          flight.leading.abort();
        }
        departure.reject(new FlightAbandoned());
      },
      { signal: listening.signal },
    );
    const stopListening = (): void => {
      listening.abort();
    };
    const participant = Promise.race([flight.settled, departure.promise]);
    participant.then(stopListening).catch(stopListening);
    return participant;
  };

  const run = (
    key: string,
    lead: (signal: AbortSignal) => Promise<Value>,
    joiner: AbortSignal,
  ): Promise<Value> => {
    const existing = flights.get(key);
    if (existing) {
      return joined(existing, joiner);
    }
    if (joiner.aborted) {
      return Promise.reject(new FlightAbandoned());
    }
    return joined(start(key, lead), joiner);
  };

  return { run, inFlightKeys: () => [...flights.keys()] };
};

export { createSingleFlight, FlightAbandoned };
export type { SingleFlight };
