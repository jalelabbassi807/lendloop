"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

const style = "inline-block rounded-md bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50";

export function SignInCta() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) {
    return <Link href="/app" className={style}>Go to your dashboard</Link>;
  }
  return (
    <SignInButton mode="modal" forceRedirectUrl="/app">
      <button className={style}>Sign in to lend or borrow</button>
    </SignInButton>
  );
}
