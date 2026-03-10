function MiniToggle({ checked }: { checked: boolean }) {
  return (
    <div
      className={`w-8 h-[18px] rounded-full shrink-0 flex items-center p-0.5 ${
        checked ? "bg-foreground" : "bg-interactive-border"
      }`}
    >
      <div
        className={`size-3.5 rounded-full bg-background-elevated ${
          checked ? "ml-auto" : ""
        }`}
      />
    </div>
  );
}

const SETTINGS = [
  { label: "Sync Event Name", checked: true },
  { label: "Sync Event Description", checked: true },
  { label: "Sync Event Location", checked: false },
  { label: "Sync Event Status", checked: true },
  { label: "Sync Attendees", checked: false },
];

function MiniSettingsRow({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl">
      <span className="text-sm tracking-tight text-foreground-muted whitespace-nowrap">{label}</span>
      <div className="ml-auto">
        <MiniToggle checked={checked} />
      </div>
    </div>
  );
}

export function HowItWorksConfigure() {
  return (
    <div className="w-full max-w-xs sm:-translate-x-12">
      <div className="rounded-2xl border border-border-elevated bg-background-elevated shadow-xs p-0.5">
        {SETTINGS.map(({ label, checked }) => (
          <MiniSettingsRow key={label} label={label} checked={checked} />
        ))}
      </div>
    </div>
  );
}
