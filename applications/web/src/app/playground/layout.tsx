import type { FC, PropsWithChildren } from "react";
import { Scaffold } from "./components/scaffold";

const Layout: FC<PropsWithChildren> = ({ children }) => (
  <>{children}</>
);

export default Layout;
