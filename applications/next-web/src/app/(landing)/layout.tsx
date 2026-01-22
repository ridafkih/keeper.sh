import type { FC, PropsWithChildren } from "react";

const LandingLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <main>
      {children}
    </main>
  )
}

export default LandingLayout;
