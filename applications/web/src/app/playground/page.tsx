"use client";

import KeeperSvg from "@/assets/keeper.svg";

import {
  ArrowRight,
  ArrowUpRight,
  BoltIcon,
  CalendarsIcon,
  CalendarSyncIcon,
  HomeIcon,
  ReceiptIcon,
} from "lucide-react";

import {
  CalendarStack,
  SyncCalendarsButton,
  SyncHoverProvider,
} from "./compositions/calendar-illustration/calendar-illustration";
import { Heading1, Heading2 } from "./components/heading";
import { Copy } from "./components/copy";
import { Button, ButtonText, ButtonIcon } from "./components/button";
import { Scaffold } from "./components/scaffold";
import { Dock, DockItem } from "./components/dock";
import { LinkOut } from "./components/link-out";
import { PricingGrid, PricingTier, PricingFeatureList, PricingFeature } from "./components/pricing";

export default function Playground() {
  return (
    <Scaffold>
      <header className="flex justify-between items-center">
        <KeeperSvg className="size-4" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="small">
            Login
          </Button>
          <Button variant="primary" size="small">
            Register
          </Button>
        </div>
      </header>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Heading1>All of your calendars in-sync.</Heading1>
            <Copy>
              Keeper connects to all of your calendar accounts, and syncs the events between them.
              Released open-source under AGPL-3.0.
            </Copy>
          </div>
          <SyncHoverProvider>
            <div className="flex flex-wrap gap-1">
              <SyncCalendarsButton>
                <ButtonText>Sync Calendars</ButtonText>
                <ButtonIcon icon={ArrowRight} />
              </SyncCalendarsButton>
              <Button href="https://github.com/ridafkih/keeper.sh" target="_blank" variant="outline">
                <ButtonText>View GitHub</ButtonText>
                <ButtonIcon icon={ArrowUpRight} />
              </Button>
            </div>
            <div className="py-8">
              <CalendarStack />
            </div>
          </SyncHoverProvider>
        </div>
        <div className="flex flex-col gap-4">
          <Heading2>How does it work?</Heading2>
          <Copy>
            Keeper connects to your calendar accounts. It supports Google, iCloud, Outlook &amp;
            Microsoft 365, FastMail, iCloud, CalDAV and more.
          </Copy>
          <Copy>
            Once connected, events will begin transferring from the sources you select to their
            respective destinations.
          </Copy>
          <Heading2>Pricing</Heading2>
          <Copy>Keeper has a free offering, or a premium offering for power-users.</Copy>
          <PricingGrid>
            <PricingTier title="Free">
              <PricingFeatureList>
                <PricingFeature>Two sources</PricingFeature>
                <PricingFeature>One destination</PricingFeature>
                <PricingFeature>Sync every half hour</PricingFeature>
              </PricingFeatureList>
              <LinkOut href="/register">Continue free</LinkOut>
            </PricingTier>
            <PricingTier title="Pro">
              <PricingFeatureList>
                <PricingFeature>Unlimited sources</PricingFeature>
                <PricingFeature>Unlimited destinations</PricingFeature>
                <PricingFeature>Sync every minute</PricingFeature>
              </PricingFeatureList>
              <LinkOut href="/register?plan=pro">Support the project</LinkOut>
            </PricingTier>
          </PricingGrid>
        </div>
        <footer>
          <Copy>
            Made with ♥ by{" "}
            <LinkOut variant="inline" href="https://rida.dev/">
              Rida F&apos;kih
            </LinkOut>
            .
          </Copy>
        </footer>
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
