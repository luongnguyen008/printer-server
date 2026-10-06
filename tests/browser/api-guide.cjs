// Offline reference only: every admin API mocked; client APIs/print mutations forbidden.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:18081';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], clientRequests = [], writes = [], external = [];
    let reads = 0;
    page.on('pageerror', e => errors.push(e.message));
    const handler = async route => {
      const request = route.request(), p = new URL(request.url()).pathname;
      if (!request.url().startsWith(base + '/')) { external.push(request.url()); return route.abort(); }
      if (p.startsWith('/api/v1/')) { clientRequests.push(p); return route.abort(); }
      if (request.method() !== 'GET') { writes.push(p); return route.abort(); }
      if (!p.startsWith('/admin/api/')) return route.continue();
      reads++;
      let data;
      if (p.endsWith('/session')) data = { authenticated: true, csrf_token: 'mock' };
      else if (p.endsWith('/status')) data = { cups: { available: true }, disk: { free_bytes: 1e9, total_bytes: 2e9 }, jobs: {} };
      else if (p.endsWith('/settings')) data = { max_upload_bytes: 10485760, max_pending_jobs: 100, min_free_bytes: 0, history_retention_days: 30 };
      else data = [];
      return route.fulfill({ json: data });
    };
    await page.route('**/*', handler);
    await page.goto(base); await page.locator('#busy-status').waitFor({ state: 'hidden' });
    const before = reads;
    await page.getByRole('tab', { name: 'API Guide', exact: true }).click();
    assert.equal(new URL(page.url()).hash, '#tab=api-guide'); assert.equal(await page.locator('.api-endpoint').count(), 6);
    const submit = page.locator('.api-endpoint').filter({ has: page.locator('summary', { hasText: '/api/v1/jobs' }) }).filter({ hasText: 'Gửi yêu cầu in' });
    await submit.locator(':scope > summary').click();
    assert.match(await submit.textContent(), /multipart\/form-data/); assert.match(await submit.textContent(), /HTTP 202/); assert.match(await submit.textContent(), /HTTP 200/);
    await submit.getByLabel('Định dạng ví dụ').selectOption('zpl'); assert.equal(await submit.getAttribute('open'), '');
    const curl = submit.locator('pre').filter({ hasText: 'curl --include' }); assert.match(await curl.textContent(), /format=zpl/); assert.match(await curl.textContent(), /label.zpl/); assert.match(await curl.textContent(), /Idempotency-Key/); assert.ok(!(await curl.textContent()).includes('--retry'));
    await submit.getByLabel('Định dạng ví dụ').selectOption('pdf'); assert.match(await curl.textContent(), /invoice.pdf/);
    await submit.getByText('JSON schema: Accepted', { exact: true }).click();
    const schema = JSON.parse(await submit.locator('pre[aria-label="Schema response 202"]').textContent()); assert.equal(schema.properties.deduplicated.const, false);
    // Non-secure LAN HTTP copy fallback selects the exact code, without eval/inline scripts.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
    await submit.getByRole('button', { name: 'Sao chép cURL POST /api/v1/jobs', exact: true }).click(); assert.equal(await page.evaluate(() => getSelection().toString()), await curl.textContent());
    await page.getByLabel('Base URL', { exact: true }).fill('https://example.invalid'); assert.match(await page.locator('pre[aria-label="Biến môi trường (thay placeholder trên máy client)"]').textContent(), /https:\/\/example.invalid/);
    await page.getByLabel('Base URL', { exact: true }).fill('http://user:secret@example.invalid'); await page.getByRole('alert').filter({ hasText: 'Nhập origin' }).waitFor();
    await page.getByLabel('Base URL', { exact: true }).fill(base);
    if (process.env.UI_ARTIFACT_DIR) { fs.mkdirSync(process.env.UI_ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.UI_ARTIFACT_DIR, 'api-guide-desktop.png'), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('Tìm endpoint').fill('huy'); assert.equal(await page.locator('.api-endpoint').count(), 1); assert.match(await page.locator('.api-endpoint').textContent(), /Yêu cầu hủy/);
    await page.getByLabel('Tìm endpoint').fill('no-match'); assert.equal(await page.locator('.api-endpoint').count(), 0);
    assert.equal(reads, before, 'Guide interaction does not fetch');
    await page.reload(); await page.locator('#busy-status').waitFor({ state: 'hidden' }); assert.equal(await page.locator('#tab-api-guide').getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('.api-endpoint').count(), 6);
    // A fresh mobile context avoids Chrome full-page tiling after viewport resize.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    mobile.on('pageerror', error => errors.push(error.message)); await mobile.route('**/*', handler);
    await mobile.goto(base + '/#tab=api-guide'); await mobile.locator('#busy-status').waitFor({ state: 'hidden' });
    await mobile.locator('.api-endpoint').filter({ hasText: 'Gửi yêu cầu in' }).locator(':scope > summary').click();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.UI_ARTIFACT_DIR) await mobile.screenshot({ path: path.join(process.env.UI_ARTIFACT_DIR, 'api-guide-mobile.png'), fullPage: true });
    await mobile.close();
    assert.deepEqual(errors, []); assert.deepEqual(clientRequests, []); assert.deepEqual(writes, []); assert.deepEqual(external, []);
    console.log('PASS: API Guide six endpoints/schema/responses/cURL; PDF/ZPL examples; copy fallback; safe base URL; search; hash reload; desktop/mobile; zero client calls, mutations or external requests.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
