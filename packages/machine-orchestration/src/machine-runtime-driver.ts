import type {
  EventEnvelope,
  MachineSnapshot,
  MachineTransitionResult,
} from "@keeper.sh/state-machines";

interface SnapshotRecord<TState, TContext> {
  version: number;
  snapshot: MachineSnapshot<TState, TContext>;
}

interface SnapshotStore<TState, TContext> {
  read: (aggregateId: string) => Promise<SnapshotRecord<TState, TContext> | null>;
  compareAndSet: (
    aggregateId: string,
    expectedVersion: number,
    snapshot: MachineSnapshot<TState, TContext>,
  ) => Promise<SnapshotRecord<TState, TContext> | null>;
}

interface EnvelopeStore {
  hasProcessed: (aggregateId: string, envelopeId: string) => Promise<boolean>;
  markProcessed: (aggregateId: string, envelopeId: string) => Promise<void>;
}

interface CommandBus<TCommand> {
  execute: (command: TCommand) => Promise<void>;
}

interface OutboxRecord<TCommand> {
  aggregateId: string;
  envelopeId: string;
  commands: TCommand[];
  nextCommandIndex: number;
}

interface CommandOutboxStore<TCommand> {
  advanceNextCommand: (aggregateId: string, envelopeId: string) => Promise<void>;
  complete: (aggregateId: string, envelopeId: string) => Promise<void>;
  enqueue: (record: OutboxRecord<TCommand>) => Promise<void>;
  readNext: (aggregateId: string) => Promise<OutboxRecord<TCommand> | null>;
}

interface RecoverableCommandOutboxStore<TCommand> extends CommandOutboxStore<TCommand> {
  listAggregates: () => Promise<string[]>;
}

interface RedisCommandOutboxStoreClient {
  del: (key: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  hgetall: (key: string) => Promise<Record<string, string>>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  hset: (key: string, data: Record<string, string>) => Promise<number>;
  lindex: (key: string, index: number) => Promise<string | null>;
  llen: (key: string) => Promise<number>;
  lpop: (key: string) => Promise<string | null>;
  lrem: (key: string, count: number, value: string) => Promise<number>;
  rpush: (key: string, value: string) => Promise<number>;
  sadd: (key: string, value: string) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  srem: (key: string, value: string) => Promise<number>;
}

interface RuntimeProcessEvent<TState, TContext, TEvent, TCommand, TOutput> {
  aggregateId: string;
  outcome: MachineProcessOutcome;
  envelope: EventEnvelope<TEvent>;
  snapshot: MachineSnapshot<TState, TContext>;
  transition?: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
  version: number;
}

interface RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput> {
  onProcessed: (
    event: RuntimeProcessEvent<TState, TContext, TEvent, TCommand, TOutput>,
  ) => Promise<void> | void;
}

interface RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput> {
  restore: (snapshot: MachineSnapshot<TState, TContext>) => void;
  dispatch: (
    envelope: EventEnvelope<TEvent>,
  ) => MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

interface MachineRuntimeDriverDependencies<
  TState,
  TContext,
  TEvent,
  TCommand,
  TOutput,
> {
  aggregateId: string;
  machine: RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput>;
  snapshotStore: SnapshotStore<TState, TContext>;
  envelopeStore: EnvelopeStore;
  outboxStore: CommandOutboxStore<TCommand>;
  commandBus: CommandBus<TCommand>;
  eventSink: RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput>;
}

interface MachineProcessResult<TState, TContext, TCommand, TOutput> {
  outcome: MachineProcessOutcome;
  snapshot: MachineSnapshot<TState, TContext>;
  version: number;
  transition?: MachineTransitionResult<TState, TContext, TCommand, TOutput>;
}

type MachineProcessOutcome = "APPLIED" | "DUPLICATE_IGNORED" | "CONFLICT_DETECTED";

class MachineConflictDetectedError extends Error {
  readonly aggregateId: string;
  readonly envelopeId: string;

  constructor(aggregateId: string, envelopeId: string) {
    super(`Machine conflict detected for aggregate ${aggregateId} (envelope ${envelopeId})`);
    this.name = "MachineConflictDetectedError";
    this.aggregateId = aggregateId;
    this.envelopeId = envelopeId;
  }
}

const isMachineConflictDetectedError = (
  error: unknown,
): error is MachineConflictDetectedError => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name !== "MachineConflictDetectedError") {
    return false;
  }
  if (!("aggregateId" in error) || !("envelopeId" in error)) {
    return false;
  }
  return true;
};

class MachineRuntimeDriver<TState, TContext, TEvent, TCommand, TOutput> {
  private static readonly aggregateLocks = new Map<string, Promise<void>>();
  private readonly aggregateId: string;
  private readonly machine: RuntimeMachine<TState, TContext, TEvent, TCommand, TOutput>;
  private readonly snapshotStore: SnapshotStore<TState, TContext>;
  private readonly envelopeStore: EnvelopeStore;
  private readonly outboxStore: CommandOutboxStore<TCommand>;
  private readonly commandBus: CommandBus<TCommand>;
  private readonly eventSink: RuntimeEventSink<TState, TContext, TEvent, TCommand, TOutput>;

  constructor(
    dependencies: MachineRuntimeDriverDependencies<
      TState,
      TContext,
      TEvent,
      TCommand,
      TOutput
    >,
  ) {
    this.aggregateId = dependencies.aggregateId;
    this.machine = dependencies.machine;
    this.snapshotStore = dependencies.snapshotStore;
    this.envelopeStore = dependencies.envelopeStore;
    this.outboxStore = dependencies.outboxStore;
    this.commandBus = dependencies.commandBus;
    this.eventSink = dependencies.eventSink;
  }

  process(envelope: EventEnvelope<TEvent>): Promise<MachineProcessResult<TState, TContext, TCommand, TOutput>> {
    return this.runWithAggregateLock(() => this.processUnlocked(envelope));
  }

  private async processUnlocked(
    envelope: EventEnvelope<TEvent>,
  ): Promise<MachineProcessResult<TState, TContext, TCommand, TOutput>> {
    if (await this.envelopeStore.hasProcessed(this.aggregateId, envelope.id)) {
      const record = await this.requireSnapshotRecord();
      await this.eventSink.onProcessed({
        aggregateId: this.aggregateId,
        outcome: "DUPLICATE_IGNORED",
        envelope,
        snapshot: record.snapshot,
        version: record.version,
      });
      return {
        outcome: "DUPLICATE_IGNORED",
        snapshot: record.snapshot,
        version: record.version,
      };
    }

    const currentRecord = await this.requireSnapshotRecord();
    this.machine.restore(currentRecord.snapshot);
    const transition = this.machine.dispatch(envelope);

    const nextRecord = await this.snapshotStore.compareAndSet(
      this.aggregateId,
      currentRecord.version,
      {
        context: transition.context,
        state: transition.state,
      },
    );

    if (!nextRecord) {
      const record = await this.requireSnapshotRecord();
      await this.eventSink.onProcessed({
        aggregateId: this.aggregateId,
        outcome: "CONFLICT_DETECTED",
        envelope,
        snapshot: record.snapshot,
        version: record.version,
      });
      return {
        outcome: "CONFLICT_DETECTED",
        snapshot: record.snapshot,
        version: record.version,
      };
    }

    await this.outboxStore.enqueue({
      aggregateId: this.aggregateId,
      commands: transition.commands,
      envelopeId: envelope.id,
      nextCommandIndex: 0,
    });
    await this.envelopeStore.markProcessed(this.aggregateId, envelope.id);
    await this.eventSink.onProcessed({
      aggregateId: this.aggregateId,
      outcome: "APPLIED",
      envelope,
      snapshot: {
        context: transition.context,
        state: transition.state,
      },
      transition,
      version: nextRecord.version,
    });
    return {
      outcome: "APPLIED",
      snapshot: {
        context: transition.context,
        state: transition.state,
      },
      transition,
      version: nextRecord.version,
    };
  }

  drainOutbox(): Promise<void> {
    return MachineRuntimeDriver.drainAggregateOutbox({
      aggregateId: this.aggregateId,
      commandBus: this.commandBus,
      outboxStore: this.outboxStore,
    });
  }

  static drainAggregateOutbox<TCommand>(input: {
    aggregateId: string;
    outboxStore: CommandOutboxStore<TCommand>;
    commandBus: CommandBus<TCommand>;
  }): Promise<void> {
    return MachineRuntimeDriver.runWithAggregateLock(input.aggregateId, async () => {
      await MachineRuntimeDriver.drainOutboxUnlocked(input.aggregateId, input.outboxStore, input.commandBus);
    });
  }

  private static async drainOutboxUnlocked<TCommand>(
    aggregateId: string,
    outboxStore: CommandOutboxStore<TCommand>,
    commandBus: CommandBus<TCommand>,
  ): Promise<void> {
    while (true) {
      const next = await outboxStore.readNext(aggregateId);
      if (!next) {
        return;
      }

      const command = next.commands.at(next.nextCommandIndex);
      if (command === globalThis.undefined) {
        await outboxStore.complete(aggregateId, next.envelopeId);
        continue;
      }
      await commandBus.execute(command);
      await outboxStore.advanceNextCommand(aggregateId, next.envelopeId);
    }
  }

  private static async runWithAggregateLock<TResult>(
    aggregateId: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const prior = MachineRuntimeDriver.aggregateLocks.get(aggregateId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    const lockTail = current.then(
      () => globalThis.undefined,
      () => globalThis.undefined,
    );
    MachineRuntimeDriver.aggregateLocks.set(aggregateId, lockTail);

    try {
      return current;
    } finally {
      if (MachineRuntimeDriver.aggregateLocks.get(aggregateId) === lockTail) {
        MachineRuntimeDriver.aggregateLocks.delete(aggregateId);
      }
    }
  }

  private runWithAggregateLock<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    return MachineRuntimeDriver.runWithAggregateLock(this.aggregateId, operation);
  }

  private async requireSnapshotRecord(): Promise<SnapshotRecord<TState, TContext>> {
    const record = await this.snapshotStore.read(this.aggregateId);
    if (!record) {
      throw new Error(`Snapshot not initialized for aggregate ${this.aggregateId}`);
    }
    return record;
  }
}

class InMemorySnapshotStore<TState, TContext> implements SnapshotStore<TState, TContext> {
  private readonly records = new Map<string, SnapshotRecord<TState, TContext>>();

  initialize(
    aggregateId: string,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<void> {
    this.records.set(aggregateId, {
      snapshot,
      version: 0,
    });
    return Promise.resolve();
  }

  initializeIfMissing(
    aggregateId: string,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<SnapshotRecord<TState, TContext>> {
    const existing = this.records.get(aggregateId);
    if (existing) {
      return Promise.resolve(existing);
    }

    const created = {
      snapshot,
      version: 0,
    };
    this.records.set(aggregateId, created);
    return Promise.resolve(created);
  }

  read(aggregateId: string): Promise<SnapshotRecord<TState, TContext> | null> {
    return Promise.resolve(this.records.get(aggregateId) ?? null);
  }

  compareAndSet(
    aggregateId: string,
    expectedVersion: number,
    snapshot: MachineSnapshot<TState, TContext>,
  ): Promise<SnapshotRecord<TState, TContext> | null> {
    const current = this.records.get(aggregateId);
    if (!current || current.version !== expectedVersion) {
      return Promise.resolve(null);
    }

    const next = {
      snapshot,
      version: expectedVersion + 1,
    };
    this.records.set(aggregateId, next);
    return Promise.resolve(next);
  }

  forceBumpVersion(aggregateId: string): Promise<void> {
    const current = this.records.get(aggregateId);
    if (!current) {
      return Promise.resolve();
    }
    this.records.set(aggregateId, {
      snapshot: current.snapshot,
      version: current.version + 1,
    });
    return Promise.resolve();
  }
}

class InMemoryEnvelopeStore implements EnvelopeStore {
  private readonly processedByAggregate = new Map<string, Set<string>>();

  hasProcessed(aggregateId: string, envelopeId: string): Promise<boolean> {
    const processed = this.processedByAggregate.get(aggregateId);
    return Promise.resolve(processed?.has(envelopeId) ?? false);
  }

  markProcessed(aggregateId: string, envelopeId: string): Promise<void> {
    const processed = this.processedByAggregate.get(aggregateId);
    if (processed) {
      processed.add(envelopeId);
      return Promise.resolve();
    }

    this.processedByAggregate.set(aggregateId, new Set([envelopeId]));
    return Promise.resolve();
  }
}

class InMemoryCommandOutboxStore<TCommand> implements RecoverableCommandOutboxStore<TCommand> {
  private readonly recordsByAggregate = new Map<string, OutboxRecord<TCommand>[]>();

  enqueue(record: OutboxRecord<TCommand>): Promise<void> {
    if (record.commands.length === 0) {
      return Promise.resolve();
    }
    const existing = this.recordsByAggregate.get(record.aggregateId) ?? [];
    if (existing.some((entry) => entry.envelopeId === record.envelopeId)) {
      return Promise.resolve();
    }
    existing.push({
      aggregateId: record.aggregateId,
      commands: [...record.commands],
      envelopeId: record.envelopeId,
      nextCommandIndex: record.nextCommandIndex,
    });
    this.recordsByAggregate.set(record.aggregateId, existing);
    return Promise.resolve();
  }

  readNext(aggregateId: string): Promise<OutboxRecord<TCommand> | null> {
    const records = this.recordsByAggregate.get(aggregateId);
    if (!records || records.length === 0) {
      return Promise.resolve(null);
    }
    const [next] = records;
    if (!next) {
      return Promise.resolve(null);
    }
    return Promise.resolve(next);
  }

  advanceNextCommand(aggregateId: string, envelopeId: string): Promise<void> {
    const records = this.recordsByAggregate.get(aggregateId);
    if (!records || records.length === 0) {
      return Promise.resolve();
    }
    const [next] = records;
    if (!next || next.envelopeId !== envelopeId) {
      return Promise.resolve();
    }
    next.nextCommandIndex += 1;
    return Promise.resolve();
  }

  complete(aggregateId: string, envelopeId: string): Promise<void> {
    const records = this.recordsByAggregate.get(aggregateId);
    if (!records || records.length === 0) {
      return Promise.resolve();
    }
    const [next] = records;
    if (!next || next.envelopeId !== envelopeId) {
      return Promise.resolve();
    }
    records.shift();
    if (records.length === 0) {
      this.recordsByAggregate.delete(aggregateId);
      return Promise.resolve();
    }
    this.recordsByAggregate.set(aggregateId, records);
    return Promise.resolve();
  }

  listAggregates(): Promise<string[]> {
    return Promise.resolve([...this.recordsByAggregate.keys()]);
  }
}

class RedisCommandOutboxStore<TCommand> implements RecoverableCommandOutboxStore<TCommand> {
  private readonly redis: RedisCommandOutboxStoreClient;
  private readonly keyPrefix: string;

  constructor(input: { redis: RedisCommandOutboxStoreClient; keyPrefix?: string }) {
    this.redis = input.redis;
    this.keyPrefix = input.keyPrefix ?? "machine:outbox";
  }

  async enqueue(record: OutboxRecord<TCommand>): Promise<void> {
    if (record.commands.length === 0) {
      return;
    }

    const entryKey = this.resolveEntryKey(record.aggregateId, record.envelopeId);
    const exists = await this.redis.exists(entryKey);
    if (exists > 0) {
      return;
    }

    await this.redis.hset(entryKey, {
      commands: JSON.stringify(record.commands),
      nextCommandIndex: String(record.nextCommandIndex),
    });
    await this.redis.rpush(this.resolveQueueKey(record.aggregateId), record.envelopeId);
    await this.redis.sadd(this.resolveAggregatesKey(), record.aggregateId);
  }

  async readNext(aggregateId: string): Promise<OutboxRecord<TCommand> | null> {
    const queueKey = this.resolveQueueKey(aggregateId);
    const envelopeId = await this.redis.lindex(queueKey, 0);
    if (!envelopeId) {
      return null;
    }

    const entryKey = this.resolveEntryKey(aggregateId, envelopeId);
    const values = await this.redis.hgetall(entryKey);
    if (Object.keys(values).length === 0) {
      await this.redis.lpop(queueKey);
      if ((await this.redis.llen(queueKey)) === 0) {
        await this.redis.srem(this.resolveAggregatesKey(), aggregateId);
      }
      return this.readNext(aggregateId);
    }

    const rawCommands = values.commands ?? "[]";
    const nextCommandIndexRaw = values.nextCommandIndex ?? "0";
    const commands = JSON.parse(rawCommands) as TCommand[];
    const nextCommandIndex = Number.parseInt(nextCommandIndexRaw, 10) || 0;

    return {
      aggregateId,
      commands,
      envelopeId,
      nextCommandIndex,
    };
  }

  async advanceNextCommand(aggregateId: string, envelopeId: string): Promise<void> {
    await this.redis.hincrby(
      this.resolveEntryKey(aggregateId, envelopeId),
      "nextCommandIndex",
      1,
    );
  }

  async complete(aggregateId: string, envelopeId: string): Promise<void> {
    const queueKey = this.resolveQueueKey(aggregateId);
    const first = await this.redis.lindex(queueKey, 0);
    if (first === envelopeId) {
      await this.redis.lpop(queueKey);
    }
    if (first !== envelopeId) {
      await this.redis.lrem(queueKey, 1, envelopeId);
    }
    await this.redis.del(this.resolveEntryKey(aggregateId, envelopeId));

    if ((await this.redis.llen(queueKey)) === 0) {
      await this.redis.srem(this.resolveAggregatesKey(), aggregateId);
    }
  }

  listAggregates(): Promise<string[]> {
    return this.redis.smembers(this.resolveAggregatesKey());
  }

  private resolveAggregatesKey(): string {
    return `${this.keyPrefix}:aggregates`;
  }

  private resolveQueueKey(aggregateId: string): string {
    return `${this.keyPrefix}:aggregate:${aggregateId}:queue`;
  }

  private resolveEntryKey(aggregateId: string, envelopeId: string): string {
    return `${this.keyPrefix}:aggregate:${aggregateId}:entry:${envelopeId}`;
  }
}

export {
  InMemoryCommandOutboxStore,
  InMemoryEnvelopeStore,
  InMemorySnapshotStore,
  MachineConflictDetectedError,
  RedisCommandOutboxStore,
  isMachineConflictDetectedError,
  MachineRuntimeDriver,
};
export type {
  CommandBus,
  CommandOutboxStore,
  EnvelopeStore,
  OutboxRecord,
  RecoverableCommandOutboxStore,
  RedisCommandOutboxStoreClient,
  RuntimeEventSink,
  RuntimeProcessEvent,
  MachineProcessResult,
  MachineRuntimeDriverDependencies,
  RuntimeMachine,
  SnapshotRecord,
  SnapshotStore,
  MachineProcessOutcome,
};
