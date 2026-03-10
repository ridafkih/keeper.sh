export interface AppAuthContext {
  hasSession: () => boolean;
}

export type AppJsonFetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface ViteScript {
  src?: string;
  content?: string;
}

export interface ViteAssets {
  stylesheets: string[];
  headScripts: ViteScript[];
  bodyScripts: ViteScript[];
}

export interface AppRouterContext {
  auth: AppAuthContext;
  fetchApi: AppJsonFetcher;
  fetchWeb: AppJsonFetcher;
  viteAssets: ViteAssets | null;
}
