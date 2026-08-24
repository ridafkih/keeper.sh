import useSWR from "swr";
import { authClient } from "@/lib/auth-client";

export interface Passkey {
  id: string;
  name?: string | null;
  createdAt: Date;
}

const fetchPasskeys = async (): Promise<Passkey[]> => {
  const { data } = await authClient.passkey.listUserPasskeys();
  return data ?? [];
};

export const addPasskey = async () => {
  await authClient.passkey.addPasskey();
};

export const deletePasskey = async (id: string) => {
  await authClient.passkey.deletePasskey({ id });
};

export const usePasskeys = (enabled = true) => {
  return useSWR(enabled ? "auth/passkeys" : null, fetchPasskeys);
};
