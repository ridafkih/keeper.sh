interface CountingSignal {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly attached: () => number;
}

const optionsOf = (options?: AddEventListenerOptions | boolean): AddEventListenerOptions => {
  if (!options && options !== false) {
    return {};
  }
  if (typeof options === "boolean") {
    return { capture: options };
  }
  return options;
};

const countingSignal = (): CountingSignal => {
  const control = new AbortController();
  const { signal } = control;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let attached = 0;

  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    value: (
      type: string,
      listener: (event: Event) => void,
      options?: AddEventListenerOptions | boolean,
    ): void => {
      attached += 1;
      const resolved = optionsOf(options);
      const forget = (): void => {
        attached -= 1;
      };
      if (resolved.signal) {
        resolved.signal.addEventListener("abort", forget, { once: true });
      }
      if (resolved.once) {
        originalAdd("abort", forget, { once: true });
      }
      originalAdd(type, listener, resolved);
    },
  });

  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    value: (
      type: string,
      listener: (event: Event) => void,
      options?: EventListenerOptions | boolean,
    ): void => {
      attached -= 1;
      originalRemove(type, listener, options);
    },
  });

  return { signal, abort: () => control.abort(), attached: () => attached };
};

export { countingSignal };
export type { CountingSignal };
