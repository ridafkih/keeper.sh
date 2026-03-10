import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";

const PROVIDERS = [
  { icon: "/integrations/icon-google-calendar.svg", label: "Connect Google Calendar" },
  { icon: "/integrations/icon-outlook.svg", label: "Connect Outlook" },
  { icon: "/integrations/icon-icloud.svg", label: "Connect iCloud" },
  { icon: "/integrations/icon-fastmail.svg", label: "Connect Fastmail" },
  { icon: "/integrations/icon-microsoft-365.svg", label: "Connect Microsoft 365" },
];

function MiniMenuRow({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl">
      <img src={icon} alt="" width={18} height={18} className="shrink-0" />
      <span className="text-sm tracking-tight text-foreground-muted whitespace-nowrap">{label}</span>
      <ArrowRightIcon size={14} className="ml-auto shrink-0 text-foreground-disabled" />
    </div>
  );
}

export function HowItWorksConnect() {
  return (
    <div className="w-full max-w-xs">
      <div className="rounded-2xl border border-border-elevated bg-background-elevated shadow-xs p-0.5">
        {PROVIDERS.map(({ icon, label }) => (
          <MiniMenuRow key={label} icon={icon} label={label} />
        ))}
      </div>
    </div>
  );
}
