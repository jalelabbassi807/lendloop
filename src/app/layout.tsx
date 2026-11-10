import type { Metadata } from "next";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Geist } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <ClerkProvider>
          <ConvexClientProvider>
            <header className="border-b border-stone-200 bg-white">
              <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                  <span className="grid size-7 place-items-center rounded-full bg-emerald-600 text-sm text-white">L</span>
                  LendLoop
                </Link>
                <Suspense>
                  <Show when="signed-out">
                    <SignInButton mode="modal">
                      <button className="btn-primary">Sign in</button>
                    </SignInButton>
                  </Show>
                  <Show when="signed-in">
                    <div className="flex items-center gap-4">
                      <Link href="/app" className="text-sm font-medium text-stone-700 hover:text-stone-900">
                        Dashboard
                      </Link>
                      <UserButton />
                    </div>
                  </Show>
                </Suspense>
              </div>
            </header>
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
