import type { FC, PropsWithChildren } from "react";
import KeeperSvg from "@/assets/keeper.svg";
import { ButtonLink } from "../components/button-link";
import Link from "next/link";
import { HeartIcon } from "lucide-react";
import { LinkOut } from "../components/link-out";
import { Copy } from "../components/copy";
import { Scaffold } from "../components/scaffold";

const LandingLayout: FC<PropsWithChildren> = ({ children }) => (
  <Scaffold>
    <div className="pt-8 pb-16 flex flex-col gap-8">
      <header className="flex justify-between items-center">
        <Link href="/playground">
          <KeeperSvg className="size-4" />
        </Link>
        <div className="flex items-center gap-1">
          <ButtonLink href="/playground/login" variant="ghost" size="small">
            Sign in
          </ButtonLink>
          <ButtonLink href="/playground/register" variant="primary" size="small">
            Register
          </ButtonLink>
        </div>
      </header>
      {children}
      <footer className="flex flex-col gap-1">
        <div className="flex gap-2">
          <LinkOut variant="inline-subtle" size="small" href="/playground/privacy">
            Privacy Policy
          </LinkOut>
          <LinkOut variant="inline-subtle" size="small" href="/playground/terms">
            Terms &amp; Conditions
          </LinkOut>
        </div>
        <Copy className="text-xs text-neutral-400">
          Keeper is a Canadian project made with{" "}
          <HeartIcon className="size-3 -mt-1 inline fill-neutral-500 text-neutral-500" /> by{" "}
          <LinkOut variant="inline-subtle" size="small" href="https://rida.dev/" target="_blank">
            Rida F&apos;kih
          </LinkOut>
        </Copy>
      </footer>
    </div>
  </Scaffold>
);

export default LandingLayout;
