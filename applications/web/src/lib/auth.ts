import { authClient } from "@/lib/auth-client";

interface AuthResponse {
  user?: { id: string; email?: string; name?: string };
  session?: { id: string };
}

const FIRST_ELEMENT_INDEX = 0;

const signIn = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch("/api/auth/username-only/sign-in", {
    body: JSON.stringify({ password, username }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Sign in failed");
  }

  return response.json();
};

const signUp = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch("/api/auth/username-only/sign-up", {
    body: JSON.stringify({ password, username }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Sign up failed");
  }

  return response.json();
};

const signInWithEmail = async (email: string, password: string): Promise<void> => {
  const { error } = await authClient.signIn.email({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message ?? "Sign in failed");
  }
};

const signUpWithEmail = async (email: string, password: string): Promise<void> => {
  const { error } = await authClient.signUp.email({
    callbackURL: "/dashboard",
    email,
    name: email.split("@")[FIRST_ELEMENT_INDEX] ?? email,
    password,
  });

  if (error) {
    throw new Error(error.message ?? "Sign up failed");
  }
};

const signInWithGoogle = async (): Promise<void> => {
  await authClient.signIn.social({
    callbackURL: "/dashboard",
    provider: "google",
  });
};

const forgotPassword = async (email: string): Promise<void> => {
  const { error } = await authClient.requestPasswordReset({
    email,
    redirectTo: "/reset-password",
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send reset email");
  }
};

const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  const { error } = await authClient.resetPassword({
    newPassword,
    token,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to reset password");
  }
};

const signOut = async (): Promise<AuthResponse> => {
  const response = await fetch("/api/auth/sign-out", {
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Sign out failed");
  }

  return response.json();
};

const changePassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<AuthResponse> => {
  const response = await fetch("/api/auth/change-password", {
    body: JSON.stringify({ currentPassword, newPassword }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Failed to change password");
  }

  return response.json();
};

const deleteAccount = async (password: string): Promise<AuthResponse> => {
  const response = await fetch("/api/auth/delete-user", {
    body: JSON.stringify({ password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Failed to delete account");
  }

  return response.json();
};

export {
  signIn,
  signUp,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  forgotPassword,
  resetPassword,
  signOut,
  changePassword,
  deleteAccount,
};
