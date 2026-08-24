import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { SWRConfig } from "swr";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { LinkButton, ButtonText } from "@/components/ui/primitives/button";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { fetcher, HttpError } from "@/lib/fetcher";
import { resolveErrorMessage } from "@/utils/errors";
import type { AppRouterContext, ViteScript } from "@/lib/router-context";
import { serializePublicRuntimeConfig } from "@/lib/runtime-config";
import { clientStateScript } from "@/lib/client-state-script";
import { AnalyticsScripts } from "@/components/analytics-scripts";

const NON_RETRYABLE_STATUSES = new Set([401, 403, 404]);

const SWR_CONFIG = {
  fetcher,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 2000,
  onError: (error: unknown, key: string) => {
    console.error(`[SWR] ${key}:`, error);
  },
  onErrorRetry: (
    error: unknown,
    _key: string,
    _config: unknown,
    revalidate: (opts: { retryCount: number }) => void,
    { retryCount }: { retryCount: number },
  ) => {
    if (error instanceof HttpError && NON_RETRYABLE_STATUSES.has(error.status)) return;
    if (retryCount >= 3) return;
    setTimeout(() => revalidate({ retryCount }), 5000 * (retryCount + 1));
  },
};

export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundState,
  errorComponent: ErrorFallback,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Keeper.sh" },
    ],
  }),
});

function ViteScriptTag({ script }: { script: ViteScript }) {
  if (script.src) {
    return <script type="module" src={script.src} />;
  }

  if (script.content) {
    return <script type="module" dangerouslySetInnerHTML={{ __html: script.content }} />;
  }

  return null;
}

function RootComponent() {
  const { runtimeConfig, viteAssets } = Route.useRouteContext();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__KEEPER_RUNTIME_CONFIG__ = ${serializePublicRuntimeConfig(runtimeConfig)};`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: clientStateScript }} />
        {viteAssets?.inlineStyles?.map((css, index) => (
          <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
        ))}
        {viteAssets?.stylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} precedence="default" />
        ))}
        {viteAssets?.modulePreloads?.map((href) => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {viteAssets?.headScripts.map((script, index) => (
          <ViteScriptTag key={script.src ?? index} script={script} />
        ))}
        <link rel="icon" type="image/svg+xml" href="/keeper.svg" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/svg+xml" href="/keeper-dark.svg" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/180x180-light-on-dark.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="preload" href="/assets/fonts/Geist-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/assets/fonts/Lora-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <div id="root">
          <SWRConfig value={SWR_CONFIG}>
            <Outlet />
          </SWRConfig>
        </div>
        <Scripts />
        {viteAssets?.bodyScripts.map((script, index) => (
          <ViteScriptTag key={script.src ?? index} script={script} />
        ))}
        <AnalyticsScripts runtimeConfig={runtimeConfig} />
      </body>
    </html>
  );
}

function ErrorFallback({ error }: ErrorComponentProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-2 gap-3">
      <meta name="robots" content="noindex" />
      <Heading2>Something went wrong</Heading2>
      <Text size="sm" tone="muted">
        {resolveErrorMessage(error, "An unexpected error occurred.")}
      </Text>
      <LinkButton to="/" variant="border" size="compact">
        <ButtonText>Go home</ButtonText>
      </LinkButton>
    </div>
  );
}
