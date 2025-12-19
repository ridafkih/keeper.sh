import { tv } from "tailwind-variants";

export const button = tv({
  base: "inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium no-underline cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900",
  variants: {
    variant: {
      primary:
        "bg-gray-900 border border-gray-900 text-white hover:bg-gray-700 hover:border-gray-700",
      secondary:
        "bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export const submitButton = tv({
  base: "w-full py-3 px-4 mt-2 border-none rounded-md text-base font-medium bg-gray-900 text-white cursor-pointer transition-colors duration-150 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed",
});

export const input = tv({
  base: "w-full py-2.5 px-3 border border-gray-300 rounded-md text-base transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-gray-900 focus:ring-3 focus:ring-black/10",
  variants: {
    readonly: {
      true: "bg-gray-50 text-gray-600",
    },
  },
});

export const label = tv({
  base: "block text-sm font-medium mb-1.5 text-gray-700",
});

export const navLink = tv({
  base: "flex items-center px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors",
  variants: {
    active: {
      true: "bg-gray-100 text-gray-900",
      false: "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
    },
  },
  defaultVariants: {
    active: false,
  },
});

export const sidebarLink = tv({
  base: "px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors pr-12",
  variants: {
    active: {
      true: "bg-gray-100 text-gray-900",
      false: "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
    },
  },
  defaultVariants: {
    active: false,
  },
});

export const link = tv({
  base: "text-gray-900 font-medium no-underline hover:underline",
});

export const brand = tv({
  base: "text-2xl font-bold text-gray-900 no-underline",
});

export const calendarScroll = tv({
  base: "overflow-x-auto",
  variants: {
    hideScrollbar: {
      true: "scrollbar-none",
    },
  },
});

export const calendarGrid = tv({
  base: "grid grid-cols-[repeat(var(--days),minmax(--spacing(24),1fr))] pl-12",
});

export const calendarRow = tv({
  base: "col-span-full grid grid-cols-subgrid relative before:absolute before:right-full before:w-12 before:pr-2 before:text-right before:text-xs before:text-gray-500 before:-translate-y-1/2",
  variants: {
    showTime: {
      true: "before:content-[attr(data-time)]",
    },
  },
});

export const calendarCell = tv({
  base: "min-h-12 border-l border-b border-gray-100 hover:bg-gray-50 transition-colors",
});

export const integrationCard = tv({
  base: "flex items-center gap-4 p-4 border border-gray-200 rounded-lg transition-colors hover:border-gray-300",
});

export const integrationIcon = tv({
  base: "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-white border border-gray-200",
});

export const integrationInfo = tv({
  base: "flex-1 min-w-0",
});

export const integrationName = tv({
  base: "text-sm font-medium text-gray-900",
});

export const integrationDescription = tv({
  base: "text-sm text-gray-500",
});

export const calendarEvent = tv({
  base: "absolute inset-x-0.5 rounded px-1.5 py-0.5 text-xs font-medium overflow-hidden truncate cursor-pointer transition-opacity hover:opacity-80",
  variants: {
    color: {
      blue: "bg-blue-100 text-blue-800 border-l-2 border-blue-500",
      green: "bg-green-100 text-green-800 border-l-2 border-green-500",
      purple: "bg-purple-100 text-purple-800 border-l-2 border-purple-500",
      orange: "bg-orange-100 text-orange-800 border-l-2 border-orange-500",
    },
  },
  defaultVariants: {
    color: "blue",
  },
});

export const agendaContainer = tv({
  base: "flex flex-col gap-6 max-w-2xl",
});

export const agendaDaySection = tv({
  base: "flex flex-col gap-2",
});

export const agendaDayHeading = tv({
  base: "text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2",
});

export const agendaEventList = tv({
  base: "flex flex-col list-none p-0 m-0",
});

export const agendaEventItem = tv({
  base: "flex items-center gap-2 py-1 text-sm text-gray-500",
});

export const agendaEventTime = tv({
  base: "tabular-nums text-gray-900 font-medium",
});

export const agendaEventDot = tv({
  base: "w-1.5 h-1.5 rounded-full shrink-0",
  variants: {
    color: {
      blue: "bg-blue-500",
      green: "bg-green-500",
      purple: "bg-purple-500",
      orange: "bg-orange-500",
    },
  },
  defaultVariants: {
    color: "blue",
  },
});

export const agendaEventSource = tv({
  base: "text-gray-900 font-medium",
});

export const agendaEmptyDay = tv({
  base: "text-sm text-gray-400 italic py-2",
});
