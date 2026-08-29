import { expect, test } from "@playwright/test";

/**
 * Phase 6's gate.
 *
 * Four surfaces used to hold four different hardcoded balances. A deposit must
 * now move all of them, from one request, with no page reload.
 */

const password = "pw123456";

async function signUp(page: import("@playwright/test").Page) {
  const username = `e2e-dep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Depositor");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  return username;
}

test("a new account starts empty, and a deposit moves every surface", async ({
  page,
}) => {
  await signUp(page);

  // Signing up initialises the engine user with zero collateral.
  const equity = page.locator("header").getByText("$0.00").first();
  await expect(equity).toBeVisible();

  // The order ticket agrees.
  await expect(page.getByText("Available").first()).toBeVisible();

  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("500");
  await page.getByRole("button", { name: /^Deposit \$500/ }).click();

  // Dialog closes on success.
  await expect(page.getByRole("dialog")).toBeHidden();

  // 1. Header equity — no reload anywhere in this test.
  await expect(page.locator("header").getByText("$500.00")).toBeVisible();

  // 2. The order ticket's buying power.
  await expect(page.getByText("$500.00").nth(1)).toBeVisible();

  // 3. The account menu's margin Seam.
  await page.getByRole("button", { name: /account menu/i }).click();
  await expect(page.getByText(/Free \$500\.00/)).toBeVisible();
  await expect(page.getByText(/Used \$0\.00/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 4. The Balances tab: one USD row, three real numbers.
  await page.getByRole("tab", { name: /balances/i }).click();
  const row = page.getByRole("row").filter({ hasText: "USD" });
  await expect(row).toContainText("500");

  // Multi-collateral is out of scope: the six invented assets are gone.
  await expect(page.getByRole("cell", { name: "JUP" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "PYTH" })).toHaveCount(0);
});

test("a rejected deposit keeps the dialog open with the amount intact", async ({
  page,
}) => {
  await signUp(page);

  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  const amount = page.getByLabel("Amount", { exact: true });
  await amount.fill("250");

  // Force a server-side failure rather than typing something the client would
  // reject first. The path is the backend's own — there is no proxy any more,
  // so this intercepts `http://localhost:3001/onramp` directly.
  await page.route("**/onramp", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INVALID_REQUEST",
        message: "Deposit limit exceeded",
      }),
    }),
  );

  await page.getByRole("button", { name: /^Deposit \$250/ }).click();

  // Still open, still holding what was typed, and saying why.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(amount).toHaveValue("250");
  await expect(page.getByText("Deposit limit exceeded")).toBeVisible();
});
