interface Frontier {
  readonly generation: (key: string) => number;
  readonly advance: (key: string) => number;
  readonly accepts: (key: string, generation: number) => boolean;
}

const createFrontier = (): Frontier => {
  const generations = new Map<string, number>();

  const generation = (key: string): number => generations.get(key) ?? 0;

  return {
    generation,
    advance: (key: string) => {
      const next = generation(key) + 1;
      generations.set(key, next);
      return next;
    },
    accepts: (key: string, carried: number) => carried >= generation(key),
  };
};

export { createFrontier };
export type { Frontier };
