import type { FC, PropsWithChildren } from "react";
import KeeperSvg from "@/assets/keeper.svg";
import { Scaffold } from "./components/scaffold";
import { Button } from "./components/button";
import Link from "next/link";
import { HeartIcon } from "lucide-react";
import { Dock, DockItem } from "./components/dock";
import { LinkOut } from "./components/link-out";
import { Copy } from "./components/copy";

const Layout: FC<PropsWithChildren> = ({ children }) => (
    <Scaffold>
      <header className="flex justify-between items-center">
        <Link href="/playground">
          <KeeperSvg className="size-4" />
        </Link>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="small">
            Login
          </Button>
          <Button variant="primary" size="small">
            Register
          </Button>
        </div>
      </header>
      {children}
      <footer className="flex flex-col gap-1">
        <div className="flex gap-2">
          <LinkOut variant="inline-subtle" size="small" href="/playground/privacy">
            Privacy Policy
          </LinkOut>
          <LinkOut variant="inline-subtle" size="small" href="/playground/terms">
            Terms &amp; Conditions
          </LinkOut>
        </div>
        <Copy className="text-xs text-neutral-400">
          Keeper is a Canadian project made with <HeartIcon className="size-3 -mt-1 inline fill-neutral-500 text-neutral-500" /> by{" "}
          <LinkOut variant="inline-subtle" size="small" href="https://rida.dev/" target="_blank">
            Rida F&apos;kih
          </LinkOut>
        </Copy>
      </footer>
      <Dock>
        <DockItem href="#home" hash="home" icon="HomeIcon" />
        <DockItem href="#calendars" hash="calendars" icon="CalendarsIcon" />
        <DockItem href="#sync" hash="sync" icon="CalendarSyncIcon" />
        <DockItem href="#billing" hash="billing" icon="ReceiptIcon" />
        <DockItem href="#settings" hash="settings" icon="BoltIcon" />
      </Dock>
    </Scaffold>
  )

export default Layout;
