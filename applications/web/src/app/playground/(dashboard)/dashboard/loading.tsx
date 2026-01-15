import { Spinner } from "@keeper.sh/ui";

const DashboardLoading = () => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-2">
      <div className="h-12 w-64 bg-surface-skeleton rounded-xl animate-pulse" />
      <div className="h-6 w-96 bg-surface-skeleton rounded-xl animate-pulse" />
    </div>
    <div className="flex flex-col gap-4">
      <div className="h-[600px] bg-surface-subtle border border-border rounded-xl flex items-center justify-center">
        <Spinner className="size-8 text-foreground-subtle" />
      </div>
      <div className="flex flex-col gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-surface-skeleton rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  </div>
);

export default DashboardLoading;
