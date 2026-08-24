import useSWR from "swr";
import { fetcher, apiFetch } from "@/lib/fetcher";

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  createdAt: string;
}

export const useApiTokens = () => {
  return useSWR<ApiToken[]>("/api/tokens", fetcher);
};

export const createApiToken = async (name: string): Promise<CreatedApiToken> => {
  const response = await apiFetch("/api/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return response.json();
};

export const deleteApiToken = async (id: string): Promise<void> => {
  await apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
};
