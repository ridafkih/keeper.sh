import type { FC, PropsWithChildren } from "react";

import { Copy } from "./copy";
import { cn } from "../utils/cn";

const InlineTable: FC<PropsWithChildren> = ({ children }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm text-left border-collapse">{children}</table>
  </div>
);

const InlineTableHeader: FC<PropsWithChildren> = ({ children }) => (
  <thead>
    <tr className="border-b border-neutral-300">{children}</tr>
  </thead>
);

const InlineTableBody: FC<PropsWithChildren> = ({ children }) => (
  <tbody className="text-neutral-500 align-top">{children}</tbody>
);

interface InlineTableRowProps {
  last?: boolean;
}

const InlineTableRow: FC<PropsWithChildren<InlineTableRowProps>> = ({ last, children }) => (
  <tr className={cn({"border-b border-neutral-200": last})}>{children}</tr>
);

const InlineTableHead: FC<PropsWithChildren> = ({ children }) => (
  <th className="py-2 pr-4 font-medium text-neutral-800 whitespace-nowrap">{children}</th>
);

const InlineTableCell: FC<PropsWithChildren> = ({ children }) => (
  <td className="py-2 pr-4 whitespace-nowrap">{children}</td>
);

const InlineTableList: FC<PropsWithChildren> = ({ children }) => (
  <td className="py-2 pr-4">
    <ul className="list-disc list-inside *:text-nowrap">{children}</ul>
  </td>
);

const InlineTableListItem: FC<PropsWithChildren> = ({ children }) => (
  <Copy as="li">{children}</Copy>
);

export {
  InlineTable,
  InlineTableHeader,
  InlineTableBody,
  InlineTableRow,
  InlineTableHead,
  InlineTableCell,
  InlineTableList,
  InlineTableListItem,
};
