import { describe, expect, test } from "bun:test";
import { SourceDestinationMappingEventType } from "@keeper.sh/state-machines";
import {
  createSourceDestinationMappingRuntime,
  type SourceDestinationMappingFailureEvent,
} from "./source-destination-mapping-runtime";
import { InMemoryCommandOutboxStore } from "./machine-runtime-driver";

describe("source destination mapping runtime", () => {
  test("requests sync when mapping update changes links", async () => {
    let sequence = 0;
    let syncRequests = 0;
    const runtime = createSourceDestinationMappingRuntime({
      aggregateId: "user-1:source:calendar-1",
      classifyFailure: () => null,
      createEnvelope: (event) => {
        sequence += 1;
        return {
          actor: { id: "api", type: "user" },
          event,
          id: `user-1:source:calendar-1:${sequence}:${event.type}`,
          occurredAt: "2026-03-21T10:00:00.000Z",
        };
      },
      handlers: {
        applyUpdate: () => Promise.resolve(true),
        requestSync: () => {
          syncRequests += 1;
          return Promise.resolve();
        },
      },
      onRuntimeEvent: () => Promise.resolve(),
      outboxStore: new InMemoryCommandOutboxStore(),
    });

    const transition = await runtime.applyUpdate();
    expect(transition.outputs).toEqual([
      { type: "MAPPINGS_UPDATED", changed: true },
      { type: "SYNC_REQUESTED" },
    ]);
    expect(syncRequests).toBe(1);
  });

  test("does not request sync for unchanged mappings", async () => {
    let sequence = 0;
    let syncRequests = 0;
    const runtime = createSourceDestinationMappingRuntime({
      aggregateId: "user-1:destination:calendar-1",
      classifyFailure: () => null,
      createEnvelope: (event) => {
        sequence += 1;
        return {
          actor: { id: "api", type: "user" },
          event,
          id: `user-1:destination:calendar-1:${sequence}:${event.type}`,
          occurredAt: "2026-03-21T10:00:00.000Z",
        };
      },
      handlers: {
        applyUpdate: () => Promise.resolve(false),
        requestSync: () => {
          syncRequests += 1;
          return Promise.resolve();
        },
      },
      onRuntimeEvent: () => Promise.resolve(),
      outboxStore: new InMemoryCommandOutboxStore(),
    });

    const transition = await runtime.applyUpdate();
    expect(transition.outputs).toEqual([{ type: "MAPPINGS_UPDATED", changed: false }]);
    expect(syncRequests).toBe(0);
  });

  test("maps limit failures to machine output", async () => {
    let sequence = 0;
    const runtime = createSourceDestinationMappingRuntime({
      aggregateId: "aggregate-1",
      classifyFailure: () => ({
        type: SourceDestinationMappingEventType.LIMIT_REJECTED,
      } satisfies SourceDestinationMappingFailureEvent),
      createEnvelope: (event) => {
        sequence += 1;
        return {
          actor: { id: "api", type: "user" },
          event,
          id: `aggregate-1:${sequence}:${event.type}`,
          occurredAt: "2026-03-21T10:00:00.000Z",
        };
      },
      handlers: {
        applyUpdate: () => Promise.reject(new Error("Mapping limit reached")),
        requestSync: () => Promise.resolve(),
      },
      onRuntimeEvent: () => Promise.resolve(),
      outboxStore: new InMemoryCommandOutboxStore(),
    });

    const transition = await runtime.applyUpdate();
    expect(transition.outputs).toEqual([{ type: "MAPPING_LIMIT_REJECTED" }]);
  });

  test("rethrows unknown failures", async () => {
    const expectedError = new Error("unknown");
    const runtime = createSourceDestinationMappingRuntime({
      aggregateId: "aggregate-1",
      classifyFailure: () => null,
      createEnvelope: (event) => ({
        actor: { id: "api", type: "user" },
        event,
        id: `aggregate-1:${event.type}`,
        occurredAt: "2026-03-21T10:00:00.000Z",
      }),
      handlers: {
        applyUpdate: () => Promise.reject(expectedError),
        requestSync: () => Promise.resolve(),
      },
      onRuntimeEvent: () => Promise.resolve(),
      outboxStore: new InMemoryCommandOutboxStore(),
    });

    await expect(runtime.applyUpdate()).rejects.toBe(expectedError);
  });
});
