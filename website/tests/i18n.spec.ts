import { expect, test } from '@playwright/test';

test.describe('Docusaurus i18n behavior', () => {
  let pageErrors = [];
  let browserErrors = [];
  let failedRequests = [];
  let failedResponses = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    browserErrors = [];
    failedRequests = [];
    failedResponses = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
      console.log('PAGE ERROR', error.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        browserErrors.push(text);
        console.log('BROWSER ERROR', text);
      }
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure();
      const failureText = failure?.errorText ?? failure?.errorCode ?? 'unknown';
      failedRequests.push({ url: request.url(), failure: failureText });
      console.log('REQUEST FAILED', request.url(), failureText);
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        const url = response.url();
        failedResponses.push({ status: response.status(), url, method: response.request().method() });
        console.log('HTTP ERROR', response.status(), response.request().method(), url);
      }
    });
  });

  async function navigateAndLog(page, path) {
    const basePathPrefix = '/Megacubo';
    const normalizedPath = path === '/'
      ? `${basePathPrefix}/`
      : path.startsWith('/')
        ? `${basePathPrefix}${path}`
        : `${basePathPrefix}/${path}`;
    console.log('GOTO', normalizedPath);
    await page.goto(normalizedPath);
    const currentUrl = page.url();
    const htmlLang = await page.locator('html').getAttribute('lang');
    console.log('NAVIGATED', path, '->', currentUrl, 'HTML LANG', htmlLang);
    if (failedRequests.length > 0) {
      console.log('FAILED REQUESTS', JSON.stringify(failedRequests, null, 2));
    }
    if (failedResponses.length > 0) {
      console.log('FAILED RESPONSES', JSON.stringify(failedResponses, null, 2));
    }
    if (browserErrors.length > 0) {
      console.log('BROWSER ERRORS', JSON.stringify(browserErrors, null, 2));
    }
    if (pageErrors.length > 0) {
      console.log('PAGE ERRORS', JSON.stringify(pageErrors, null, 2));
    }
  }

  test('English root renders English content', async ({ page }) => {
    await navigateAndLog(page, '/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('navigation', { name: 'Main' })).toContainText('Documentation');
    await expect(page.locator('body')).not.toContainText('Documentação do player IPTV multiplataforma');
    await expect(page.locator('body')).not.toContainText('Introdução');
  });

  test('English docs page renders English docs content', async ({ page }) => {
    await navigateAndLog(page, '/docs/introduction');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toContainText('Introduction');
    await expect(page.getByRole('navigation', { name: 'Main' })).toContainText('Documentation');
    await expect(page.locator('body')).not.toContainText('Introdução');
  });

  test('Portuguese root renders Portuguese UI and routes', async ({ page }) => {
    await navigateAndLog(page, '/pt-BR/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('navigation', { name: /navegação/i })).toContainText('Documentação');
    await expect(page.locator('body')).toContainText('Documentação do player IPTV multiplataforma');
    await expect(page.locator('body')).not.toContainText('Cross-platform IPTV player documentation');
  });

  test('Portuguese docs page renders translated docs content', async ({ page }) => {
    await navigateAndLog(page, '/pt-BR/docs/introduction');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('h1')).toContainText('Megacubo IPTV Player - Introdução');
    await expect(page.locator('body')).toContainText('O que é o Megacubo?');
    await expect(page.locator('body')).not.toContainText('Introduction');
  });

  test('Locale selector navigates between English and Portuguese correctly', async ({ page }) => {
    await navigateAndLog(page, '/');
    const localeToggle = page.getByRole('button', { name: 'English' }).first();
    await expect(localeToggle).toBeVisible();
    await localeToggle.click();

    const portugueseLink = page.getByRole('link', { name: 'Português' }).first();
    await expect(portugueseLink).toBeVisible();
    await portugueseLink.click();
    await expect(page).toHaveURL(/\/pt-BR\//);
    console.log('CURRENT URL', page.url());
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('body')).toContainText('Documentação');

    const localeToggleAgain = page.getByRole('button', { name: 'Português' }).first();
    await expect(localeToggleAgain).toBeVisible();
    await localeToggleAgain.click();

    const englishLink = page.getByRole('link', { name: 'English' }).first();
    await expect(englishLink).toBeVisible();
    await englishLink.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('body')).toContainText('Cross-platform IPTV player documentation');
  });
});
