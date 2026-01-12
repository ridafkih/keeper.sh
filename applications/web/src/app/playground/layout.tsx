import type { FC, PropsWithChildren } from "react";

const Layout: FC<PropsWithChildren> = ({ children }) => (
  <div className="bg-neutral-50 flex flex-col min-h-screen">{children}</div>
);

export default Layout;
