"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, BoltIcon, CalendarsIcon, CalendarSyncIcon, HomeIcon, ReceiptIcon } from "lucide-react";

import { CalendarStack } from "./compositions/calendar-illustration/calendar-illustration";
import { Heading1, Heading2, Heading3 } from "./components/heading";
import { Copy } from "./components/copy";
import { Button, ButtonText, ButtonIcon } from "./components/button";
import { Scaffold } from "./components/scaffold";
import { Dock, DockItem } from "./components/dock";
import Link from "next/link";

export default function Playground() {
  const [isSyncHovered, setIsSyncHovered] = useState(false);

  return (
    <Scaffold>
      <header className="flex gap-0.5 items-center justify-end">
        <Button variant="ghost" size="small">Login</Button>
        <Button variant="primary" size="small">Register</Button>
      </header>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Heading1>All of your calendars in-sync.</Heading1>
            <Copy>
              Keeper connects to all of your calendar accounts, and syncs the events between them. Released open-source under AGPL-3.0.
            </Copy>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="primary"
              onMouseEnter={() => setIsSyncHovered(true)}
              onMouseLeave={() => setIsSyncHovered(false)}
            >
              <ButtonText>Sync Calendars</ButtonText>
              <ButtonIcon icon={ArrowRight} />
            </Button>
            <Button href="https://github.com/ridafkih/keeper.sh" target="_blank" variant="outline">
              <ButtonText>View GitHub</ButtonText>
              <ButtonIcon icon={ArrowUpRight} />
            </Button>
          </div>
        </div>
        <div className="py-8">
          <CalendarStack emphasized={isSyncHovered} />
        </div>
        <div className="flex flex-col gap-4">
          <Heading2>How does it work?</Heading2>
          <Copy>Keeper connects to your calendar accounts. It supports Google, iCloud, Outlook &amp; Microsoft 365, FastMail, iCloud, CalDAV and more.</Copy>
          <Copy>Once connected, events will begin transferring from the sources you select to their respective destinations.</Copy>
          <Heading2>Pricing</Heading2>
          <Copy>Keeper has a free offering, or a premium offering for power-users.</Copy>
          <ul className="grid grid-cols-2">
            <li className="flex flex-col gap-2">
              <Heading3>Free</Heading3>
              <Copy>No cost. Two sources. One destination. Sync every half hour.</Copy>
            </li>
            <li className="flex flex-col gap-2">
              <Heading3>Pro</Heading3>
              <Copy>$3.50/mo., Unlimited sources &amp; destinations. Sync every minute.</Copy>
            </li>
          </ul>
        </div>
        <Dock>
          <DockItem href="#home" hash="home" icon={HomeIcon} />
          <DockItem href="#calendars" hash="calendars" icon={CalendarsIcon} />
          <DockItem href="#sync" hash="sync" icon={CalendarSyncIcon} />
          <DockItem href="#billing" hash="billing" icon={ReceiptIcon} />
          <DockItem href="#settings" hash="settings" icon={BoltIcon} />
        </Dock>
      </div>
    </Scaffold>
  );
}
