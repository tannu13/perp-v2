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
 * One known, pre-existing exception.
 *
 * White on `--color-interactive` (#2e7cf6) is 3.94:1 against the 4.5:1 that AA
 * asks for on normal text. That is the brand blue behind every primary button
 * in the product — the landing page fails on 10 nodes and
 * `/design-system/components` on 29, both of which predate these screens. It is
 * a token decision, not a decision these forms get to make, so it is excluded
 * here rather than silently worked around: see decision D7 in
 * UI_BACKEND_INTEGRATION_PLAN.md. #2a72e0 is the smallest change that passes.
 *
 * Everything else must be clean, and any NEW violation still fails this test.
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
      expect(pair).toBe("#ffffff on #2e7cf6");
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
