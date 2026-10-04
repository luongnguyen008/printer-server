// Loopback-only UI tests. All admin APIs and CUPS data are mocked.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtureKey = require('node:crypto').randomBytes(32).toString('hex');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:18081';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname));
const artifacts = process.env.UI_ARTIFACT_DIR;
if (artifacts) fs.mkdirSync(artifacts, {recursive:true});
const current = {id:'ui-existing',name:'Canon văn phòng',queue:'pa_ui_test',managed:true,paused:false,formats:['pdf'],device_uri:'socket://192.0.2.21:9100',driver:'test/canon.ppd',default_options:{},allowed_options:{}};
const drivers = Array.from({length:16362}, (_,i) => ({id:`test/model-${i}.ppd`,make_model:`UI sample model ${i}`}));
drivers.push({id:current.driver,make_model:'Canon LBP6230 UFRII LT (mock)'},{id:'test/accent.ppd',make_model:'Máy Thử nghiệm'},{id:'test/unsafe.ppd',make_model:'<img src="https://invalid.example/test">'});
async function fixture(page) {
  const state = {mutations:[],printers:[{...current}],clients:[],delay:0,fail:0,discoveryDelay:0};
  await page.route(`${base}/admin/api/**`, async route => {
    const req=route.request(), url=new URL(req.url()), p=url.pathname, method=req.method();
    let value, status=200;
    if (method !== 'GET') {
      const data=req.postData() ? req.postDataJSON() : null;
      state.mutations.push({path:p,method,data});
      if (state.delay) await new Promise(resolve => setTimeout(resolve,state.delay));
      if (state.fail) {status=state.fail; state.fail=0; value={detail:status===409?'Resource has nonterminal jobs':'CUPS unavailable'};}
      else if (p==='/admin/api/printers' && method==='POST') {value={...current,...data,id:'created',queue:'created'};state.printers.push(value);}
      else if (p.startsWith('/admin/api/printers/') && method==='PUT') {value=state.printers.find(x=>x.id===p.split('/').at(-1));Object.assign(value,data);}
      else if (p.startsWith('/admin/api/printers/') && method==='DELETE') {state.printers=state.printers.filter(x=>x.id!==p.split('/').at(-1));value={deleted:true};}
      else if (p==='/admin/api/clients' && method==='POST') {value={id:'client-created',...data,revoked:false,api_key:fixtureKey};state.clients.push(value);}
      else if (p.startsWith('/admin/api/clients/') && method==='PUT') {value=state.clients.find(x=>x.id===p.split('/').at(-1));Object.assign(value,data);}
      else if (p.startsWith('/admin/api/clients/') && method==='DELETE') {state.clients=state.clients.filter(x=>x.id!==p.split('/').at(-1));value={deleted:true};}
      else if (p==='/admin/api/settings' && method==='PUT') value=data;
      else if (p==='/admin/api/logout') value={ok:true};
      else throw Error(`Unexpected mutation: ${method} ${p}`);
    } else {
      switch(p) {
        case '/admin/api/session':value={authenticated:true,csrf_token:'mock-csrf'};break;
        case '/admin/api/status':value={cups:{available:true,message:'Mock CUPS'},disk:{free_bytes:536870912,total_bytes:1073741824},jobs:{queued:0,held:0,submitted:0,unknown:0}};break;
        case '/admin/api/printers':value=state.printers;break;
        case '/admin/api/clients':value=state.clients;break;
        case '/admin/api/jobs':value=[];break;
        case '/admin/api/settings':value={max_upload_bytes:10485760,max_pending_jobs:100,min_free_bytes:104857600,history_retention_days:30};break;
        case '/admin/api/discovery':if(state.discoveryDelay) await new Promise(r=>setTimeout(r,state.discoveryDelay));value={devices:[{uri:current.device_uri,info:'Canon mock'}],drivers,queues:{existing:{}}};break;
        default:throw Error(`Unexpected read ${p}`);
      }
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  });
  return state;
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/')) external.push(r.url());});
  const state=await fixture(page);
  const idle=()=>page.locator('#busy-status').waitFor({state:'hidden'});
  await page.goto(base);await page.locator('#printers h3').waitFor({state:'attached'});
  assert.equal(await page.getByRole('tab').count(),5);
  await page.getByRole('tab',{name:'Máy in',exact:true}).click();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-clients').getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.locator('#tab-settings').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
  await page.getByRole('tab',{name:'Máy in',exact:true}).click();await page.reload();await page.locator('#printers h3').waitFor();
  state.discoveryDelay=500;
  await page.locator('#discover').click();assert.equal(await page.locator('#discover').isDisabled(),true);await idle();
  assert.equal(await page.locator('#import-form').isVisible(),false);
  const search=page.locator('#driver-search'), hidden=page.locator('#driver');
  await search.click();assert.ok(await page.locator('#driver-list [role="option"]').count()<=200);assert.equal(await hidden.inputValue(),'');
  await search.fill('CANON 6230');assert.equal(await page.locator('#driver-list [role="option"]').count(),1);
  await search.press('Enter');assert.equal(await hidden.inputValue(),'');assert.equal(state.mutations.length,0);
  await search.press('ArrowDown');await search.press('Enter');assert.equal(await hidden.inputValue(),current.driver);
  await search.fill('not-a-real-driver');assert.equal(await hidden.inputValue(),'');assert.equal(await search.evaluate(x=>x.validity.valid),false);
  assert.match(await page.locator('#driver-results').textContent(),/Không tìm thấy/);
  await search.press('Escape');assert.equal(await hidden.inputValue(),current.driver);
  await search.fill('may thu');assert.equal(await page.locator('#driver-list [role="option"]').count(),1);
  await search.fill('test/unsafe');assert.equal(await page.locator('#managed-printer-form img').count(),0);
  await search.fill('canon');await search.press('End');await search.press('Enter');assert.equal(await hidden.inputValue(),current.driver);
  await page.locator('#driver-picker').getByRole('button',{name:'Xóa lựa chọn driver'}).click();assert.equal(await hidden.inputValue(),'');
  await search.fill('canon');await page.locator('#driver-list [role="option"]').click();
  await page.locator('#discover').click();await idle();assert.equal(await hidden.inputValue(),current.driver);
  const help=page.getByRole('button',{name:'Giải thích: Driver',exact:true}).first();await help.click();
  await page.waitForFunction(() => !!document.querySelector('.help-popover:popover-open'));await page.keyboard.press('Escape');await page.waitForFunction(() => !document.querySelector('.help-popover:popover-open'));
  await page.locator('#import-printer-mode').click();assert.equal(await page.locator('#managed-printer-form').isVisible(),false);assert.equal(await page.locator('#import-form').isVisible(),true);
  await page.locator('#new-printer-mode').click();
  await page.locator('#printer-name').fill('Máy kiểm thử');await page.locator('#device-uri').selectOption(current.device_uri);
  state.delay=500;state.fail=503;
  const create=page.locator('#managed-printer-form button[type="submit"]');await create.click();
  assert.equal(await create.isDisabled(),true);assert.equal(await search.isDisabled(),true);
  await page.locator('#managed-printer-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await idle();assert.equal(state.mutations.length,1);assert.equal(await create.isDisabled(),false);assert.equal(await page.locator('#printer-name').inputValue(),'Máy kiểm thử');
  assert.match(await page.locator('#notice').textContent(),/CUPS unavailable/);
  await create.click();await idle();assert.equal(state.mutations.length,2);assert.equal(state.mutations[1].data.driver,current.driver);
  const card=page.locator('#printers article[data-id="ui-existing"]');await card.locator(':scope > details > summary').click();
  const editSearch=card.locator('[role="combobox"]');await editSearch.fill('canon');await editSearch.press('Escape');
  await card.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();await idle();assert.ok(!Object.hasOwn(state.mutations.at(-1).data,'driver'));
  // A refresh must preserve unsaved edits in other cards and settings.
  await card.locator(':scope > details > summary').click();await card.locator('input').first().fill('Chưa lưu');
  await page.getByRole('tab',{name:'Lệnh in',exact:true}).click();await page.locator('#refresh').click();await idle();
  await page.getByRole('tab',{name:'Máy in',exact:true}).click();assert.equal(await card.locator('input').first().inputValue(),'Chưa lưu');
  let approve=false;page.on('dialog',dialog=>approve?dialog.accept():dialog.dismiss());
  const remove=page.locator('#printers article[data-id="created"]').getByRole('button',{name:'Gỡ đăng ký'});
  const before=state.mutations.length;await remove.click();await idle();assert.equal(state.mutations.length,before);
  approve=true;state.fail=409;await remove.click();await idle();assert.equal(await remove.isVisible(),true);assert.match(await page.locator('#notice').textContent(),/nonterminal/);
  await remove.click();await idle();assert.equal(await page.locator('#printers article[data-id="created"]').count(),0);
  await page.getByRole('tab',{name:'Clients',exact:true}).click();await page.locator('#client-name').fill('Odoo kiểm thử');await page.locator('#client-printers').selectOption(current.id);
  await page.locator('#client-form button[type="submit"]').click();await idle();assert.ok((await page.locator('#notice').textContent()).includes(fixtureKey));
  const client=page.locator('#clients article');await client.locator('summary').click();
  // Concurrent revocation must survive a name-only save from this stale editor.
  state.clients[0].printer_ids=[];
  await client.locator('input').fill('Client đã sửa');await client.getByRole('button',{name:'Lưu client',exact:true}).click();await idle();
  assert.equal(state.mutations.at(-1).method,'PUT');assert.equal(state.mutations.at(-1).data.name,'Client đã sửa');
  assert.ok(!Object.hasOwn(state.mutations.at(-1).data,'printer_ids'));assert.deepEqual(state.clients[0].printer_ids,[]);
  await client.locator('summary').click();await client.locator('select').selectOption(current.id);
  await client.getByRole('button',{name:'Lưu client',exact:true}).click();await idle();
  assert.deepEqual(state.mutations.at(-1).data.printer_ids,[current.id]);
  state.fail=409;await client.getByRole('button',{name:'Xóa client'}).click();await idle();assert.equal(await client.count(),1);
  await client.getByRole('button',{name:'Xóa client'}).click();await idle();assert.equal(await page.locator('#clients article').count(),0);
  await page.getByRole('tab',{name:'Cấu hình',exact:true}).click();await page.locator('[name="max_pending_jobs"]').fill('111');
  await page.locator('#settings-form button[type="submit"]').click();await idle();assert.equal(state.mutations.at(-1).data.max_pending_jobs,111);
  await page.getByRole('tab',{name:'Máy in',exact:true}).click();await search.fill('canon');
  if(artifacts) await page.screenshot({path:path.join(artifacts,'admin-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await help.click();if(artifacts) await page.screenshot({path:path.join(artifacts,'help-mobile.png')});await page.keyboard.press('Escape');
  if(artifacts) await page.screenshot({path:path.join(artifacts,'admin-mobile.png'),fullPage:true});
  await page.locator('#logout').click();await idle();assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(await page.locator('#notice').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: tabs; 16k integrated driver combobox and explicit ID; keyboard/escape/clear/refresh; help; add/import modes; loading and duplicate prevention; 409/503 recovery; printer/client CRUD; unsaved edits; settings; mobile; logout; no external requests. APIs mocked.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
