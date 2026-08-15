import type { PropsWithChildren } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import MenuIcon from "lucide-react/dist/esm/icons/menu";
import XIcon from "lucide-react/dist/esm/icons/x";
import { tv } from "tailwind-variants/lite";
import { LayoutRow } from "@/components/ui/shells/layout";
import { Button } from "@/components/ui/primitives/button";
import { StaggeredBackdropBlur } from "@/components/ui/primitives/staggered-backdrop-blur";
import { SessionSlot } from "@/components/ui/shells/session-slot";

const MENU_ID = "marketing-header-menu";

const navItem = tv({
  base: "px-2 py-1 rounded-lg text-sm tracking-tight font-light text-foreground-muted hover:text-foreground-hover aria-[current=page]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
});

const overlayNavItem = tv({
  base: "font-lora font-medium leading-tight -tracking-[0.05em] text-4xl text-foreground-muted hover:text-foreground-hover aria-[current=page]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg",
});
import { NAV_ITEMS } from "./nav-items";

export function MarketingHeader({ children }: PropsWithChildren) {
  return (
    <div className="w-full sticky top-0 z-50">
      <StaggeredBackdropBlur />
      <LayoutRow className="relative z-10">
        <header className="flex justify-between items-center gap-2 py-3 md:grid md:grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)]">
          {children}
        </header>
      </LayoutRow>
    </div>
  );
}

export function MarketingHeaderBranding({ children, label }: PropsWithChildren<{ label?: string }>) {
  return (
    <div className="flex items-center md:justify-start">
      <Link
        to="/"
        className="inline-flex items-center justify-center -m-0.5 p-0.5 rounded-lg text-foreground hover:text-foreground-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
      >
        {children}
      </Link>
    </div>
  );
}

export function MarketingHeaderNav() {
  return (
    <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
      {NAV_ITEMS.map(({ to, label }) => (
        <Link key={label} to={to} className={navItem()}>{label}</Link>
      ))}
    </nav>
  );
}

export function MarketingHeaderMenu() {
  const [expanded, setExpanded] = useState(false);

  const close = useCallback(() => setExpanded(false), []);
  const open = useCallback(() => setExpanded(true), []);

  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, close]);

  return (
    <div className="md:hidden">
      <Button
        type="button"
        size="compact"
        variant="border"
        aria-controls={MENU_ID}
        aria-expanded={expanded}
        aria-label={expanded ? "Close navigation menu" : "Open navigation menu"}
        className="size-8! p-0! justify-center shrink-0"
        onClick={expanded ? close : open}
      >
        {expanded
          ? <XIcon size={20} className="shrink-0" aria-hidden="true" />
          : <MenuIcon size={20} className="shrink-0" aria-hidden="true" />}
      </Button>
      {expanded && createPortal(
        <div id={MENU_ID} className="fixed inset-0 z-40 flex flex-col bg-background overflow-y-auto md:hidden">
          <LayoutRow className="grow">
            <nav aria-label="Primary" className="flex h-full flex-col items-start gap-6 pt-28 pb-16">
              <Link to="/" onClick={close} className={overlayNavItem()}>
                Home
              </Link>
              {NAV_ITEMS.map(({ to, label }) => (
                <Link key={label} to={to} onClick={close} className={overlayNavItem()}>
                  {label}
                </Link>
              ))}
              <span className="mt-auto flex flex-col items-start gap-6">
                <SessionSlot
                  authenticated={
                    <Link to="/dashboard" onClick={close} className={overlayNavItem()}>
                      Dashboard
                    </Link>
                  }
                  unauthenticated={
                    <>
                      <Link to="/login" onClick={close} className={overlayNavItem()}>
                        Login
                      </Link>
                      <Link to="/register" onClick={close} className={overlayNavItem()}>
                        Register
                      </Link>
                    </>
                  }
                />
              </span>
            </nav>
          </LayoutRow>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function MarketingHeaderActions({ children }: PropsWithChildren) {
  return (
    <div className="flex items-center gap-2 md:justify-end">
      {children}
    </div>
  );
}
