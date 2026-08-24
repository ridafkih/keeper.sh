interface PoolClient extends Record<string, unknown> {
  begin: (callback: (transactionClient: PoolClient) => Promise<unknown>) => Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => object;
}

interface HeldConnections {
  release: () => Promise<void>;
}

/*
 * Resolves once every transaction is inside its callback, so the caller knows the pool
 * is occupied by construction rather than inferring it from elapsed time.
 */
const holdConnections = async (client: PoolClient, count: number): Promise<HeldConnections> => {
  const entries: Promise<null>[] = [];
  const releases: ((value: null) => void)[] = [];

  const held = Array.from({ length: count }, (_unused, index) => {
    const entered = Promise.withResolvers<null>();
    entries.push(entered.promise);
    return client.begin(async (transactionClient) => {
      await (transactionClient.unsafe(`select ${index}`, []) as Promise<unknown>);
      const gate = Promise.withResolvers<null>();
      releases.push(gate.resolve);
      entered.resolve(null);
      await gate.promise;
    });
  });

  await Promise.all(entries);

  return {
    release: async (): Promise<void> => {
      for (const release of releases) {
        release(null);
      }
      await Promise.all(held);
    },
  };
};

export { holdConnections };
export type { HeldConnections, PoolClient };
