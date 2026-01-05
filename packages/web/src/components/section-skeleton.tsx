import type { FC } from "react";
import { Section } from "@/components/section";
import { ListSkeleton } from "@/components/list-skeleton";

const DEFAULT_SKELETON_ROWS = 2;

interface SectionSkeletonProps {
  rows?: number;
}

const HeaderSkeleton: FC = () => (
  <div className="flex flex-col gap-1">
    <div className="h-5 bg-surface-muted rounded w-32 animate-pulse" />
    <div className="h-4 bg-surface-muted rounded w-64 animate-pulse" />
  </div>
);

export const SectionSkeleton: FC<SectionSkeletonProps> = ({ rows = DEFAULT_SKELETON_ROWS }) => (
  <Section>
    <HeaderSkeleton />
    <ListSkeleton rows={rows} />
  </Section>
);
