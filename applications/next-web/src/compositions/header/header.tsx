import Link from "next/link"
import { LinkButton } from "@/components/button"
import { StaggeredBackdropBlur } from "@/compositions/header/components/staggered-backdrop-blur"
import { GithubStarButton } from "@/compositions/header/components/github-star-button"
import KeeperLogo from "@/assets/keeper.svg"
import KeeperLogoDark from "@/assets/keeper-dark-mode.svg"

export const Header = () => {
  return (
    <div className="w-full sticky top-0 z-50 pt-4">
      <StaggeredBackdropBlur />
      <div className="px-4 md:px-8 relative z-10">
        <header className="max-w-3xl mx-auto py-3 px-4 flex items-center justify-between">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <KeeperLogo className="w-6 h-6 text-foreground dark:hidden" />
            <KeeperLogoDark className="w-6 h-6 text-foreground hidden dark:block" />
          </Link>
          <nav className="flex items-center gap-2">
            <GithubStarButton />
            <LinkButton href="/login" variant="border" size="compact">
              Login
            </LinkButton>
            <LinkButton href="/register" variant="primary" size="compact">
              Register
            </LinkButton>
          </nav>
        </header>
      </div>
    </div>
  )
}
