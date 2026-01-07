"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, BoltIcon, CalendarsIcon, CalendarSyncIcon, HomeIcon, ReceiptIcon } from "lucide-react";

import { CalendarStack } from "./compositions/calendar-illustration/calendar-illustration";
import { Heading1 } from "./components/heading";
import { Copy } from "./components/copy";
import { Button, ButtonText, ButtonIcon } from "./components/button";
import { Scaffold } from "./components/scaffold";
import { Dock, DockItem } from "./components/dock";

export default function Playground() {
  const [isSyncHovered, setIsSyncHovered] = useState(false);

  return (
    <Scaffold>
      <div className="flex flex-col gap-8 pb-8 pt-32">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Heading1>All of your calendars in-sync.</Heading1>
            <Copy>
              Keeper connects to all of your calendar accounts, and syncs the events between them. Released open-source under AGPL-3.0.
            </Copy>
          </div>
          <div className="flex gap-1">
            <Button
              variant="primary"
              onMouseEnter={() => setIsSyncHovered(true)}
              onMouseLeave={() => setIsSyncHovered(false)}
            >
              <ButtonText>Sync Calendars</ButtonText>
              <ButtonIcon icon={ArrowRight} />
            </Button>
            <Button variant="outline">
              <ButtonText>View GitHub</ButtonText>
              <ButtonIcon icon={ArrowUpRight} />
            </Button>
            <Button variant="ghost">
              <ButtonText>Get Started</ButtonText>
            </Button>
          </div>
        </div>
        <CalendarStack emphasized={isSyncHovered} />
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
