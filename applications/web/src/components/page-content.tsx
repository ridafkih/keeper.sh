import type { FC, PropsWithChildren } from "react";

export const PageContent: FC<PropsWithChildren> = ({ children }) => (
  <main className="flex-1 flex flex-col gap-8">{children}</main>
);
