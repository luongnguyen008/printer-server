// Same-origin client API only. Credentials and pending files never enter storage or URLs.
(() => {
  const $ = selector => document.querySelector(selector);
  const labels = {queued:'Đang chờ',held:'Đang giữ',submitting:'Đang giao',submitted:'Đã giao CUPS',completed:'Hoàn thành (CUPS)',failed:'Thất bại',canceled:'Đã hủy',unknown:'Chưa rõ kết quả'};
  const active = new Set(['queued','held','submitting','submitted']);
  let apiKey = '', printers = [], pending = null, busy = false, epoch = 0, timer = null, reading = false;
  for (const label of document.querySelectorAll('[data-help-key]')) addFieldHelp(label, 'JSON chỉ gồm tùy chọn được máy cho client thay đổi. Ví dụ {"media":"A4"}. Để {} nếu dùng mặc định. Danh sách quyền của máy hiển thị bên dưới; API sẽ kiểm tra giá trị.');
  function text(tag, content, className) { const el=document.createElement(tag); el.textContent=String(content ?? ''); if(className) el.className=className; return el; }
  function notice(message, error = false) { const el=$('#client-notice'); el.textContent=message; el.className=error?'notice error':'notice success'; el.hidden=false; }
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
    busy=true; stopPolling(); updateControls();
    try { await fn(); } catch(error) { notice(error.message,true); }
    finally { busy=false; updateControls(); }
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
        const error=new Error(response.status===401?'API key không hợp lệ hoặc đã bị thu hồi.':detail); error.status=response.status; throw error;
      }
      if(data===null) throw new Error('Server trả dữ liệu không hợp lệ.');
      return data;
    } catch(error) {
      if(error.name==='AbortError') throw new Error('Hết thời gian chờ phản hồi.');
      throw error;
    } finally {clearTimeout(timeout);}
  }
  function refreshPrinterState() {
    const printer=printers.find(x=>x.id===$('#client-printer').value);
    const format=$('#client-format'); const previous=format.value;
    format.replaceChildren(...(printer?.formats || []).map(value=>{const item=text('option',value.toUpperCase());item.value=value;return item;}));
    if(printer?.formats.includes(previous)) format.value=previous;
    $('#printer-state').textContent=printer?.status==='paused'?'Máy đang tạm dừng. Lệnh sẽ được giữ đến khi quản trị cho tiếp tục.':'Được phép xử lý; trạng thái này không xác nhận máy đã in.';
    $('#permitted-options').textContent=`Giá trị được phép: ${JSON.stringify(printer?.allowed_options || {})}`;
  }
  async function loadPrinters(key=apiKey) {
    const items=await request('/api/v1/printers',{},key);
    if(!Array.isArray(items)) throw new Error('Danh sách máy in không hợp lệ.');
    const previous=$('#client-printer').value;
    printers=items; $('#client-printer').replaceChildren(...items.map(item=>{const option=text('option',item.name);option.value=item.id;return option;}));
    if(items.some(x=>x.id===previous)) $('#client-printer').value=previous;
    $('#no-printers').hidden=items.length>0; refreshPrinterState();
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
    const options=JSON.parse($('#client-options').value);
    if(!options || Array.isArray(options) || typeof options!=='object') throw new Error('Tùy chọn phải là một đối tượng JSON.');
    return {id:requestId(),file,printer_id:$('#client-printer').value,format:$('#client-format').value,title:$('#client-title').value.trim(),copies:$('#client-copies').value,options:JSON.stringify(options)};
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
  $('#key-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    const candidate=$('#api-key').value.trim();if(!candidate) throw new Error('Nhập API key.');
    await loadPrinters(candidate);apiKey=candidate;$('#api-key').value='';epoch+=1;
    $('#key-panel').hidden=true;$('#client-workspace').hidden=false;
    notice('Đã kết nối. Chọn file và kiểm tra máy trước khi gửi.');await loadJobs();
  });});
  $('#print-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{if(!pending) pending=capture();updateControls();await send();});});
  $('#retry-print').addEventListener('click',()=>action(async()=>{if(pending) await send();}));
  $('#refresh-client').addEventListener('click',()=>action(async()=>{if(!pending) await loadPrinters();await loadJobs();}));
  $('#client-printer').addEventListener('change',refreshPrinterState);
  $('#client-file').addEventListener('change',()=>{const file=$('#client-file').files[0];if(!file) return;const format=file.name.toLowerCase().endsWith('.zpl')?'zpl':'pdf';if([...$('#client-format').options].some(x=>x.value===format)) $('#client-format').value=format;});
  $('#disconnect').addEventListener('click',()=>{
    if(busy) return;
    if(pending && !confirm(`Lệnh ${pending.id} có thể đã được nhận. Ngắt kết nối sẽ mất file/mã đang giữ; không gửi lại bằng mã mới khi chưa kiểm tra lịch sử. Vẫn ngắt?`)) return;
    epoch+=1;stopPolling();apiKey='';printers=[];pending=null;
    $('#print-form').reset();$('#key-form').reset();$('#client-jobs').replaceChildren();$('#history-state').textContent='';$('#client-notice').hidden=true;
    $('#client-workspace').hidden=true;$('#key-panel').hidden=false;updateControls();$('#api-key').focus();
  });
  window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{stopPolling();apiKey='';});
  window.addEventListener('pageshow',event=>{if(event.persisted){epoch+=1;printers=[];pending=null;$('#print-form').reset();$('#key-form').reset();$('#client-jobs').replaceChildren();$('#client-notice').hidden=true;$('#client-workspace').hidden=true;$('#key-panel').hidden=false;updateControls();}});
  updateControls();
})();
