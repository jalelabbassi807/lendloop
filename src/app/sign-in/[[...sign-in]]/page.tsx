import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="flex justify-center py-6">
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
