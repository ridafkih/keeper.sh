import { authClient } from "@/lib/auth-client";

export async function signIn(username: string, password: string) {
  const response = await fetch("/api/auth/username-only/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Sign in failed");
  }

  return response.json();
}

export async function signUp(username: string, password: string) {
  const response = await fetch("/api/auth/username-only/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Sign up failed");
  }

  return response.json();
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await authClient.signIn.email({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message ?? "Sign in failed");
  }
}

export async function signUpWithEmail(email: string, password: string) {
  const { error } = await authClient.signUp.email({
    email,
    password,
    name: email.split("@")[0] ?? email,
    callbackURL: "/dashboard",
  });

  if (error) {
    throw new Error(error.message ?? "Sign up failed");
  }
}

export async function signInWithGoogle() {
  await authClient.signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
  });
}

export async function forgotPassword(email: string) {
  const { error } = await authClient.requestPasswordReset({
    email,
    redirectTo: "/reset-password",
  });

  if (error) {
    throw new Error(error.message ?? "Failed to send reset email");
  }
}

export async function resetPassword(token: string, newPassword: string) {
  const { error } = await authClient.resetPassword({
    token,
    newPassword,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to reset password");
  }
}

export async function signOut() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error("Sign out failed");
  }

  return response.json();
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Failed to change password");
  }

  return response.json();
}

export async function deleteAccount(password: string) {
  const response = await fetch("/api/auth/delete-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Failed to delete account");
  }

  return response.json();
}
