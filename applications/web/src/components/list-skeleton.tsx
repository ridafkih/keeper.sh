import type { FC, ReactNode } from "react";
import { Card } from "@/components/card";

interface ListSkeletonProps {
  rows?: number;
}

const SkeletonRow: FC = () => (
  <div className="flex items-center gap-2 px-3 py-2">
    <div className="size-8 bg-surface-muted rounded shrink-0 animate-pulse" />
    <div className="flex-1 flex flex-col gap-1">
      <div className="h-4 bg-surface-muted rounded w-32 animate-pulse" />
      <div className="h-3 bg-surface-muted rounded w-48 animate-pulse" />
    </div>
  </div>
);

export const ListSkeleton: FC<ListSkeletonProps> = ({ rows = 2 }) => {
  const skeletonRows: ReactNode[] = [];
  for (let index = 0; index < rows; index++) {
    skeletonRows.push(<SkeletonRow key={index} />);
  }
  return (
    <Card>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="h-4 bg-surface-muted rounded w-20 animate-pulse" />
        <div className="h-4 bg-surface-muted rounded w-24 animate-pulse" />
      </div>
      <div className="border-t border-border divide-y divide-border">{skeletonRows}</div>
    </Card>
  );
};
