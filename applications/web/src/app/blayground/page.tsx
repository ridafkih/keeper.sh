"use client"

import { LayoutGroup, motion } from "motion/react";
import { useState, type ButtonHTMLAttributes, type ComponentProps, type DetailedHTMLProps, type FC, type FormEvent, type HTMLAttributes, type HTMLProps, type InputHTMLAttributes, type PropsWithChildren } from "react"
import { cn } from "../playground/utils/cn"
import Link from "next/link"
import { tv } from "tailwind-variants"
import { ArrowLeft, LoaderCircle } from "lucide-react"
import Image from "next/image"
import { Lora } from "next/font/google"
import { AnimatePresence } from "motion/react"

const button = tv({
  base: `
    flex gap-1.5 items-center justify-center rounded-xl w-fit text-sm font-medium text-nowrap select-none
    tracking-tighter border border-transparent shadow-xs
    enabled:hover:cursor-pointer
    focus-visible:outline-2 outline-offset-1 outline-blue-500
    disabled:opacity-75 disabled:brightness-100 disabled:backdrop-brightness-unset disabled:cursor-not-allowed
  `,
  variants: {
    variant: {
      primary: "bg-neutral-950 text-white hover:brightness-90 active:brightness-80",
      secondary: "backdrop-brightness-95 hover:backdrop-brightness-90 active:backdrop-brightness-85 shadow-none",
      border: "border-neutral-200 hover:backdrop-brightness-95 active:backdrop-brightness-90",
      ghost: "hover:backdrop-brightness-95 active:backdrop-brightness-90 shadow-none"
    },
    size: {
      normal: "px-4 py-2.5",
      compact: "px-3 py-1.5"
    },
  },
  defaultVariants: {
    size: "normal",
    variant: "primary",
  }
})

type WithButtonProps<ComponentProperties> = ComponentProperties & {
  variant?: keyof typeof button["variants"]["variant"];
  size?: keyof typeof button["variants"]["size"];
}

export const Button: FC<WithButtonProps<DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>>> = ({ className, variant, size, ...props }) => {
  return (
    <button {...props} className={cn(button({ variant, size }), className)}></button>
  )
}

export const LinkButton: FC<WithButtonProps<ComponentProps<typeof Link>>> = ({ className, variant, size, ...props }) => {
  return (
    <Link {...props} className={cn(button({ variant, size }), className)}></Link>
  )
}

export const Input: FC<WithButtonProps<DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>>> = ({ className, variant, size, ...props }) => {
  return (
    <input {...props} className={cn("px-4 py-2.5 border-neutral-200 rounded-xl border tracking-tight shadow-xs bg-white focus-visible:outline-2 outline-offset-1 outline-blue-500 disabled:opacity-50 disabled:cursor-not-allowed", className)}></input>
  )
}

export const FlexRowGroup: FC<PropsWithChildren<DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>>> = ({ children, className, ...props }) => {
  return (
    <div {...props} className={cn("flex items-center", className)}>
      {children}
    </div>
  )
}

export const FlexColumnGroup: FC<PropsWithChildren<DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>>> = ({ children, className, ...props }) => {
  return (
    <div {...props} className={cn("flex flex-col", className)}>
      {children}
    </div>
  )
}

export const Divider = () => {
  return (
    <div className="w-full h-px my-2 bg-[repeating-linear-gradient(to_right,transparent,transparent_4px,var(--color-neutral-300)_4px,var(--color-neutral-300)_calc(4px*2),transparent_calc(4px*2))]" />
  )
}

const headingFont = Lora()

export const Heading1: FC<HTMLProps<HTMLHeadingElement>> = ({ className, children, ...props }) => {
  return (
    <h1 {...props} className={cn(headingFont.className, "text-3xl tracking-tighter font-medium", className)}>{children}</h1>
  )
}

export const Copy: FC<HTMLProps<HTMLParagraphElement>> = ({ className, children, ...props }) => {
  return (
    <p {...props} className={cn("tracking-tight leading-relaxed text-sm text-neutral-600", className)}>{children}</p>
  )
}

export const MicroCopy: FC<HTMLProps<HTMLParagraphElement>> = ({ className, children, ...props }) => {
  return (
    <p {...props} className={cn("text-xs tracking-tight leading-relaxed text-neutral-600", className)}>{children}</p>
  )
}

export const InlineLink: FC<WithButtonProps<ComponentProps<typeof Link>>> = ({ className, children, ...props }) => {
  return (
    <Link {...props} className={cn("inline underline text-blue-600", className)}>{children}</Link>
  )
}

export default function Blayground() {
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
  }

  return (
    <main className="flex size-full items-center justify-center min-h-screen bg-neutral-50">
      <div className="w-full max-w-xs">
        <FlexColumnGroup className="gap-2">
          <FlexColumnGroup className="py-2 items-center text-center">
            <Heading1>Welcome back</Heading1>
            <Copy>Sign in to your Keeper account to continue</Copy>
          </FlexColumnGroup>
          <LinkButton href="/auth/google" className="w-full" variant="border">
            <Image alt="Google icon" width={17} height={17} src="/integrations/icon-google.svg" />
            Sign in with Google
          </LinkButton>
          <LinkButton href="/auth/outlook" className="w-full" variant="border">
            <Image alt="Outlook icon" width={17} height={17} src="/integrations/icon-outlook.svg" />
            Sign in with Outlook
          </LinkButton>
          <FlexRowGroup>
            <Divider />
            <span className="text-xs px-2 text-neutral-400">or</span>
            <Divider />
          </FlexRowGroup>
          <form onSubmit={handleSubmit} className="contents">
            <Input type="email" placeholder="johndoe+keeper@example.com" />
            <FlexRowGroup className="items-stretch">
              <LayoutGroup>
                <AnimatePresence>
                  {!loading && (
                    <motion.div transition={{ width: { duration: 0.24 }, opacity: { duration: 0.12 } }} exit={{ width: 0, opacity: 0, filter: 'blur(0.125rem)' }}>
                      <LinkButton href="/playground" className="h-full px-3.5 mr-2" variant="border">
                        <ArrowLeft size={17} />
                      </LinkButton>
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.div className="grow">
                  <Button disabled={loading} type="submit" className="relative w-full" variant="primary" size="normal">
                    <motion.span className="origin-top" transition={{ duration: 0.16 }} animate={{ opacity: loading ? 0 : 1, filter: loading ? 'blur(0.125rem)' : 'none', y: loading ? -2 : 0, scale: loading ? 0.75 : 1 }}>
                      Sign in
                    </motion.span>
                    <motion.span transition={{ delay: 0.08, duration: 0.16 }} className="absolute inset-0 m-auto size-fit origin-bottom" initial={{ opacity: 0 }} animate={{ opacity: loading ? 1 : 0, filter: loading ? 'none' : 'blur(0.125rem)', y: loading ? 0 : 2, scale: loading ? 1 : 0.75 }}>
                      <LoaderCircle className="animate-spin" size={17} />
                    </motion.span>
                  </Button>
                </motion.div>
              </LayoutGroup>
            </FlexRowGroup>
          </form>
          <MicroCopy className="text-center">
            <span>No account yet? </span>
            <InlineLink href="/blayground/register">Register</InlineLink>
          </MicroCopy>
        </FlexColumnGroup>
      </div>
    </main>
  )
}
