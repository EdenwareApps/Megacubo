import { expect, test } from '@playwright/test';

// Note: `docusaurus start` (dev mode) only compiles and serves the default locale (English).
// This is documented Docusaurus behaviour. Non-default locale paths (e.g. /pt-BR/) still respond
// with 200 but use the default-locale HTML shell (lang="en").
// Full locale correctness (lang attribute, translated content) is verified by the static-build
// suite (i18n.spec.ts). These dev tests focus on route availability and navigation regressions.

test.describe('Docusaurus i18n behavior (dev server)', () => {
  async function gotoAndAssertPageLoads(page, path) {
    await page.goto(path);
    await expect(page.locator('body')).not.toContainText('Page Not Found');
    await expect(page.locator('body')).not.toContainText('We could not find what you were looking for.');
    // Docusaurus renders a nav element on every valid page
    await expect(page.locator('nav').first()).toBeVisible();
  }

  test('English root works in dev mode', async ({ page }) => {
    await gotoAndAssertPageLoads(page, '/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('body')).toContainText('Cross-platform IPTV player documentation');
  });

  test('Portuguese root route is available in dev mode', async ({ page }) => {
    // Validates the route /pt-BR/ does not return a 404 / "Page Not Found" page.
    // Content and lang attribute are tested via the static-build suite.
    await gotoAndAssertPageLoads(page, '/pt-BR/');
  });

  test('Portuguese docs route is available in dev mode', async ({ page }) => {
    // Validates the route /pt-BR/docs/introduction does not return 404.
    await gotoAndAssertPageLoads(page, '/pt-BR/docs/introduction');
    // A heading must exist (may be English in dev mode)
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('Locale switcher navigates to pt-BR in dev mode', async ({ page }) => {
    await gotoAndAssertPageLoads(page, '/');

    const localeToggle = page.getByRole('button', { name: 'English' }).first();
    await expect(localeToggle).toBeVisible();
    await localeToggle.click();

    const portugueseLink = page.getByRole('link', { name: 'Português' }).first();
    await expect(portugueseLink).toBeVisible();
    await portugueseLink.click();

    await expect(page).toHaveURL(/\/pt-BR\//);
    await expect(page.locator('body')).not.toContainText('Page Not Found');
    await expect(page.locator('body')).not.toContainText('We could not find what you were looking for.');
  });
});
