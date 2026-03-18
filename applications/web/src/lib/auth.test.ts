import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AuthCapabilities } from "./auth-capabilities";

const authClientMock = {
  signIn: {
    email: mock(() => Promise.resolve({ error: null })),
  },
  signUp: {
    email: mock(() => Promise.resolve({ error: null })),
  },
  requestPasswordReset: mock(() => Promise.resolve({ error: null })),
  resetPassword: mock(() => Promise.resolve({ error: null })),
};

let signInWithCredential: typeof import("./auth").signInWithCredential;
let signUpWithCredential: typeof import("./auth").signUpWithCredential;

const commercialCapabilities: AuthCapabilities = {
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: {
    google: false,
    microsoft: false,
  },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

beforeAll(async () => {
  mock.module("./auth-client", () => ({
    authClient: authClientMock,
  }));

  ({ signInWithCredential, signUpWithCredential } = await import("./auth"));
});

beforeEach(() => {
  authClientMock.signIn.email.mockClear();
  authClientMock.signUp.email.mockClear();
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  );
});

describe("signInWithCredential", () => {
  it("uses Better Auth email sign-in for commercial auth", async () => {
    await signInWithCredential("person@example.com", "password", commercialCapabilities);

    expect(authClientMock.signIn.email).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "password",
    });
  });

  it("uses the username-only endpoint for non-commercial auth", async () => {
    await signInWithCredential("keeper-user", "password", {
      ...commercialCapabilities,
      credentialMode: "username",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/username-only/sign-in", {
      body: JSON.stringify({
        password: "password",
        username: "keeper-user",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });
});

describe("signUpWithCredential", () => {
  it("uses the username-only endpoint for non-commercial auth", async () => {
    await signUpWithCredential("keeper-user", "password", {
      ...commercialCapabilities,
      credentialMode: "username",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/username-only/sign-up", {
      body: JSON.stringify({
        password: "password",
        username: "keeper-user",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });
});
