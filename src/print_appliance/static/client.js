// Same-origin client API only. Tab-scoped credentials survive reload; files/requests stay in memory.
(() => {
  const $ = selector => document.querySelector(selector);
  const toasts=createToasts($('#client-notice'));
  const labels = {queued:'Đang chờ',held:'Đang giữ',submitting:'Đang giao',submitted:'Đã giao CUPS',completed:'Hoàn thành (CUPS)',failed:'Thất bại',canceled:'Đã hủy',unknown:'Chưa rõ kết quả'};
  const active = new Set(['queued','held','submitting','submitted']);
  let apiKey = '', printers = [], pending = null, busy = false, epoch = 0, timer = null, reading = false, schemaEpoch = 0, currentSchema = null, optionEditor = null, actionGeneration = 0;
  const keyStorage = 'print-appliance.client.api-key';
  function forgetKey() { try { sessionStorage.removeItem(keyStorage); } catch {} }
  function rememberedKey() {
    try {
      const key=sessionStorage.getItem(keyStorage);
      if(key && key.length<=256 && !/[\s\x00-\x1f\x7f]/.test(key)) return key;
      forgetKey();
    } catch {}
    return '';
  }
  function rememberKey(key) { try { sessionStorage.setItem(keyStorage,key); return true; } catch { return false; } }
  function text(tag, content, className) { const el=document.createElement(tag); el.textContent=String(content ?? ''); if(className) el.className=className; return el; }
  function notice(message,error=false){toasts.show(message,error?'error':'success');}
  function stopPolling() { clearTimeout(timer); timer=null; }
  function updateControls() {
    for(const el of document.querySelectorAll('input,select,textarea,button')) el.disabled=busy;
    for(const el of $('#print-form').querySelectorAll('input,select,textarea,button')) el.disabled=busy || !!pending || !printers.length;
    $('#uncertain-request').hidden=!pending;
    $('#request-id').textContent=pending?.id || '';
    $('#send-print').textContent=busy && pending ? 'Đang gửi…' : 'Gửi lệnh in';
    $('#key-form button').textContent=busy?'Đang kết nối…':'Kết nối';
    $('#retry-print').textContent=busy?'Đang gửi…':'Gửi lại cùng yêu cầu';
  }
  async function action(fn) {
    if(busy) return;
    const generation=++actionGeneration;busy=true; stopPolling(); updateControls();
    try { await fn(); } catch(error) { if(generation===actionGeneration) notice(error.message,true); }
    finally { if(generation===actionGeneration) { busy=false; updateControls(); } }
  }
  async function request(path, options={}, key=apiKey) {
    const currentEpoch=epoch;
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${key}`,...options.headers},credentials:'omit',signal:controller.signal});
      const data=await response.json().catch(()=>null);
      if(currentEpoch!==epoch) throw new Error('Kết nối đã thay đổi.');
      if(!response.ok) {
        const detail=typeof data?.detail==='string'?data.detail:`API trả lỗi ${response.status}`;
        const message=response.status===401?'API key không hợp lệ hoặc đã bị thu hồi.':detail;
        if(response.status===401 && key===apiKey) { resetConnection(); notice(message,true); }
        const error=new Error(message); error.status=response.status; throw error;
      }
      if(data===null) throw new Error('Server trả dữ liệu không hợp lệ.');
      return data;
    } catch(error) {
      if(error.name==='AbortError') throw new Error('Hết thời gian chờ phản hồi.');
      throw error;
    } finally {clearTimeout(timeout);}
  }
  async function refreshPrinterState(key=apiKey) {
    const printer=printers.find(x=>x.id===$('#client-printer').value);
    const format=$('#client-format'); const previous=format.value;
    format.replaceChildren(...(printer?.formats || []).map(value=>{const item=text('option',value.toUpperCase());item.value=value;return item;}));
    if(printer?.formats.includes(previous)) format.value=previous;
    const loadId=++schemaEpoch; currentSchema=null; optionEditor=null; $('#client-options').replaceChildren();
    if(!printer) { $('#printer-state').textContent=''; $('#options-state').textContent=''; return; }
    $('#printer-state').textContent=printer.status==='paused'?'Máy đang tạm dừng. Lệnh sẽ được giữ đến khi quản trị cho tiếp tục.':'Được phép xử lý; trạng thái này không xác nhận máy đã in.';
    $('#options-state').textContent='Đang tải schema capability được cấp…';
    try {
      const schema=await request(`/api/v1/printers/${encodeURIComponent(printer.id)}/capabilities`,{},key);
      if(loadId!==schemaEpoch || printer.id!==$('#client-printer').value) return;
      currentSchema=schema;
      if(schema.availability==='stale' || schema.availability==='unavailable' || schema.availability==='unknown') throw new Error(schema.reason || `Schema không khả dụng (${schema.availability}).`);
      $('#options-state').className='muted';
      optionEditor=createPrintOptionsEditor(schema,{defaults:schema.default_options||{},client:true,format:format.value});
      if(!optionEditor.usable) throw new Error('Schema không có lựa chọn được phép dùng.');
      $('#client-options').replaceChildren(optionEditor.root);
      $('#options-state').textContent=format.value==='zpl'?'ZPL gửi nguyên bản; tùy chọn driver PDF không áp dụng.':'Chỉ các lựa chọn được quản trị cấp mới xuất hiện. “Dùng mặc định” không gửi ghi đè.';
    } catch(error) { if(loadId===schemaEpoch){currentSchema=null;optionEditor=null;$('#options-state').textContent=`Không thể tải tùy chọn máy in: ${error.message}`;$('#options-state').className='bad';} }
  }
  async function loadPrinters(key=apiKey) {
    const items=await request('/api/v1/printers',{},key);
    if(!Array.isArray(items)) throw new Error('Danh sách máy in không hợp lệ.');
    const previous=$('#client-printer').value;
    printers=items; $('#client-printer').replaceChildren(...items.map(item=>{const option=text('option',item.name);option.value=item.id;return option;}));
    if(items.some(x=>x.id===previous)) $('#client-printer').value=previous;
    $('#no-printers').hidden=items.length>0; await refreshPrinterState(key);
  }
  async function loadJobs() {
    if(reading || !apiKey) return;
    reading=true; const currentEpoch=epoch;
    try {
      const jobs=await request('/api/v1/jobs?limit=50');
      if(!Array.isArray(jobs)) throw new Error('Danh sách lệnh không hợp lệ.');
      $('#client-jobs').replaceChildren();
      for(const job of jobs) {
        const card=text('article','', 'item-card');
        const heading=text('div','', 'item-heading');heading.append(text('h3',job.title),text('span',labels[job.status] || job.status,`status-${job.status}`));
        card.append(heading,text('p',`${job.format?.toUpperCase()} · ${job.copies} bản · ${job.accepted_at}`,'muted'),text('p',`Mã lệnh: ${job.job_id}`));
        if(job.reason) card.append(text('p',job.reason,job.status==='unknown'?'bad':'muted'));
        $('#client-jobs').append(card);
      }
      $('#history-state').textContent=jobs.length?`${jobs.length} lệnh gần nhất của client`:'Chưa có lệnh in.';
      if(jobs.some(job=>active.has(job.status))) {stopPolling();timer=setTimeout(()=>{if(!busy) loadJobs();},4000);}
    } catch(error) {
      if(currentEpoch===epoch) $('#history-state').textContent=`Không tải được lịch sử: ${error.message} Nhấn Làm mới để kiểm tra.`;
    } finally {reading=false;}
  }
  function requestId() {
    // randomUUID requires HTTPS; getRandomValues also works on the approved LAN HTTP listener.
    return 'web-'+[...crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  function capture() {
    const file=$('#client-file').files[0];
    if(!file) throw new Error('Hãy chọn file PDF hoặc ZPL.');
    const format=$('#client-format').value;
    if(!currentSchema || !optionEditor) throw new Error('Schema tùy chọn chưa sẵn sàng; chưa gửi lệnh.');
    const invalid=optionEditor.validate();if(invalid) throw new Error(invalid);
    const optionValues=format==='pdf'?optionEditor.payload().options:{};
    return {id:requestId(),file,printer_id:$('#client-printer').value,format,title:$('#client-title').value.trim(),copies:$('#client-copies').value,options:JSON.stringify(optionValues)};
  }
  async function send() {
    const form=new FormData();
    for(const key of ['printer_id','format','title','copies','options']) form.append(key,pending[key]);
    form.append('file',pending.file,pending.file.name);
    const id=pending.id;
    try {
      const result=await request('/api/v1/jobs',{method:'POST',headers:{'Idempotency-Key':id},body:form});
      if(typeof result.job_id!=='string') throw new Error('Phản hồi thiếu mã lệnh; cần xác minh lại.');
      pending=null;
      notice(`${result.deduplicated?'Server đã nhận trước đó; không tạo lệnh trùng.':'Đã lưu lệnh.'} Mã lệnh: ${result.job_id}. Trạng thái: ${labels[result.status] || result.status}.`);
      $('#client-file').value='';
      await loadJobs();
    } catch(error) {
      // A lost/5xx response may hide durable acceptance. Keep the immutable request, never auto-resend.
      if(error.status>=400 && error.status<500 && error.status!==408) pending=null;
      notice(`${error.message}${pending?' Chưa xác nhận kết quả. Chỉ gửi lại cùng yêu cầu bên dưới.':''}`,true);
    }
  }
  function resetConnection(clearSaved=true) {
    if(clearSaved) forgetKey();
    epoch+=1;schemaEpoch+=1;currentSchema=null;optionEditor=null;stopPolling();apiKey='';printers=[];pending=null;reading=false;
    $('#client-options').replaceChildren();$('#printer-state').textContent='';$('#options-state').textContent='';
    $('#print-form').reset();$('#key-form').reset();$('#client-jobs').replaceChildren();$('#history-state').textContent='';toasts.clear();
    $('#client-workspace').hidden=true;$('#key-panel').hidden=false;updateControls();
  }
  async function connect(candidate,restoring=false) {
    if(!candidate) throw new Error('Nhập API key.');
    if(!restoring) forgetKey();
    apiKey=candidate;const connectionEpoch=++epoch;
    try { await loadPrinters(candidate); }
    catch(error) { resetConnection(!restoring || error.status===401); if(restoring && error.status!==401) $('#api-key').value=candidate; throw error; }
    if(epoch!==connectionEpoch || apiKey!==candidate) return;
    const saved=rememberKey(candidate);
    $('#api-key').value='';$('#key-panel').hidden=true;$('#client-workspace').hidden=false;
    notice(saved?'Đã kết nối. Tải lại trang vẫn giữ client; không tự gửi lệnh in.':'Đã kết nối, nhưng trình duyệt chặn lưu theo tab; tải lại cần nhập key.',!saved);
    await loadJobs();
  }
  function restoreConnection() { const key=rememberedKey(); if(key) action(()=>connect(key,true)); }
  $('#key-form').addEventListener('submit',event=>{event.preventDefault();action(()=>connect($('#api-key').value.trim()));});
  $('#print-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{if(!pending) pending=capture();updateControls();await send();});});
  $('#retry-print').addEventListener('click',()=>action(async()=>{if(pending) await send();}));
  $('#refresh-client').addEventListener('click',()=>action(async()=>{if(!pending) await loadPrinters();await loadJobs();}));
  $('#client-printer').addEventListener('change',()=>{refreshPrinterState();});
  $('#client-format').addEventListener('change',()=>{if(currentSchema){optionEditor=createPrintOptionsEditor(currentSchema,{defaults:currentSchema.default_options||{},client:true,format:$('#client-format').value});$('#client-options').replaceChildren(optionEditor.root);$('#options-state').textContent=$('#client-format').value==='zpl'?'ZPL gửi nguyên bản; tùy chọn driver PDF không áp dụng.':'Chọn “Dùng mặc định” hoặc một giá trị được cấp.';}});
  $('#client-file').addEventListener('change',()=>{const file=$('#client-file').files[0];if(!file) return;const format=file.name.toLowerCase().endsWith('.zpl')?'zpl':'pdf';if([...$('#client-format').options].some(x=>x.value===format) && $('#client-format').value!==format){$('#client-format').value=format;$('#client-format').dispatchEvent(new Event('change'));}});
  $('#disconnect').addEventListener('click',()=>{
    if(busy) return;
    if(pending && !confirm(`Lệnh ${pending.id} có thể đã được nhận. Ngắt kết nối sẽ mất file/mã đang giữ; không gửi lại bằng mã mới khi chưa kiểm tra lịch sử. Vẫn ngắt?`)) return;
    resetConnection();$('#api-key').focus();
  });
  window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{stopPolling();apiKey='';epoch+=1;schemaEpoch+=1;actionGeneration+=1;});
  window.addEventListener('pageshow',event=>{if(event.persisted){busy=false;resetConnection(false);restoreConnection();}});
  updateControls();restoreConnection();
})();
