"use client";

import Link from "next/link"
import { Fragment } from "react/jsx-runtime"
import { motion } from "motion/react";

import { BoltIcon, CalendarsIcon, CalendarSyncIcon, HomeIcon, ReceiptIcon } from "lucide-react"
import { FC, PropsWithChildren, useEffect, useState } from "react";
import { useParams } from "next/navigation";

const getHash = () => {
  if (typeof window !== 'undefined') {
    return decodeURIComponent(window.location.hash.replace("#", ""))
  }

  return '';
}

const useHash = () => {
  const [hash, setHash] = useState<string>(getHash());

  const params = useParams();

  useEffect(() => {
    setHash(getHash());
  }, [params])

  return { hash };
}

type IndicatorOptions = {
  attributedHash: string;
}

const Indicator: FC<PropsWithChildren<IndicatorOptions>> = ({ attributedHash }) => {
  const { hash } = useHash();

  if (hash !== attributedHash) return null;

  return (
    <motion.div
      layout
      layoutId="indicator"
      transition={{ duration: 0.16, ease: [0.5, 0, 0, 1] }}
      initial={false}
      className="absolute inset-0 size-full rounded-full z-10 bg-neutral-800 border-y border-y-neutral-500"
    />
  )
}

export default function Playground() {
  return (
    <div className="w-full grow grid grid-cols-[minmax(2rem,1fr)_32rem_minmax(2rem,1fr)] *:col-start-2 bg-neutral-50 dark:bg-neutral-950">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="py-12 text-center">
            <h1 className="text-4xl font-semibold leading-tight -tracking-[0.0625em]">All of your calendars in-sync.</h1>
            <p className="text-neutral-800">Keeper connects to all of your calendar accounts, and syncs the events between them. Released open-source under AGPL-3.0.</p>
          </div>
          <div className="flex gap-1">
            <button className="tracking-tighter font-medium rounded-md border bg-neutral-800 text-white border-neutral-900 w-fit px-3 py-2 text-sm hover:cursor-pointer hover:brightness-110">Get Started</button>
            <button className="tracking-tighter font-medium rounded-md border border-neutral-300 w-fit px-3 py-2 text-sm hover:cursor-pointer hover:bg-neutral-100">View GitHub</button>
            <button className="tracking-tighter font-medium rounded-md border border-transparent w-fit px-3 py-2 text-sm hover:cursor-pointer hover:bg-neutral-100">Get Started</button>
          </div>
        </div>
        <nav className="fixed left-0 right-0 mx-auto bottom-8 p-1.5 rounded-full bg-neutral-950 w-fit text-neutral-300">
          <ul className="flex items-center">
            <li>
              <Link draggable={false} className="relative hover:text-neutral-50 p-2 flex rounded-full" href="#home">
                <HomeIcon className="z-20" size={20} strokeWidth={1.5} />
                <Indicator attributedHash="home" />
              </Link>
            </li>
            <li>
              <Link  className="relative hover:text-neutral-50 p-2 flex rounded-full" href="#calendars">
                <CalendarsIcon className="z-20" size={20} strokeWidth={1.5} />
                <Indicator attributedHash="calendars" />
              </Link>
            </li>
            <li>
              <Link draggable={false} className="relative hover:text-neutral-50 p-2 flex rounded-full" href="#sync">
                <CalendarSyncIcon className="z-20" size={20} strokeWidth={1.5} />
                <Indicator attributedHash="sync" />
              </Link>
            </li>
            <li>
              <Link draggable={false} className="relative hover:text-neutral-50 p-2 flex rounded-full" href="#billing">
                <ReceiptIcon className="z-20" size={20} strokeWidth={1.5} />
                <Indicator attributedHash="billing" />
              </Link>
            </li>
            <li>
              <Link draggable={false} className="relative hover:text-neutral-50 p-2 flex rounded-full" href="#settings">
                <BoltIcon className="z-20" size={20} strokeWidth={1.5} />
                <Indicator attributedHash="settings" />
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  )
}
