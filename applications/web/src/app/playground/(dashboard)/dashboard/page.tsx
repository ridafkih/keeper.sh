import { Scaffold } from "../../components/scaffold";
import { Heading1, Heading2 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { IconButton } from "../../components/icon-button";
import { CogIcon } from "lucide-react";

const DashboardPage = () => (
  <Scaffold className="py-8">
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Heading1>Home</Heading1>
        <Copy>Welcome, Rida. It&apos;s Thursday the 8th and you&apos;ve got 4 events today across 5 calendars. This month is busier than usual.</Copy>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Heading2>Calendar View</Heading2>
          <IconButton size="small" variant="outline" icon={CogIcon}></IconButton>
        </div>
        <div className="w-full aspect-square bg-neutral-300 rounded-2xl p-px overflow-hidden">
          <div className="grid grid-cols-7 size-full aspect-square bg-neutral-300 rounded-[0.9375rem] gap-px overflow-hidden">
            {[...Array(7 * 4)].map((_, index) => <div key={index.toString()} className="bg-neutral-50 size-full" />)}
          </div>
        </div>
      </div>
    </div>
  </Scaffold>
);

export default DashboardPage;
