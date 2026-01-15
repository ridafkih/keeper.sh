const AgendaLoading = () => (
  <div className="flex flex-col gap-4">
    <div className="h-8 w-32 bg-surface-skeleton rounded-xl animate-pulse" />
    <div className="flex flex-col gap-2">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="h-4 w-24 bg-surface-skeleton rounded animate-pulse" />
          <div className="h-16 bg-surface-skeleton rounded-xl animate-pulse" />
        </div>
      ))}
    </div>
  </div>
);

export default AgendaLoading;
