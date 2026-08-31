import { describe, expect, it } from "vitest";
import { createDeleteUserTeardown } from "../src/delete-user-teardown";
import { createAuth } from "../src/index";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const buildMcpShapedAuth = () =>
  createAuth({
    database: {} as BunSQLDatabase,
    secret: "test-secret",
    baseUrl: "http://localhost:3000",
    commercialMode: false,
    mcpResourceUrl: "http://localhost:3002",
    mcpApiBaseUrl: "http://localhost:3000",
  } as Parameters<typeof createAuth>[0]);

const buildWiredAuth = (overrides: Record<string, unknown> = {}) =>
  createAuth({
    baseUrl: "http://localhost:3000",
    database: {} as BunSQLDatabase,
    deleteUserTeardown: async () => {},
    deleteUserResidueRecorder: async () => {},
    deleteUserTeardownRollback: async () => {},
    secret: "test-secret",
    ...overrides,
  } as Parameters<typeof createAuth>[0]);

const attemptConstruction = (build: () => unknown): { error: Error | null; value: unknown } => {
  try {
    return { error: null, value: build() };
  } catch (error) {
    return { error: error as Error, value: null };
  }
};

describe("an auth instance without a delete-user teardown", () => {
  it("refuses to offer account deletion instead of quiescing nothing", async () => {
    const { error, value } = attemptConstruction(buildMcpShapedAuth);

    if (error) {
      expect(error.message).toContain("deleteUserTeardown");
      return;
    }

    const { auth } = value as ReturnType<typeof createAuth>;

    expect(auth.options.user?.deleteUser?.enabled).toBe(false);

    const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;

    if (typeof beforeDelete === "function") {
      await expect(
        beforeDelete({ id: "user-unwired" } as never, Object.freeze({}) as never),
      ).rejects.toThrow(/teardown/i);
    }
  });

  it("rejects auth.api.deleteUser rather than resolving with nothing torn down", async () => {
    const { error, value } = attemptConstruction(buildMcpShapedAuth);

    if (error) {
      expect(error.message).toContain("deleteUserTeardown");
      return;
    }

    const { auth } = value as ReturnType<typeof createAuth>;
    const deleteUser = auth.api.deleteUser as unknown;

    if (typeof deleteUser !== "function") {
      expect(deleteUser).toBeUndefined();
      return;
    }

    await expect(
      (deleteUser as (input: unknown) => Promise<unknown>)({
        body: { callbackURL: "/" },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
  });
});

describe("createDeleteUserTeardown", () => {
  it("refuses an unwired step list at construction", () => {
    expect(() => createDeleteUserTeardown([])).toThrow(/step/i);
  });

  it("still builds a teardown from a real step list", () => {
    expect(
      createDeleteUserTeardown([{ name: "sync", run: async () => {} }]),
    ).toBeTypeOf("function");
  });
});

describe("the live compositions stay buildable", () => {
  it("keeps deletion enabled when a teardown is wired, as services/api wires it", () => {
    const { auth } = buildWiredAuth({
      polarAccessToken: "polar-test-token",
      polarMode: "sandbox",
    });

    expect(auth.options.user?.deleteUser?.enabled).toBe(true);
    expect(auth.options.user?.deleteUser?.beforeDelete).toBeTypeOf("function");
    expect(auth.options.user?.deleteUser?.afterDelete).toBeTypeOf("function");
  });

  it("constructs on the self-hosted path where the polar step list is deliberately empty", () => {
    const { auth, polarClient } = buildWiredAuth();

    expect(polarClient).toBeNull();
    expect(auth.options.user?.deleteUser?.enabled).toBe(true);
    expect(auth.options.user?.deleteUser?.afterDelete).toBeTypeOf("function");
  });
});
