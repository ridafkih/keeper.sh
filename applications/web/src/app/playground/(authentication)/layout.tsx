import type { FC, PropsWithChildren } from "react";
import KeeperSvg from "@/assets/keeper.svg";
import Link from "next/link";

const AuthenticationLayout: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex flex-col items-center justify-center gap-4">
    {children}
  </div>
);

export default AuthenticationLayout;
