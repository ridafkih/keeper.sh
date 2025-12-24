interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function SectionHeader({
  title,
  description,
  action,
}: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-md tracking-tighter font-semibold text-zinc-900">
          {title}
        </h2>
        {description && <p className="text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
