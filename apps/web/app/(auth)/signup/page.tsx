import { Suspense } from "react";
import type { Metadata } from "next";
import { CredentialsForm } from "../_components/credentials-form";

export const metadata: Metadata = { title: "Create account — Perp" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-heading-sm text-text-primary">Create account</h1>
      <p className="mb-5 text-body-sm text-text-tertiary">
        Your account starts with no collateral — deposit once you are in.
      </p>
      <Suspense fallback={null}>
        <CredentialsForm mode="signup" />
      </Suspense>
    </>
  );
}
