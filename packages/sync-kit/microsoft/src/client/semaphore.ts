import { compareCodeUnits } from "../canonical";

class PermitAborted extends Error {
  constructor() {
    super("the caller was aborted while it waited for a mailbox permit");
    this.name = "PermitAborted";
  }
}

interface MailboxSemaphore {
  readonly withPermits: <Value>(
    keys: readonly string[],
    signal: AbortSignal,
    body: () => Promise<Value>,
  ) => Promise<Value>;
  readonly held: (key: string) => number;
  readonly available: (key: string) => number;
  readonly waiting: (key: string) => number;
  readonly peak: (key: string) => number;
  readonly waitingTotal: () => number;
}

interface Waiter {
  readonly resume: () => void;
  readonly refuse: () => void;
}

interface Mailbox {
  held: number;
  peak: number;
  readonly queue: Waiter[];
}

const orderedKeys = (keys: readonly string[]): readonly string[] =>
  [...new Set(keys)].toSorted(compareCodeUnits);

const take = (mailbox: Mailbox): void => {
  mailbox.held += 1;
  mailbox.peak = Math.max(mailbox.peak, mailbox.held);
};

const forget = (mailbox: Mailbox, waiter: Waiter): void => {
  const position = mailbox.queue.indexOf(waiter);
  if (position === -1) {
    return;
  }
  mailbox.queue.splice(position, 1);
};

const release = (mailbox: Mailbox): void => {
  const next = mailbox.queue.shift();
  if (!next) {
    mailbox.held -= 1;
    return;
  }
  next.resume();
};

const createMailboxSemaphore = (permitsPerMailbox: number): MailboxSemaphore => {
  const mailboxes = new Map<string, Mailbox>();

  const mailboxFor = (key: string): Mailbox => {
    const held = mailboxes.get(key);
    if (held) {
      return held;
    }
    const created: Mailbox = { held: 0, peak: 0, queue: [] };
    mailboxes.set(key, created);
    return created;
  };

  const holding = async <Value>(
    mailbox: Mailbox,
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    const guard = { released: false };
    const releaseOnce = (): void => {
      if (guard.released) {
        return;
      }
      guard.released = true;
      release(mailbox);
    };
    if (signal.aborted) {
      releaseOnce();
      throw new PermitAborted();
    }
    const watching = new AbortController();
    const abandoned = Promise.withResolvers<never>();
    signal.addEventListener(
      "abort",
      () => {
        releaseOnce();
        abandoned.reject(new PermitAborted());
      },
      { once: true, signal: watching.signal },
    );
    try {
      return await Promise.race([body(), abandoned.promise]);
    } finally {
      watching.abort();
      releaseOnce();
    }
  };

  const queued = <Value>(
    mailbox: Mailbox,
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    const turn = Promise.withResolvers<null>();
    const listening = new AbortController();
    const waiter: Waiter = {
      resume: () => {
        listening.abort();
        turn.resolve(null);
      },
      refuse: () => {
        listening.abort();
        turn.reject(new PermitAborted());
      },
    };
    mailbox.queue.push(waiter);
    signal.addEventListener(
      "abort",
      () => {
        forget(mailbox, waiter);
        waiter.refuse();
      },
      { once: true, signal: listening.signal },
    );
    return turn.promise.then(() => holding(mailbox, signal, body));
  };

  const acquire = <Value>(
    key: string,
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    if (signal.aborted) {
      return Promise.reject(new PermitAborted());
    }
    const mailbox = mailboxFor(key);
    if (mailbox.held < permitsPerMailbox) {
      take(mailbox);
      return holding(mailbox, signal, body);
    }
    return queued(mailbox, signal, body);
  };

  const acquireFrom = <Value>(
    keys: readonly string[],
    position: number,
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    const key = keys.at(position) ?? null;
    if (key === null) {
      return body();
    }
    return acquire(key, signal, () => acquireFrom(keys, position + 1, signal, body));
  };

  const counted = (key: string, read: (mailbox: Mailbox) => number): number => {
    const mailbox = mailboxes.get(key);
    if (!mailbox) {
      return 0;
    }
    return read(mailbox);
  };

  return {
    withPermits: <Value>(
      keys: readonly string[],
      signal: AbortSignal,
      body: () => Promise<Value>,
    ): Promise<Value> => acquireFrom(orderedKeys(keys), 0, signal, body),
    held: (key: string) => counted(key, (mailbox) => mailbox.held),
    available: (key: string) =>
      permitsPerMailbox - counted(key, (mailbox) => mailbox.held),
    waiting: (key: string) => counted(key, (mailbox) => mailbox.queue.length),
    peak: (key: string) => counted(key, (mailbox) => mailbox.peak),
    waitingTotal: () =>
      [...mailboxes.values()].reduce((total, mailbox) => total + mailbox.queue.length, 0),
  };
};

export { createMailboxSemaphore, PermitAborted };
export type { MailboxSemaphore };
