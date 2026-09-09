import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { usernameOnly } from "../../src/plugins/username-only";

const BASE_URL = "http://localhost:3000";

const buildAuth = () =>
  betterAuth({
    baseURL: BASE_URL,
    database: memoryAdapter({ account: [], session: [], user: [], verification: [] }),
    plugins: [usernameOnly()],
    secret: "test-secret",
  });

type Auth = ReturnType<typeof buildAuth>;

const post = (auth: Auth, path: string, body: object, cookie?: string) => {
  const headers = new Headers({ "content-type": "application/json", origin: BASE_URL });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
  );
};

const signUp = async (auth: Auth, username: string): Promise<string> => {
  const response = await post(auth, "/username-only/sign-up", {
    password: "password123",
    username,
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
};

describe("username field through the core update-user endpoint", () => {
  it("rejects a username change", async () => {
    const auth = buildAuth();
    const cookie = await signUp(auth, "alice");

    const response = await post(auth, "/update-user", { username: "bob" }, cookie);

    expect(response.status).toBe(400);
  });

  it("rejects taking another user's username", async () => {
    const auth = buildAuth();
    await signUp(auth, "bob");
    const cookie = await signUp(auth, "alice");

    const response = await post(auth, "/update-user", { username: "bob" }, cookie);
    expect(response.status).toBe(400);

    const signIn = await post(auth, "/username-only/sign-in", {
      password: "password123",
      username: "bob",
    });
    const body: unknown = await signIn.json();
    expect(signIn.status).toBe(200);
    expect(body).toMatchObject({ user: { email: "bob@local", username: "bob" } });
  });

  it("still allows other profile fields to change", async () => {
    const auth = buildAuth();
    const cookie = await signUp(auth, "alice");

    const response = await post(auth, "/update-user", { name: "Alice" }, cookie);

    expect(response.status).toBe(200);
  });
});
