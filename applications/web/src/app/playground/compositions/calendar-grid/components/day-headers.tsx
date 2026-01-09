import type { FC } from "react";
import { Copy } from "../../../components/copy";

const DAY_LABELS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const DayHeaders: FC = () => (
  <div className="grid grid-cols-7 place-items-center">
    {DAY_LABELS.map((label) => (
      <Copy key={label} className="text-[10px]">
        {label}
      </Copy>
    ))}
  </div>
);

export { DayHeaders };
