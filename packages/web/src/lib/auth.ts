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

export async function signUp(
  username: string,
  password: string,
  name?: string,
) {
  const response = await fetch("/api/auth/username-only/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, name }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Sign up failed");
  }

  return response.json();
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

export async function updateUser(data: { name?: string; image?: string }) {
  const response = await fetch("/api/auth/update-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "Failed to update profile");
  }

  return response.json();
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
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
