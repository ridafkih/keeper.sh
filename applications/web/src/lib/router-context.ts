import type { PublicRuntimeConfig } from "./runtime-config";

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
  inlineStyles: string[];
  modulePreloads: string[];
  headScripts: ViteScript[];
  bodyScripts: ViteScript[];
}

export interface AppRouterContext {
  auth: AppAuthContext;
  fetchApi: AppJsonFetcher;
  fetchWeb: AppJsonFetcher;
  runtimeConfig: PublicRuntimeConfig;
  viteAssets: ViteAssets | null;
}
