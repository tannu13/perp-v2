"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";
import { DEFAULT_MARKET } from "@/lib/markets";
import { Button, Field, Input, TextLink } from "@/components/ui";

/**
 * Sign in and sign up.
 *
 * One component for both because the only differences are a field, a verb and
 * a link — and because the error mapping is the hard part and should exist
 * once. Built entirely from existing atoms: `Field` already owns the label
 * binding, `aria-describedby` for hint and error, and `aria-invalid`, so none
 * of that is re-implemented here.
 *
 * The CTA is `primary` (blue). Green would read as a long — see the direction
 * rule in CLAUDE.md. Nothing on this screen has a market direction.
 */

export type AuthMode = "signin" | "signup";

/** Where to land when there is no `?next=`. */
const DEFAULT_DESTINATION = `/trade/${DEFAULT_MARKET.slug}`;

/**
 * Only ever redirect somewhere inside this app.
 *
 * `?next=https://evil.example.com` and `?next=//evil.example.com` are both
 * open-redirect attempts — the second is a protocol-relative URL that browsers
 * happily treat as off-site.
 */
export function safeDestination(next: string | null): string {
  if (!next) return DEFAULT_DESTINATION;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_DESTINATION;
  return next;
}

type FieldName = "username" | "password" | "name";

type FormErrors = Partial<Record<FieldName, string>> & { form?: string };

/**
 * Turns a failure into something a person can act on.
 *
 * Every branch produces words, never a code — a raw `RESOURCE_ALREADY_EXISTS`
 * on screen is a bug, not an error message.
 */
export function toFormErrors(error: unknown, mode: AuthMode): FormErrors {
  if (!(error instanceof ApiError)) {
    return { form: "Something went wrong. Please try again." };
  }

  if (error.code === "VALIDATION_FAILED" && error.fieldErrors) {
    const mapped: FormErrors = {};
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (field === "username" || field === "password" || field === "name") {
        mapped[field] = message;
      } else {
        mapped.form = message;
      }
    }
    return Object.keys(mapped).length ? mapped : { form: error.message };
  }

  if (error.code === "RESOURCE_ALREADY_EXISTS") {
    return { username: "That username is taken." };
  }

  if (error.isAuthFailure || error.code === "INVALID_REQUEST") {
    // The backend deliberately does not say which half was wrong, and neither
    // do we: naming the field would confirm that an account exists.
    return {
      form:
        mode === "signin"
          ? "Invalid username or password."
          : error.message || "Could not create your account.",
    };
  }

  if (error.isRetryable) {
    return { form: `${error.message} Please try again.` };
  }

  return { form: error.message };
}

export function CredentialsForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp } = useSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";
  const destination = useMemo(
    () => safeDestination(searchParams.get("next")),
    [searchParams],
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrors({});

    try {
      if (isSignup) {
        await signUp({ username, password, name });
      } else {
        await signIn({ username, password });
      }
      router.replace(destination);
    } catch (err) {
      setErrors(toFormErrors(err, mode));
      // Only stop the spinner on failure: on success the navigation is what
      // ends the interaction, and re-enabling the button first invites a second
      // submit against a session that already exists.
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {isSignup && (
        <Field label="Name" error={errors.name}>
          <Input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
      )}

      <Field label="Username" error={errors.username}>
        <Input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus={!isSignup}
        />
      </Field>

      <Field label="Password" error={errors.password}>
        <Input
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {/* Form-level failures — wrong credentials, an unreachable server. Live
          so a screen reader announces it when it appears, rather than leaving
          someone waiting on a button that silently stopped spinning. */}
      {errors.form && (
        <p
          role="alert"
          className={cn(
            "rounded-md border border-danger-500/40 bg-danger-500/10 px-3 py-2",
            "text-body-sm text-danger-400",
          )}
        >
          {errors.form}
        </p>
      )}

      <Button
        type="submit"
        intent="primary"
        size="lg"
        fullWidth
        loading={submitting}
      >
        {isSignup ? "Create account" : "Sign in"}
      </Button>

      <p className="text-center text-body-sm text-text-tertiary">
        {isSignup ? "Already have an account? " : "New here? "}
        {/* `inline`, not the default: a link inside running copy must carry a
            non-colour cue at rest. The atom already documents this variant —
            using the default here failed axe's link-in-text-block rule. */}
        <TextLink
          intent="inline"
          href={
            isSignup
              ? `/signin${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next")!)}` : ""}`
              : `/signup${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next")!)}` : ""}`
          }
        >
          {isSignup ? "Sign in" : "Create an account"}
        </TextLink>
      </p>
    </form>
  );
}
