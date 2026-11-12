import { createFileRoute, Outlet } from "@tanstack/react-router";
import { readConnectSearch } from "@/lib/connect-return";
import { cn } from "@/utils/cn";

export const Route = createFileRoute("/(dashboard)/dashboard/connect")({
  component: ConnectLayout,
  validateSearch: readConnectSearch,
});

function ConnectLayout() {
  const { returnTo } = Route.useSearch();

  return (
    <div className={cn("flex flex-col gap-3", returnTo === "onboarding" && "my-auto w-full max-w-xs self-center")}>
      <Outlet />
    </div>
  );
}
