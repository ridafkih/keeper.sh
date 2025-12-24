import { Header } from "@/components/header";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="flex flex-col items-center max-w-3xl mx-auto px-4 pt-24 pb-8 w-full">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-center text-4xl tracking-tighter leading-normal mx-auto">
            Simple and open-source calendar syncing
          </h1>
          <p className="text-center leading-loose max-w-[42ch]">
            Continuously sync and aggregate anonymized events from a collection
            of calendars into one.
          </p>
        </div>
      </main>
    </>
  );
}
