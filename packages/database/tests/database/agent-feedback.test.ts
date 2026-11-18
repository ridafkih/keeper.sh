import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { agentFeedbackTable } from "../../src/database/schema";

const MIGRATION = readFileSync(new URL("../../drizzle/0111_agent_feedback.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .join("\n");

const VALID_ROW = {
  category: "missing_capability",
  deployment: "self-hosted",
  message: "There is no tool to list recurring event exceptions.",
  severity: "medium",
  toolName: "get_events",
  version: "2.29.0",
};

const createDatabase = async () => {
  const client = new PGlite();
  await client.exec(MIGRATION);
  return client;
};

const insert = (client: PGlite, row: Record<string, string | null>) =>
  client.query(
    `insert into "agent_feedback" ("category", "deployment", "message", "severity", "toolName", "version")
     values ($1, $2, $3, $4, $5, $6)`,
    [row.category, row.deployment, row.message, row.severity, row.toolName, row.version],
  );

describe("agent_feedback migration", () => {
  it("stores a submission with its id and timestamp filled in", async () => {
    const client = await createDatabase();
    await insert(client, VALID_ROW);

    const { rows } = await client.query<{ id: string; createdAt: Date; toolName: string }>(
      `select "id", "createdAt", "toolName" from "agent_feedback"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(rows[0]?.toolName).toBe("get_events");
  });

  it("accepts a submission that is not about one tool", async () => {
    const client = await createDatabase();
    await insert(client, { ...VALID_ROW, toolName: null });

    const { rows } = await client.query(`select 1 from "agent_feedback"`);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["category", "spam"],
    ["severity", "critical"],
    ["deployment", "unknown"],
  ])("rejects an unknown %s", async (column, value) => {
    const client = await createDatabase();

    await expect(insert(client, { ...VALID_ROW, [column]: value })).rejects.toThrow(
      `agent_feedback_${column}_check`,
    );
  });

  it("applies cleanly a second time", async () => {
    const client = await createDatabase();

    await expect(client.exec(MIGRATION)).resolves.toBeDefined();
  });

  it("keeps no column that could identify a user or an instance", () => {
    const columnNames = getTableConfig(agentFeedbackTable).columns.map(({ name }) => name).toSorted();

    expect(columnNames).toEqual([
      "category",
      "createdAt",
      "deployment",
      "id",
      "intent",
      "message",
      "severity",
      "toolName",
      "version",
    ]);
  });
});
