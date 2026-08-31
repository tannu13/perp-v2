import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility of the two new routes.
 *
 * The design system's atoms were audited when they were built; these are new
 * compositions of them, and a composition can break what its parts got right —
 * a label that no longer points at its input, contrast lost against a new
 * surface, an error announced to nobody.
 */
/**
 * One historical exception, kept as a guard rather than as an allowance.
 *
 * White on the old `--color-interactive` (#2e7cf6) was 3.94:1 against the 4.5:1
 * AA asks for on normal text — the brand blue behind every primary button in
 * the product, failing on 10 nodes on the landing page and 29 on
 * `/design-system/components`. D7 took the token decision and
 * `--color-primary-500` is **#2a72e0** now, which is 4.58:1 and passes, so this
 * list is expected to filter nothing: the specs below pass because axe reports
 * no contrast violation at all, not because one is being ignored.
 *
 * It stays because the second test pins the only pair that may fail, and any
 * OTHER failing pair — a label, a hint, an error message — is ours and fails.
 */
const KNOWN_EXCEPTIONS = ["color-contrast"];

for (const path of ["/signin", "/signup"]) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const unexpected = results.violations.filter(
      (v) => !KNOWN_EXCEPTIONS.includes(v.id),
    );
    expect(unexpected.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test(`${path} has no contrast failure of its own making`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aa"])
      .analyze();

    const contrast = results.violations.find((v) => v.id === "color-contrast");

    /**
     * Only the known token pair may fail: white on the interactive blue.
     *
     * Pinned to the colour pair rather than to a selector or markup, because
     * axe truncates `html` and picks `.inline-flex` as the Button's selector.
     * Any OTHER failing pair — a label, a hint, an error message — is ours and
     * fails this test.
     */
    const pairs = (contrast?.nodes ?? []).map((node) => {
      const data = node.any[0]?.data as
        | { fgColor?: string; bgColor?: string }
        | undefined;
      return `${data?.fgColor} on ${data?.bgColor}`;
    });

    for (const pair of pairs) {
      // The current token, not the one D7 replaced. If this ever fires it
      // means the blue regressed, which is worth failing over.
      expect(pair).toBe("#ffffff on #2a72e0");
    }
  });
}

test("a form error is announced and bound to its field", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("A");
  await page.getByLabel("Username", { exact: true }).fill("");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await page.getByRole("button", { name: "Create account" }).click();

  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toHaveAttribute("aria-invalid", "true");
  // Field owns the wiring; this asserts it survived the composition.
  await expect(username).toHaveAttribute("aria-describedby", /.+/);
});

/**
 * The terminal, signed in — the compositions Phase 14 audits.
 *
 * The atoms were audited when they were built and the two auth routes above
 * have been audited since Phase 5. The trading screen never has been, and it is
 * where every new composition lives: five tabbed tables, a ladder built out of
 * buttons, a status dot whose only content is a colour, a docked ticket and two
 * dialogs.
 *
 * It needs an account, so it costs a signup — there is no anonymous view of
 * this route (`RequireSession` bounces one to /signin).
 */
const PASSWORD = "pw123456";

async function signedInTrader(page: import("@playwright/test").Page) {
  const username = `e2e-a11y-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
}

test("the trading terminal has no accessibility violations", async ({
  page,
}) => {
  await signedInTrader(page);
  // The ladder and the tables have to have arrived: auditing a screen full of
  // skeletons audits the skeletons.
  await expect(page.getByRole("tab", { name: /positions/i })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const unexpected = results.violations.filter(
    (v) => !KNOWN_EXCEPTIONS.includes(v.id),
  );
  expect(unexpected.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("every account tab keeps its panel wired to its trigger", async ({
  page,
}) => {
  await signedInTrader(page);

  for (const name of [
    /positions/i,
    /open orders/i,
    /fill history/i,
    /balances/i,
    /order history/i,
  ]) {
    const tab = page.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");

    // Radix supplies the pairing; this asserts the composition did not break
    // it — a panel that is not named by its tab is a table a screen-reader
    // user lands in with no idea which one it is.
    const panelId = await tab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute("aria-labelledby", /.+/);
  }
});

test("the private channel's state is readable without seeing the dot", async ({
  page,
}) => {
  await signedInTrader(page);

  /**
   * D17's indicator. A bare coloured dot conveys nothing, so `StatusDot`
   * carries an sr-only sentence — and the sentence, not the colour, is what
   * says whether the tables behind it are current. Matched loosely on the
   * prefix because the state itself depends on whether ws-server is up, which
   * is not what this spec is about.
   */
  await expect(page.getByText(/^Account feed:/).first()).toBeAttached();
});
