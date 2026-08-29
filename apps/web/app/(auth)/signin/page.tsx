import { Suspense } from "react";
import type { Metadata } from "next";
import { CredentialsForm } from "../_components/credentials-form";

export const metadata: Metadata = { title: "Sign in — Perp" };

export default function SignInPage() {
  return (
    <>
      <h1 className="mb-1 text-heading-sm text-text-primary">Sign in</h1>
      <p className="mb-5 text-body-sm text-text-tertiary">
        Trade perpetual futures on a live matching engine.
      </p>
      {/* `useSearchParams` needs a boundary — without one the whole route opts
          out of static rendering. */}
      <Suspense fallback={null}>
        <CredentialsForm mode="signin" />
      </Suspense>
    </>
  );
}
