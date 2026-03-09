import { Outlet, Scripts, createRootRouteWithContext, useLocation } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { SWRConfig } from "swr";
import { Heading2 } from "../components/ui/primitives/heading";
import { Text } from "../components/ui/primitives/text";
import { LinkButton, ButtonText } from "../components/ui/primitives/button";
import { fetcher, HttpError } from "../lib/fetcher";
import { resolveErrorMessage } from "../utils/errors";
import type { AppRouterContext } from "../lib/router-context";

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
  notFoundComponent: NotFound,
  errorComponent: ErrorFallback,
});

function RootComponent() {
  return (
    <SWRConfig value={SWR_CONFIG}>
      <ScrollToTopOnNavigation />
      <Outlet />
      <Scripts />
    </SWRConfig>
  );
}

function ScrollToTopOnNavigation() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash.length > 0) {
      return;
    }

    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [location.hash, location.pathname]);

  return null;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-2 gap-3">
      <Heading2>Page not found</Heading2>
      <Text size="sm" tone="muted">
        The page you're looking for doesn't exist.
      </Text>
      <LinkButton to="/" variant="border" size="compact">
        <ButtonText>Go home</ButtonText>
      </LinkButton>
    </div>
  );
}

function ErrorFallback({ error }: ErrorComponentProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-2 gap-3">
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
