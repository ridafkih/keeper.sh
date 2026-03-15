import type { PropsWithChildren } from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { Button, LinkButton, ButtonIcon } from "./button";

export function Pagination({ children }: PropsWithChildren) {
  return <div className="flex gap-1">{children}</div>;
}

export function PaginationPrevious({ to, onMouseEnter }: { to?: string; onMouseEnter?: () => void }) {
  if (!to) {
    return (
      <Button variant="elevated" size="compact" className="aspect-square" disabled>
        <ButtonIcon><ChevronLeft size={16} /></ButtonIcon>
      </Button>
    );
  }

  return (
    <LinkButton to={to} replace variant="elevated" size="compact" className="aspect-square" onMouseEnter={onMouseEnter}>
      <ButtonIcon><ChevronLeft size={16} /></ButtonIcon>
    </LinkButton>
  );
}

export function PaginationNext({ to, onMouseEnter }: { to?: string; onMouseEnter?: () => void }) {
  if (!to) {
    return (
      <Button variant="elevated" size="compact" className="aspect-square" disabled>
        <ButtonIcon><ChevronRight size={16} /></ButtonIcon>
      </Button>
    );
  }

  return (
    <LinkButton to={to} replace variant="elevated" size="compact" className="aspect-square" onMouseEnter={onMouseEnter}>
      <ButtonIcon><ChevronRight size={16} /></ButtonIcon>
    </LinkButton>
  );
}
