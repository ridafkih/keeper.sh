import X from "lucide-react/dist/esm/icons/x";
import { cn } from "@/utils/cn";

const ROW_ICON_BUTTON = "shrink-0 rounded-lg p-1.5 text-foreground-muted hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-foreground-disabled";

interface RowIconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function RowIconButton({ label, onClick, disabled, className, children }: RowIconButtonProps) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={cn(ROW_ICON_BUTTON, className)}>
      {children}
    </button>
  );
}

export function RowRemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <RowIconButton label={label} onClick={onClick} className="mr-2">
      <X size={14} />
    </RowIconButton>
  );
}
