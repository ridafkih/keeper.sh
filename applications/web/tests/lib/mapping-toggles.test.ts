import { describe, expect, it } from "vitest";
import { applyMappingToggle, enqueueMappingToggle } from "../../src/lib/mapping-toggles";
import type { MappingToggle } from "../../src/lib/mapping-toggles";

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const createServer = (initial: string[]) => {
  let mapped = [...initial];
  const received: MappingToggle[] = [];
  const pending: (() => void)[] = [];
  const send = (toggle: MappingToggle): Promise<string[]> => {
    received.push(toggle);
    const { promise, resolve } = Promise.withResolvers<string[]>();
    pending.push(() => {
      mapped = applyMappingToggle(mapped, toggle);
      resolve(mapped);
    });
    return promise;
  };
  const respond = async () => {
    pending.shift()?.();
    await flush();
  };
  return { mapped: () => mapped, received, respond, send };
};

describe("mapping toggles", () => {
  it("sends every toggle made before the server answers, so none is lost", async () => {
    const server = createServer([]);
    const published: string[][] = [];
    const options = {
      currentIds: [],
      onError: () => null,
      publish: (calendarIds: string[]) => { published.push(calendarIds); },
      send: server.send,
    };

    enqueueMappingToggle("source-1", { calendarId: "dest-a", enabled: true }, options);
    enqueueMappingToggle("source-1", { calendarId: "dest-b", enabled: true }, options);
    await server.respond();
    await server.respond();

    expect(server.mapped()).toEqual(["dest-a", "dest-b"]);
    expect(published).toEqual([["dest-a"], ["dest-a", "dest-b"], ["dest-a", "dest-b"], ["dest-a", "dest-b"]]);
  });

  it("keeps toggles queued behind an answer visible while it lands", async () => {
    const server = createServer(["dest-x"]);
    const published: string[][] = [];
    const options = {
      currentIds: ["dest-x"],
      onError: () => null,
      publish: (calendarIds: string[]) => { published.push(calendarIds); },
      send: server.send,
    };

    enqueueMappingToggle("source-2", { calendarId: "dest-a", enabled: true }, options);
    enqueueMappingToggle("source-2", { calendarId: "dest-x", enabled: false }, options);
    await server.respond();

    expect(published).toEqual([["dest-x", "dest-a"], ["dest-a"], ["dest-a"]]);
    await server.respond();
    expect(server.mapped()).toEqual(["dest-a"]);
  });

  it("drops a rejected toggle without undoing the others", async () => {
    const rejected: MappingToggle[] = [];
    const published: string[][] = [];
    let mapped: string[] = [];
    const send = (toggle: MappingToggle): Promise<string[]> => {
      if (toggle.calendarId === "dest-limit") {
        return Promise.reject(new Error("Mapping limit reached"));
      }
      mapped = applyMappingToggle(mapped, toggle);
      return Promise.resolve(mapped);
    };
    const options = {
      currentIds: [],
      onError: (toggle: MappingToggle) => { rejected.push(toggle); },
      publish: (calendarIds: string[]) => { published.push(calendarIds); },
      send,
    };

    enqueueMappingToggle("source-3", { calendarId: "dest-a", enabled: true }, options);
    enqueueMappingToggle("source-3", { calendarId: "dest-limit", enabled: true }, options);
    await flush();

    expect(rejected).toEqual([{ calendarId: "dest-limit", enabled: true }]);
    expect(published).toEqual([["dest-a"], ["dest-a", "dest-limit"], ["dest-a", "dest-limit"], ["dest-a"]]);
  });
});
