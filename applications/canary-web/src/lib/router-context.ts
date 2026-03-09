export interface AppAuthContext {
  hasSession: () => boolean;
}

export interface AppRouterContext {
  auth: AppAuthContext;
  fetchApi: <T>(path: string, init?: RequestInit) => Promise<T>;
}
