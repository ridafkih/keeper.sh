import { Spinner } from "@keeper.sh/ui";

const CalendarsLoading = () => (
  <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between">
      <div className="h-8 w-32 bg-surface-skeleton rounded-xl animate-pulse" />
      <div className="flex gap-2">
        <div className="h-9 w-24 bg-surface-skeleton rounded-xl animate-pulse" />
        <div className="h-9 w-24 bg-surface-skeleton rounded-xl animate-pulse" />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-20 bg-surface-subtle border border-border rounded-xl flex items-center justify-center"
        >
          <Spinner className="size-5 text-foreground-subtle" />
        </div>
      ))}
    </div>
  </div>
);

export default CalendarsLoading;
