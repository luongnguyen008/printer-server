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
  let printers=[{id:'p-one',name:'Canon <img src="https://invalid.example/">',formats:['pdf','zpl'],allowed_options:{PageSize:['A4']},status:'paused'},{id:'p-two',name:'Second printer',formats:['pdf'],allowed_options:{MediaType:['Plain']},status:'ready'}];
  const schemas={'p-one':{printer_id:'p-one',availability:'available',source:'ppd',schema_fingerprint:'schema-one',mapping_fingerprint:'map-one',default_options:{PageSize:'A4'},allowed_options:null,groups:[{id:'common',label:'Common'},{id:'advanced',label:'Advanced'}],constraints:[{option1:'Duplex',choice1:'Long',option2:'BindEdge',choice2:'Left'}],options:[{name:'PageSize',label:'Paper <script>',group:'common',default:'A4',choices:[{value:'A4',label:'A4'},{value:'A5',label:'A5'}]},{name:'Duplex',label:'Duplex',group:'common',default:'None',choices:[{value:'Long',label:'Long edge'},{value:'Short',label:'Short edge'}]},{name:'BindEdge',label:'Binding edge',group:'advanced',default:'Right',choices:[{value:'Left',label:'Left'},{value:'Right',label:'Right'}]},{name:'Resolution',label:'Resolution',group:'advanced',default:'600dpi',choices:[{value:'600dpi',label:'600 dpi'}]}]},'p-two':{printer_id:'p-two',availability:'available',source:'ppd',schema_fingerprint:'schema-two',mapping_fingerprint:'map-two',default_options:{MediaType:'Plain'},allowed_options:null,groups:[],constraints:[],options:[{name:'MediaType',label:'Media',group:'common',default:'Plain',choices:[{value:'Plain',label:'Plain'},{value:'Photo',label:'Photo'}]}]}};
  let rejectKey=false,loseReply=false,delay=0,failCode=0,schemaDelay=0,unavailable=false,zeroRights=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base+'/'))external.push(r.url());});
  const handler=async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   assert.equal(req.headers().authorization,'Bearer '+credential);
   if(rejectKey){await route.fulfill({status:401,json:{detail:'Invalid API key'}});return;}
   if(p==='/api/v1/printers'){await route.fulfill({json:printers});return;}
   if(p.startsWith('/api/v1/printers/') && p.endsWith('/capabilities')){const id=p.split('/')[4];if(schemaDelay&&id==='p-one')await new Promise(r=>setTimeout(r,schemaDelay));await route.fulfill({json:unavailable?{...schemas[id],availability:'unavailable',options:[],reason:'CUPS unavailable'}:zeroRights?{...schemas[id],options:[]}:schemas[id]});return;}
   if(p==='/api/v1/jobs'&&req.method()==='GET'){await route.fulfill({json:[...seen.values()].map(x=>({...x,status:'completed',title:'In thử',format:'pdf',copies:1,accepted_at:'2026-10-04'}))});return;}
   assert.equal(p,'/api/v1/jobs');assert.equal(req.method(),'POST');
   const id=req.headers()['idempotency-key'];assert.match(id,/^web-[a-f0-9]{48}$/);
   const body=req.postDataBuffer().toString();writes.push({id,body});
   if(delay)await new Promise(r=>setTimeout(r,delay));
   if(failCode){const code=failCode;failCode=0;await route.fulfill({status:code,json:{detail:'Unsupported options'}});return;}
   const duplicate=seen.has(id),job=seen.get(id)||{job_id:'j-'+(seen.size+1),status:'queued'};seen.set(id,job);
   if(loseReply){loseReply=false;await route.abort('failed');return;}
   await route.fulfill({status:duplicate?200:202,json:{...job,deduplicated:duplicate}});
  };await page.route(`${base}/api/v1/**`,handler);
  const connect=async()=>{await page.locator('#api-key').fill(credential);await page.locator('#key-form button').click();await page.waitForFunction(()=>!document.querySelector('#key-form button').disabled);};
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#disconnect').disabled);
  const file=async(name='sample.pdf')=>page.locator('#client-file').setInputFiles({name,mimeType:name.endsWith('zpl')?'text/plain':'application/pdf',buffer:Buffer.from(name.endsWith('zpl')?'^XA^FO20,20^FDTest^FS^XZ':'%PDF-1.7\nfixture')});
  await page.goto(base+'/client');rejectKey=true;await connect();assert.equal(await page.locator('#key-panel').isVisible(),true);assert.match(await page.locator('#client-notice').textContent(),/không hợp lệ/);
  rejectKey=false;await connect();assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#client-workspace').isVisible(),true);
  assert.equal(await page.locator('img').count(),0);assert.match(await page.locator('#printer-state').textContent(),/tạm dừng/);await page.locator('#options-state').getByText(/Chỉ các lựa chọn/).waitFor();
  assert.equal(await page.locator('#client-options img, #client-options script').count(),0);assert.equal(await page.locator('#client-options legend').first().textContent().then(x=>x.startsWith('Khổ giấy')),true);
  await page.locator('#client-options select[data-option-name="PageSize"]').selectOption('A4');assert.equal(await page.locator('#client-options select[data-option-name="PageSize"]').inputValue(),'A4');
  await page.locator('#client-options .option-advanced summary').click();
  await page.locator('#client-options select[data-option-name="Duplex"]').selectOption('Long');await page.locator('#client-options select[data-option-name="BindEdge"]').selectOption('Left');
  await file();const beforeConflict=writes.length;await page.locator('#send-print').click();await idle();assert.equal(writes.length,beforeConflict);assert.match(await page.locator('#client-notice').textContent(),/không tương thích/);
  await page.locator('#client-options select[data-option-name="Duplex"]').selectOption('');await page.locator('#client-options select[data-option-name="BindEdge"]').selectOption('');
  assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
  await page.locator('#client-options select[data-option-name="PageSize"]').selectOption('A5');await file();delay=450;loseReply=true;await page.locator('#send-print').click();assert.equal(await page.locator('#send-print').isDisabled(),true);
  await page.locator('#print-form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await idle();
  assert.equal(writes.length,1);assert.equal(seen.size,1);assert.equal(await page.locator('#uncertain-request').isVisible(),true);
  assert.equal(await page.locator('#client-file').isDisabled(),true);assert.equal(await page.locator('#send-print').isDisabled(),true);
  assert.equal(await page.locator('#request-id').textContent(),writes[0].id);
  await page.locator('#retry-print').click();await idle();assert.equal(seen.size,1);assert.equal(writes[1].id,writes[0].id);
  // Multipart boundaries differ, but submitted fields/file must remain identical on retry.
  for(const write of writes)for(const value of ['sample.pdf','%PDF-1.7','p-one','In thử'])assert.ok(write.body.includes(value));
  assert.ok(writes[0].body.includes('A5')&&writes[1].body.includes('A5'));assert.equal(await page.locator('#uncertain-request').isVisible(),false);assert.match(await page.locator('#client-notice').textContent(),/không tạo lệnh trùng/);
  assert.equal(await page.locator('#client-file').inputValue(),'');assert.equal(await page.locator('#client-jobs article').count(),1);
  await file('label.zpl');assert.equal(await page.locator('#client-format').inputValue(),'zpl');
  await page.locator('#client-format').selectOption('zpl');assert.equal(await page.locator('#options-state').textContent(), 'ZPL gửi nguyên bản; tùy chọn driver PDF không áp dụng.');
  await file('label.zpl');failCode=422;await page.locator('#send-print').click();await idle();assert.equal(await page.locator('#uncertain-request').isVisible(),false);assert.equal(await page.locator('#client-file').isDisabled(),false);
  await page.locator('#send-print').click();await idle();assert.equal(seen.size,2);assert.notEqual(writes.at(-1).id,writes[0].id);assert.ok(writes.at(-1).body.includes('^XA'));assert.ok(writes.at(-1).body.includes('name="options"') && writes.at(-1).body.includes('{}'));
  await page.locator('#client-printer').selectOption('p-two');await page.locator('#options-state').getByText(/Chỉ các lựa chọn/).waitFor();assert.equal(await page.locator('#client-options select').count(),1);assert.equal(await page.locator('#client-options select').inputValue(),'');
  await page.locator('#client-printer').selectOption('p-one');await page.locator('#options-state').getByText(/Chỉ các lựa chọn/).waitFor();assert.equal(await page.locator('#client-options select').first().inputValue(),'');
  schemaDelay=400;await page.locator('#client-printer').selectOption('p-one');await page.locator('#client-printer').selectOption('p-two');await page.waitForFunction(()=>document.querySelector('#client-options pre')?.textContent.includes('schema-two'));await page.waitForTimeout(500);assert.equal(await page.locator('#client-options select').count(),1);assert.ok((await page.locator('#client-options pre').textContent()).includes('schema-two'));schemaDelay=0;
  zeroRights=true;await page.locator('#refresh-client').click();await idle();assert.equal(await page.locator('#client-options select').count(),0);await file();await page.locator('#send-print').click();await idle();assert.ok(writes.at(-1).body.includes('name="options"')&&writes.at(-1).body.includes('{}'));zeroRights=false;await page.locator('#refresh-client').click();await idle();
  if(process.env.UI_ARTIFACT_DIR){fs.mkdirSync(process.env.UI_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.UI_ARTIFACT_DIR,'client-desktop.png'),fullPage:true});}
  const mobile=await browser.newPage({viewport:{width:390,height:844}});await mobile.route(`${base}/api/v1/**`,handler);await mobile.goto(base+'/client');await mobile.locator('#api-key').fill(credential);await mobile.locator('#key-form button').click();await mobile.waitForFunction(()=>!document.querySelector('#disconnect').disabled);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok((await mobile.locator('#client-notice').boundingBox()).y<30);
  if(process.env.UI_ARTIFACT_DIR)await mobile.screenshot({path:path.join(process.env.UI_ARTIFACT_DIR,'client-mobile.png')});await mobile.close();
  unavailable=true;await page.locator('#client-printer').selectOption('p-two');await page.locator('#options-state').getByText(/CUPS unavailable/).waitFor();await file();const beforeUnsupported=writes.length;await page.locator('#send-print').click();await idle();assert.equal(writes.length,beforeUnsupported);unavailable=false;
  await page.locator('#disconnect').click();assert.equal(await page.locator('#client-workspace').isVisible(),false);
  printers=[];await connect();assert.equal(await page.locator('#no-printers').isVisible(),true);assert.equal(await page.locator('#send-print').isDisabled(),true);assert.equal(await page.locator('#printer-state').textContent(),'');
  await page.reload();assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#key-panel').isVisible(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: client key authentication/memory-only/reset; scoped printer schemas/defaults/grants; PDF/ZPL separation; slow/duplicate guard; lost reply immutable same-ID replay; schema switching/unavailable; safe text; desktop/mobile; no external requests. APIs mocked; no printing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
