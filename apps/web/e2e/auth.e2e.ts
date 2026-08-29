import { expect, test } from "@playwright/test";

/**
 * Phase 5's gate: the first end-to-end user flow.
 *
 * A stranger creates an account in the browser, lands on the terminal as a real
 * engine-known user, survives a reload, and signs out.
 *
 * Requires the backend stack to be running. See docs/RUNBOOK.md.
 */

const password = "pw123456";
const uniqueUsername = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("sign up, stay signed in across a reload, then sign out", async ({
  page,
}) => {
  const username = uniqueUsername();

  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("E2E Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Lands on the terminal.
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  await expect(page.getByRole("button", { name: /deposit/i })).toBeVisible();

  // The session is a cookie, so it survives a full reload — this is the whole
  // point of Phase 4 and the reason this assertion exists.
  await page.reload();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  await expect(page.getByRole("button", { name: /deposit/i })).toBeVisible();

  // The token must never be reachable from page JavaScript. The cookie is
  // httpOnly AND scoped to the API host, so it is doubly invisible here.
  const visibleCookies = await page.evaluate(() => document.cookie);
  expect(visibleCookies).not.toContain("perp_session");

  // It does exist though — on the API origin, httpOnly.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "perp_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();

  // Signing out leaves the account surface rather than stranding the user on a
  // page they can no longer load.
  await expect(page).toHaveURL(/localhost:3020\/$/);

  // And the terminal is no longer reachable.
  await page.goto("/trade/SOL-USD");
  await expect(page).toHaveURL(/\/signin/);
});

test("signing in returns you to where you were headed", async ({ page }) => {
  const username = uniqueUsername();

  // Make an account first, then drop the session.
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("E2E Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  await page.context().clearCookies();

  // Aim at a specific market while signed out.
  await page.goto("/trade/ETH-USD");
  await expect(page).toHaveURL(/\/signin\?next=/);

  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Back to the market that was asked for, not the default one.
  await expect(page).toHaveURL(/\/trade\/ETH-USD/);
});

test("a wrong password is reported without naming the field", async ({
  page,
}) => {
  await page.goto("/signin");
  await page
    .getByLabel("Username", { exact: true })
    .fill("definitely-not-real");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Scoped to the form: Next injects its own empty `role="alert"` route
  // announcer into every page, so an unscoped role query is ambiguous.
  await expect(page.locator('form [role="alert"]')).toHaveText(
    "Invalid username or password.",
  );
  await expect(page).toHaveURL(/\/signin/);
});

test("the landing page stays public", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: /sign in/i }).first(),
  ).toBeVisible();
});
