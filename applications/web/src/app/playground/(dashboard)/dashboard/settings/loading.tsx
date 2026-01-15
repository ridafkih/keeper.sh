const SettingsLoading = () => (
  <div className="flex flex-col gap-6">
    <div className="h-8 w-32 bg-surface-skeleton rounded-xl animate-pulse" />
    {[...Array(4)].map((_, sectionIdx) => (
      <div key={sectionIdx} className="flex flex-col gap-3">
        <div className="h-5 w-40 bg-surface-skeleton rounded animate-pulse" />
        <div className="border border-border rounded-xl p-4">
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, itemIdx) => (
              <div key={itemIdx} className="flex items-center justify-between py-2">
                <div className="h-4 w-32 bg-surface-skeleton rounded animate-pulse" />
                <div className="h-4 w-48 bg-surface-skeleton rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default SettingsLoading;
