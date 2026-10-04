// No printing: loopback-only browser regression with every client API mocked.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const base=process.env.UI_BASE_URL || 'http://127.0.0.1:18081';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname));
const credential=crypto.randomBytes(32).toString('hex');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[],external=[],writes=[],seen=new Map();
  let printers=[{id:'p-one',name:'Canon <img src="https://invalid.example/">',formats:['pdf','zpl'],allowed_options:{media:['A4']},status:'paused'}];
  let rejectKey=false,loseReply=false,delay=0,failCode=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url());});
  await page.route(`${base}/api/v1/**`,async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   assert.equal(req.headers().authorization,'Bearer '+credential);
   if(rejectKey){await route.fulfill({status:401,json:{detail:'Invalid API key'}});return;}
   if(p==='/api/v1/printers'){await route.fulfill({json:printers});return;}
   if(p==='/api/v1/jobs'&&req.method()==='GET'){await route.fulfill({json:[...seen.values()].map(x=>({...x,status:'completed',title:'In thử',format:'pdf',copies:1,accepted_at:'2026-10-04'}))});return;}
   assert.equal(p,'/api/v1/jobs');assert.equal(req.method(),'POST');
   const id=req.headers()['idempotency-key'];assert.match(id,/^web-[a-f0-9]{48}$/);
   const body=req.postDataBuffer().toString();writes.push({id,body});
   if(delay)await new Promise(r=>setTimeout(r,delay));
   if(failCode){const code=failCode;failCode=0;await route.fulfill({status:code,json:{detail:'Unsupported options'}});return;}
   const duplicate=seen.has(id),job=seen.get(id)||{job_id:'j-'+(seen.size+1),status:'queued'};seen.set(id,job);
   if(loseReply){loseReply=false;await route.abort('failed');return;}
   await route.fulfill({status:duplicate?200:202,json:{...job,deduplicated:duplicate}});
  });
  const connect=async()=>{await page.locator('#api-key').fill(credential);await page.locator('#key-form button').click();await page.waitForFunction(()=>!document.querySelector('#key-form button').disabled);};
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#disconnect').disabled);
  const file=async(name='sample.pdf')=>page.locator('#client-file').setInputFiles({name,mimeType:name.endsWith('zpl')?'text/plain':'application/pdf',buffer:Buffer.from(name.endsWith('zpl')?'^XA^FO20,20^FDTest^FS^XZ':'%PDF-1.7\nfixture')});
  await page.goto(base+'/client');rejectKey=true;await connect();assert.equal(await page.locator('#key-panel').isVisible(),true);assert.match(await page.locator('#client-notice').textContent(),/không hợp lệ/);
  rejectKey=false;await connect();assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#client-workspace').isVisible(),true);
  assert.equal(await page.locator('img').count(),0);assert.match(await page.locator('#printer-state').textContent(),/tạm dừng/);
  assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
  await file();delay=450;loseReply=true;await page.locator('#send-print').click();assert.equal(await page.locator('#send-print').isDisabled(),true);
  await page.locator('#print-form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await idle();
  assert.equal(writes.length,1);assert.equal(seen.size,1);assert.equal(await page.locator('#uncertain-request').isVisible(),true);
  assert.equal(await page.locator('#client-file').isDisabled(),true);assert.equal(await page.locator('#send-print').isDisabled(),true);
  assert.equal(await page.locator('#request-id').textContent(),writes[0].id);
  await page.locator('#retry-print').click();await idle();assert.equal(seen.size,1);assert.equal(writes[1].id,writes[0].id);
  // Multipart boundaries differ, but submitted fields/file must remain identical on retry.
  for(const write of writes)for(const value of ['sample.pdf','%PDF-1.7','p-one','In thử'])assert.ok(write.body.includes(value));
  assert.equal(await page.locator('#uncertain-request').isVisible(),false);assert.match(await page.locator('#client-notice').textContent(),/không tạo lệnh trùng/);
  assert.equal(await page.locator('#client-file').inputValue(),'');assert.equal(await page.locator('#client-jobs article').count(),1);
  await file('label.zpl');assert.equal(await page.locator('#client-format').inputValue(),'zpl');
  await page.locator('#print-form summary').click();await page.locator('#client-options').fill('[]');await page.locator('#send-print').click();await idle();assert.equal(writes.length,2);assert.match(await page.locator('#client-notice').textContent(),/đối tượng JSON/);
  await page.locator('#client-options').fill('{}');failCode=422;await page.locator('#send-print').click();await idle();assert.equal(await page.locator('#uncertain-request').isVisible(),false);assert.equal(await page.locator('#client-file').isDisabled(),false);
  await page.locator('#send-print').click();await idle();assert.equal(seen.size,2);assert.notEqual(writes.at(-1).id,writes[0].id);assert.ok(writes.at(-1).body.includes('^XA'));
  if(process.env.UI_ARTIFACT_DIR){fs.mkdirSync(process.env.UI_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_ARTIFACT_DIR,'client-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(process.env.UI_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.UI_ARTIFACT_DIR,'client-mobile.png'),fullPage:true});
  await page.locator('#disconnect').click();assert.equal(await page.locator('#client-workspace').isVisible(),false);
  printers=[];await connect();assert.equal(await page.locator('#no-printers').isVisible(),true);assert.equal(await page.locator('#send-print').isDisabled(),true);assert.equal(await page.locator('#printer-state').textContent(),'');assert.equal(await page.locator('#permitted-options').textContent(),'');
  await page.reload();assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#key-panel').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: client key authentication/memory-only/reset; scoped empty/printer states; PDF/ZPL; slow/duplicate submit guard; lost reply immutable same-ID replay (one job); 422 editing; JSON validation; safe text; desktop/mobile; no external requests. APIs mocked; no printing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
