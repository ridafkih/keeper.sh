import type { SessionUser } from "@/hooks/use-session";

interface AccountIdentity {
  label: "Email" | "Username";
  value: string;
}

const resolveAccountIdentity = (user: SessionUser | null): AccountIdentity => {
  if (user?.username) {
    return { label: "Username", value: user.username };
  }

  return { label: "Email", value: user?.email ?? "" };
};

export { resolveAccountIdentity };
export type { AccountIdentity };
