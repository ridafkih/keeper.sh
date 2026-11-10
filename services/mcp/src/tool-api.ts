import type { z } from "zod";

interface KeeperToolContext {
  bearerToken: string;
  apiBaseUrl: string;
}

interface KeeperMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

interface KeeperMcpToolDefinition<TResult> {
  description: string;
  title: string;
  annotations: KeeperMcpToolAnnotations;
  inputSchema?: Record<string, z.ZodTypeAny>;
  execute: (context: KeeperToolContext, input?: Record<string, unknown>) => Promise<TResult>;
}

const READ_ONLY: KeeperMcpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const ADDITIVE: KeeperMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE: KeeperMcpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

const isErrorResponse = (value: unknown): value is { error: string } =>
  typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";

const apiFetchRaw = async (
  context: KeeperToolContext,
  path: string,
  options?: RequestInit,
): Promise<unknown> => {
  const url = `${context.apiBaseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${context.bearerToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (isErrorResponse(body)) {
      throw new Error(body.error);
    }
    throw new Error(response.statusText);
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
};

const apiFetch = async <TResult>(
  context: KeeperToolContext,
  path: string,
  schema: z.ZodType<TResult>,
  options?: RequestInit,
): Promise<TResult> => {
  const raw = await apiFetchRaw(context, path, options);
  return schema.parse(raw);
};

const requireString = (input: Record<string, unknown> | undefined, key: string): string => {
  const value = input?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`'${key}' is required`);
  }
  return value;
};

const requireStringArray = (input: Record<string, unknown> | undefined, key: string): string[] => {
  const value = input?.[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`'${key}' must be an array of strings`);
  }
  return value;
};

const pickProvided = (
  input: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(input ?? {}, key))
      .map((key) => [key, input?.[key]]),
  );

export {
  ADDITIVE,
  DESTRUCTIVE,
  READ_ONLY,
  apiFetch,
  apiFetchRaw,
  pickProvided,
  requireString,
  requireStringArray,
};
export type { KeeperMcpToolAnnotations, KeeperMcpToolDefinition, KeeperToolContext };
