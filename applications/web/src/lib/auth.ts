import { authClient } from "./auth-client";
import type { AuthCapabilities } from "./auth-capabilities";
import { clearSetupSession, resolveSessionStorage } from "@/features/setup/setup-draft-storage";
import {
  ACCOUNT_DELETION_REAUTHENTICATION_PATH,
  resolveAccountDeletionOutcome,
  resolveReauthenticationErrorMessage,
} from "./account-reauthentication";
import type { AccountDeletionOutcome, ReauthenticationMethod } from "./account-reauthentication";

async function authPost(url: string, body: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message ?? "Request failed");
  }
}

async function authJsonPost(url: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
        ? data.message
        : typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error
          : "Request failed";
    throw new Error(message);
  }
}

export const signInWithCredential = async (
  credential: string,
  password: string,
  capabilities: AuthCapabilities,
): Promise<void> => {
  if (capabilities.credentialMode === "username") {
    await authJsonPost("/api/auth/username-only/sign-in", {
      password,
      username: credential,
    });
    return;
  }

  const { error } = await authClient.signIn.email({ email: credential, password });
  if (error) throw new Error(error.message ?? "Sign in failed");
};

export const signUpWithCredential = async (
  credential: string,
  password: string,
  capabilities: AuthCapabilities,
  callbackURL = "/dashboard",
): Promise<void> => {
  if (capabilities.credentialMode === "username") {
    await authJsonPost("/api/auth/username-only/sign-up", {
      password,
      username: credential,
    });
    return;
  }

  const { error } = await authClient.signUp.email({
    callbackURL,
    email: credential,
    name: credential.split("@")[0] ?? credential,
    password,
  });
  if (!error) return;
  if (error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    throw new Error("This email is already registered. Please sign in instead.");
  }
  throw new Error(error.message ?? "Sign up failed");
};

// A tab can be handed to someone else after signing out, so nothing from this user's setup survives in it.
export const signOut = () => {
  clearSetupSession(resolveSessionStorage());
  return authPost("/api/auth/sign-out");
};

export const forgotPassword = async (email: string): Promise<void> => {
  const { error } = await authClient.requestPasswordReset({
    email,
    redirectTo: "/reset-password",
  });
  if (error) throw new Error(error.message ?? "Failed to send reset email");
};

export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  const { error } = await authClient.resetPassword({ newPassword, token });
  if (error) throw new Error(error.message ?? "Failed to reset password");
};

export const changePassword = (currentPassword: string, newPassword: string) =>
  authPost("/api/auth/change-password", { currentPassword, newPassword });

export const deleteAccount = async (password?: string): Promise<AccountDeletionOutcome> => {
  const { error } = await authClient.deleteUser({ ...(password && { password }) });
  const outcome = resolveAccountDeletionOutcome(error);
  if (outcome === "deleted") {
    clearSetupSession(resolveSessionStorage());
  }
  return outcome;
};

interface ReauthenticatingUser {
  id: string;
  email?: string;
}

const reauthenticateWithPasskey = async (): Promise<void> => {
  const { error } = await authClient.signIn.passkey();
  if (error) throw new Error(resolveReauthenticationErrorMessage(error));
};

const reauthenticateWithProvider = async (
  provider: Extract<ReauthenticationMethod, { kind: "social" }>["provider"],
  user: ReauthenticatingUser,
): Promise<void> => {
  const { error } = await authClient.signIn.social({
    callbackURL: ACCOUNT_DELETION_REAUTHENTICATION_PATH,
    errorCallbackURL: "/dashboard/settings",
    newUserCallbackURL: "/dashboard",
    provider,
    ...(user.email && { loginHint: user.email }),
  });
  if (error) throw new Error(resolveReauthenticationErrorMessage(error));
};

export const reauthenticate = (
  method: ReauthenticationMethod,
  user: ReauthenticatingUser,
): Promise<void> => {
  if (method.kind === "passkey") return reauthenticateWithPasskey();
  return reauthenticateWithProvider(method.provider, user);
};
