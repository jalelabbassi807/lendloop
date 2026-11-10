import { PublicToolList } from "@/components/PublicToolList";
import { SignInCta } from "@/components/SignInCta";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="rounded-xl bg-emerald-700 px-6 py-12 text-white sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mt-3 max-w-xl text-emerald-100">
          Someone on your street probably has the ladder you need for one afternoon. Find it here, and lend out the things sitting in your own garage.
        </p>
        <div className="mt-6">
          <SignInCta />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Available right now</h2>
        <div className="mt-4">
          <PublicToolList />
        </div>
      </section>
    </div>
  );
}
