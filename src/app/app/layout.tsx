import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { Loading } from "@/components/ui";

async function RequireSignIn({ children }: { children: React.ReactNode }) {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  return <>{children}</>;
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<Loading />}>
      <RequireSignIn>{children}</RequireSignIn>
    </Suspense>
  );
}
