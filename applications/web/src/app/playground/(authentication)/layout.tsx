import type { FC, PropsWithChildren } from "react";
import { Scaffold } from "../components/scaffold";

const AuthenticationLayout: FC<PropsWithChildren> = ({ children }) => (
  <Scaffold>
    <div className="flex flex-col items-center justify-center gap-4">
      {children}
    </div>
  </Scaffold>
);

export default AuthenticationLayout;
