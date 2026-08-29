import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/errors";
import { safeDestination, toFormErrors } from "./credentials-form";

/**
 * The auth forms.
 *
 * Two things are worth pinning here: that every failure becomes words a person
 * can act on (never a raw code), and that `?next=` cannot be used to bounce
 * someone off-site.
 */

const replaced: string[] = [];
let nextParam: string | null = null;

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: (href: string) => replaced.push(href),
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(nextParam ? { next: nextParam } : {}),
}));

let signInImpl: (input: unknown) => Promise<void> = async () => undefined;
let signUpImpl: (input: unknown) => Promise<void> = async () => undefined;

mock.module("@/lib/auth/session-provider", () => ({
  useSession: () => ({
    status: "anon",
    identity: null,
    signIn: (input: unknown) => signInImpl(input),
    signUp: (input: unknown) => signUpImpl(input),
    signOut: async () => undefined,
  }),
}));

const { CredentialsForm } = await import("./credentials-form");

afterEach(() => {
  replaced.length = 0;
  nextParam = null;
  signInImpl = async () => undefined;
  signUpImpl = async () => undefined;
});

/** Exact labels: `/name/i` would also match "Username". */
const fill = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
};

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /sign in|create account/i }));

describe("safeDestination", () => {
  it("defaults to the terminal", () => {
    expect(safeDestination(null)).toBe("/trade/SOL-USD");
  });

  it("keeps an in-app path", () => {
    expect(safeDestination("/trade/BTC-USD?x=1")).toBe("/trade/BTC-USD?x=1");
  });

  it("refuses an absolute URL", () => {
    expect(safeDestination("https://evil.example.com")).toBe("/trade/SOL-USD");
  });

  it("refuses a protocol-relative URL", () => {
    // Browsers treat `//host` as off-site; this is the open-redirect that gets
    // missed when the check is only `startsWith("/")`.
    expect(safeDestination("//evil.example.com")).toBe("/trade/SOL-USD");
  });
});

describe("toFormErrors", () => {
  it("puts zod field errors on their own fields", () => {
    const err = new ApiError({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Invalid body",
      fieldErrors: { username: "Too small", password: "Too small" },
    });
    expect(toFormErrors(err, "signup")).toEqual({
      username: "Too small",
      password: "Too small",
    });
  });

  it("puts a taken username on the username field only", () => {
    const err = new ApiError({
      status: 409,
      code: "RESOURCE_ALREADY_EXISTS",
      message: "Resource already exists",
    });
    expect(toFormErrors(err, "signup")).toEqual({
      username: "That username is taken.",
    });
  });

  it("keeps a failed sign-in vague about which half was wrong", () => {
    const err = new ApiError({
      status: 400,
      code: "INVALID_REQUEST",
      message: "Invalid Credentials",
    });
    // Naming the field would confirm that an account exists.
    expect(toFormErrors(err, "signin")).toEqual({
      form: "Invalid username or password.",
    });
  });

  it("never renders a raw code", () => {
    for (const code of [
      "ENGINE_TIMEOUT",
      "NETWORK",
      "UNKNOWN",
      "RESOURCE_ALREADY_EXISTS",
      "INVALID_REQUEST",
    ]) {
      const result = toFormErrors(
        new ApiError({ status: 500, code, message: "Something specific." }),
        "signin",
      );
      const text = Object.values(result).join(" ");
      expect(text).not.toContain(code);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("handles a non-ApiError without leaking the exception", () => {
    expect(toFormErrors(new TypeError("undefined is not a function"), "signin"))
      .toEqual({ form: "Something went wrong. Please try again." });
  });
});

describe("<CredentialsForm />", () => {
  it("signs in and navigates to the default destination", async () => {
    const seen: unknown[] = [];
    signInImpl = async (input) => {
      seen.push(input);
    };

    render(<CredentialsForm mode="signin" />);
    fill("Username", "alice");
    fill("Password", "pw123456");
    submit();

    await waitFor(() => expect(replaced).toEqual(["/trade/SOL-USD"]));
    expect(seen).toEqual([{ username: "alice", password: "pw123456" }]);
  });

  it("returns to ?next= after signing in", async () => {
    nextParam = "/trade/ETH-USD";
    render(<CredentialsForm mode="signin" />);
    fill("Username", "alice");
    fill("Password", "pw123456");
    submit();

    await waitFor(() => expect(replaced).toEqual(["/trade/ETH-USD"]));
  });

  it("sends the name field on sign up", async () => {
    const seen: unknown[] = [];
    signUpImpl = async (input) => {
      seen.push(input);
    };

    render(<CredentialsForm mode="signup" />);
    fill("Name", "Alice");
    fill("Username", "alice");
    fill("Password", "pw123456");
    submit();

    await waitFor(() =>
      expect(seen).toEqual([
        { username: "alice", password: "pw123456", name: "Alice" },
      ]),
    );
  });

  it("shows a server field error against its own input", async () => {
    signUpImpl = async () => {
      throw new ApiError({
        status: 409,
        code: "RESOURCE_ALREADY_EXISTS",
        message: "Resource already exists",
      });
    };

    render(<CredentialsForm mode="signup" />);
    fill("Name", "Alice");
    fill("Username", "taken");
    fill("Password", "pw123456");
    submit();

    await waitFor(() =>
      expect(screen.getByText("That username is taken.")).toBeInTheDocument(),
    );
    // Field wires this itself; the form must not re-implement it.
    expect(screen.getByLabelText("Username", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(replaced).toEqual([]);
  });

  it("announces a form-level failure", async () => {
    signInImpl = async () => {
      throw new ApiError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Invalid Credentials",
      });
    };

    render(<CredentialsForm mode="signin" />);
    fill("Username", "alice");
    fill("Password", "wrong");
    submit();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Invalid username or password.",
      ),
    );
  });

  it("disables the button while the request is in flight", async () => {
    let release: () => void = () => undefined;
    signInImpl = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    render(<CredentialsForm mode="signin" />);
    fill("Username", "alice");
    fill("Password", "pw123456");
    submit();

    const button = screen.getByRole("button", { name: /sign in/i });
    await waitFor(() => expect(button).toBeDisabled());

    // A second click while in flight must not produce a second request.
    fireEvent.click(button);
    release();
    await waitFor(() => expect(replaced).toHaveLength(1));
  });
});
