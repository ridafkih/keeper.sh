import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { BackButton } from "./back-button";
import { ErrorState } from "./error-state";

interface RouteShellProps {
  backFallback?: string;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}

export function RouteShell({ backFallback, isLoading, error, onRetry, children }: RouteShellProps) {
  if (error) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback={backFallback} />
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5">
        <BackButton fallback={backFallback} />
        <div className="flex justify-center py-6">
          <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
