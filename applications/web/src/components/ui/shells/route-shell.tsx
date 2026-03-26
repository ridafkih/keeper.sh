import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { BackButton } from "@/components/ui/primitives/back-button";
import { ErrorState } from "@/components/ui/primitives/error-state";

type RouteShellProps = {
  backFallback?: string;
} & (
  | { status: "loading" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready" }
);

export function RouteShell(props: RouteShellProps) {
  if (props.status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <BackButton fallback={props.backFallback} />
        <ErrorState onRetry={props.onRetry} />
      </div>
    );
  }

  if (props.status === "loading") {
    return (
      <div className="flex flex-col gap-1">
        <BackButton fallback={props.backFallback} />
        <div className="flex justify-center py-6">
          <LoaderCircle size={20} className="animate-spin text-foreground-muted" />
        </div>
      </div>
    );
  }

  return null;
}
