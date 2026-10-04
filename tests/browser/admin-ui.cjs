// Offline admin UI regression: API responses below are mocks, never real CUPS.
// Serve local assets first; UI_BASE_URL must be loopback. See README.md.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:18081';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only test on loopback');
const current = {id:'ui-existing', name:'UI test printer', queue:'pa_ui_test', managed:true, paused:false, formats:['pdf'], device_uri:'socket://192.0.2.21:9100', driver:'test/canon-6230.ppd', default_options:{}, allowed_options:{}};
const canon = {id:current.driver, make_model:'Canon LBP6230/6240 UFRII LT (mock only)'};
const drivers = Array.from({length:16362}, (_, i) => ({id:`test/model-${i}.ppd`, make_model:`UI sample model ${i}`}));
drivers.push(canon, {id:'test/hp-6230.ppd', make_model:'HP Officejet Pro 6230'}, {id:'test/accent.ppd', make_model:'Máy Thử nghiệm'}, {id:'test/unsafe-label.ppd', make_model:'<img src="https://invalid.example/test">'});
const settings = {max_upload_bytes:10485760, max_pending_jobs:100, min_free_bytes:104857600, history_retention_days:30};
const artifacts = process.env.UI_ARTIFACT_DIR;
if (artifacts) fs.mkdirSync(artifacts, {recursive:true});

async function mockApi(page) {
  const mutations = [];
  let printers = [current];
  await page.route(`${base}/admin/api/**`, async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    let value;
    if (req.method() !== 'GET') {
      mutations.push({path:pathname, method:req.method(), data:req.postDataJSON()});
      if (pathname === '/admin/api/printers' && req.method() === 'POST') {
        printers = [...printers, {...current, ...req.postDataJSON(), id:'ui-created', queue:'pa_ui_created'}];
        value = printers.at(-1);
      } else if (pathname === '/admin/api/printers/ui-existing' && req.method() === 'PUT') {
        printers = printers.map(p => p.id === current.id ? {...p, ...req.postDataJSON()} : p);
        value = printers[0];
      } else throw new Error(`Unexpected UI mutation: ${req.method()} ${pathname}`);
    } else {
      switch (pathname) {
        case '/admin/api/session': value = {authenticated:true, csrf_token:'ui-test-csrf'}; break;
        case '/admin/api/status': value = {cups:{available:true,message:'Mock CUPS'},disk:{free_bytes:536870912,total_bytes:1073741824},jobs:{queued:0,held:0,submitted:0,unknown:0}}; break;
        case '/admin/api/printers': value = printers; break;
        case '/admin/api/clients': case '/admin/api/jobs': value = []; break;
        case '/admin/api/settings': value = settings; break;
        case '/admin/api/discovery': value = {devices:[{uri:current.device_uri,info:'Mock device'}],drivers,queues:{}}; break;
        default: throw new Error(`Unexpected UI read: ${pathname}`);
      }
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  return mutations;
}

(async () => {
  const launch = {headless:true};
  if (process.env.CHROME_EXECUTABLE) launch.executablePath = process.env.CHROME_EXECUTABLE;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => {if (!req.url().startsWith(base + '/')) external.push(req.url());});
    const mutations = await mockApi(page);
    await page.goto(base);
    await page.locator('#dashboard').waitFor({state:'visible'});
    assert.equal(await page.getByRole('tab').count(), 5);
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    await page.getByRole('tab',{name:'Máy in',exact:true}).click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-clients').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#tab-settings').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#tab-overview').getAttribute('aria-selected'), 'true');
    await page.getByRole('tab',{name:'Máy in',exact:true}).click();
    await page.reload();
    await page.locator('#printers h3').waitFor();
    assert.equal(await page.locator('#tab-printers').getAttribute('aria-selected'), 'true');
    await page.getByRole('button',{name:'Khám phá thiết bị / driver',exact:true}).click();
    await page.locator('#discovery').waitFor({state:'visible'});
    await page.waitForFunction(() => document.querySelector('#driver-results').textContent.includes('200'));
    const search = page.locator('#driver-search'), select = page.locator('#driver');
    assert.ok(await select.locator('option').count() <= 201, '16k drivers should not create 16k DOM options');
    assert.equal(await select.inputValue(), '', 'No implicit first-driver selection');
    await search.fill('  CANON   6230 ');
    assert.equal(await select.locator('option').count(), 2);
    await select.selectOption(canon.id);
    await search.fill('ufrii');
    assert.equal(await select.inputValue(), canon.id, 'Matching selected driver survives filtering');
    await search.fill('no-such-driver');
    assert.equal(await select.inputValue(), '');
    assert.equal(await select.evaluate(s => s.validity.valid), false);
    assert.ok((await page.locator('#driver-results').textContent()).includes('Không tìm thấy'));
    await search.fill('test/hp-6230.ppd');
    assert.equal(await select.locator('option').count(), 2, 'Search matches driver ID');
    await search.fill('may thu');
    assert.equal(await select.locator('option').count(), 2, 'Accent-insensitive model search');
    await search.fill('unsafe-label');
    assert.equal(await page.locator('#managed-printer-form img').count(), 0, 'Driver labels must remain plain text');
    await search.fill('canon 6230');
    await select.selectOption(canon.id);
    await page.locator('#printer-name').fill('UI created printer');
    await search.press('Enter');
    assert.equal(mutations.length, 0, 'Enter while searching must not submit');
    await search.fill('');
    assert.equal(await select.inputValue(), canon.id, 'Selection beyond the 200-result cap must survive clearing search');
    await page.getByRole('button',{name:'Khám phá thiết bị / driver',exact:true}).click();
    await page.waitForFunction(id => document.querySelector('#driver').value === id, canon.id);
    await page.locator('#managed-printer-form').getByRole('button',{name:'Tạo máy in',exact:true}).click();
    await page.locator('#printers h3').getByText('UI created printer',{exact:true}).waitFor();
    assert.equal(mutations[0].data.driver, canon.id, 'Creation submits the actual selected PPD ID');
    const existing = page.locator('.item-card').filter({has:page.getByRole('heading',{name:'UI test printer',exact:true})});
    await existing.locator('summary').click();
    const editSearch = existing.locator('input[type="search"]'), editSelect = existing.locator('select[data-mapping="driver"]');
    await editSearch.fill('canon');
    assert.equal(await editSelect.inputValue(), canon.id);
    await editSearch.press('Enter');
    assert.equal(mutations.length, 1, 'Searching edit controls must not save configuration');
    await existing.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Đã lưu cấu hình'));
    assert.ok(!Object.hasOwn(mutations[1].data,'driver'), 'Unchanged driver must not be sent as a remap');
    await page.locator('#driver-search').fill('canon 6230');
    if (artifacts) await page.screenshot({path:path.join(artifacts,'driver-search-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth+1), 'Mobile page overflow');
    await page.getByRole('tab',{name:'Cấu hình',exact:true}).click();
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    await page.getByRole('tab',{name:'Máy in',exact:true}).click();
    if (artifacts) await page.screenshot({path:path.join(artifacts,'driver-search-mobile.png'),fullPage:true});
    await page.goto(base+'/#tab=jobs');
    await page.locator('#dashboard').waitFor({state:'visible'});
    assert.equal(await page.locator('#tab-jobs').getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS: five tabs, keyboard/hash/reload/mobile, bounded 16k-driver search, safe explicit selection, empty/clear/refresh, create/edit PPD payloads, no external resources. All API/CUPS data mocked.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exit(1);});
