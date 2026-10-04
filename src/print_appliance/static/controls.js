// Offline, dependency-free form controls shared by create and edit views.
let controlSequence = 0;
function controlNode(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function driverSearchText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
function createDriverPicker(host, id, getEntries, current = '') {
  const input = controlNode('input'); input.type = 'search'; input.id = `${id}-search`;
  input.autocomplete = 'off'; input.required = true; input.placeholder = 'Tìm model hoặc tên driver…';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', `${id}-list`);
  const value = controlNode('input'); value.type = 'hidden'; value.id = id;
  const clear = controlNode('button', '×', 'combo-clear'); clear.type = 'button'; clear.setAttribute('aria-label', 'Xóa lựa chọn driver');
  const field = controlNode('div', null, 'combo-field'); field.append(input, clear);
  const popup = controlNode('div', null, 'combo-popup'); popup.hidden = true;
  const hint = controlNode('div', null, 'combo-hint'); hint.id = `${id}-results`; hint.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', hint.id);
  const list = controlNode('div', null, 'combo-list'); list.id = `${id}-list`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Driver phù hợp');
  popup.append(hint, list); host.classList.add('driver-picker'); host.append(field, value, popup);
  let committed = null, matches = [], active = -1;
  function entries() {
    const all = getEntries();
    return current && !all.some(item => item.id === current)
      ? [{id: current, label: `Driver hiện tại · ${current}`, text: driverSearchText(current)}, ...all] : all;
  }
  function validate() { input.setCustomValidity(value.value ? '' : 'Hãy chọn đúng driver trong danh sách kết quả.'); }
  function close() { popup.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function highlight(index) {
    active = index;
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({block:'nearest'}); }
    else input.removeAttribute('aria-activedescendant');
  }
  function choose(item, focus = true) { committed = item; value.value = item.id; input.value = item.label; validate(); close(); if (focus) input.focus(); }
  function render() {
    const tokens = driverSearchText(input.value === committed?.label ? '' : input.value).trim().split(/\s+/).filter(Boolean);
    const all = entries();
    const filtered = all.filter(item => tokens.every(token => item.text.includes(token)));
    matches = filtered.slice(0, 200);
    const selected = filtered.find(item => item.id === value.value);
    if (selected && !matches.includes(selected)) matches[matches.length - 1] = selected;
    hint.textContent = filtered.length ? `${filtered.length.toLocaleString('vi-VN')} kết quả${filtered.length > 200 ? ' · Hiển thị 200, hãy nhập cụ thể hơn' : ''}` : 'Không tìm thấy driver. Thử từ khóa khác hoặc kiểm tra driver đã cài.';
    const fragment = document.createDocumentFragment();
    matches.forEach((item, index) => {
      const row = controlNode('div', item.label, 'combo-option'); row.id = `${id}-option-${index}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => choose(item)); fragment.append(row);
    });
    list.replaceChildren(fragment); active = -1; input.removeAttribute('aria-activedescendant');
  }
  function open() { render(); popup.hidden = false; input.setAttribute('aria-expanded', 'true'); }
  input.addEventListener('click', open);
  input.addEventListener('input', () => { value.value = ''; validate(); open(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); if (!popup.hidden && active >= 0) choose(matches[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); if (committed) { value.value = committed.id; input.value = committed.label; validate(); } close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (popup.hidden) open();
      if (matches.length) highlight(active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (!popup.hidden && ['Home', 'End'].includes(event.key)) { event.preventDefault(); if (matches.length) highlight(event.key === 'Home' ? 0 : matches.length - 1); }
  });
  host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) close(); });
  clear.addEventListener('click', () => { committed = null; value.value = ''; input.value = ''; validate(); input.focus(); open(); });
  if (current) choose(entries().find(item => item.id === current), false); else validate();
  // Choosing the initial value must not steal focus from the page's active form.
  const picker = {input, value, refresh() { if (!popup.hidden) render(); }, reset() { committed = null; value.value = ''; input.value = ''; validate(); close(); }, close};
  host.picker = picker;
  return picker;
}
function addFieldHelp(label, explanation) {
  if (label.dataset.helpAttached) return;
  label.dataset.helpAttached = 'true';
  const nested = label.querySelector('input,select,textarea');
  if (label.parentElement.classList.contains('settings-grid')) {
    const field = controlNode('div', null, 'setting-field'); label.before(field); field.append(label);
  }
  if (nested) { nested.id ||= `field-${++controlSequence}`; label.htmlFor = nested.id; label.after(nested); }
  const title = label.textContent.trim();
  const row = label.tagName === 'LEGEND' ? label : controlNode('div', null, 'field-label');
  if (row !== label) { label.before(row); row.append(label); }
  const button = controlNode('button', '?', 'help-button'); button.type = 'button'; button.setAttribute('aria-label', `Giải thích: ${title}`);
  const help = controlNode('div', null, 'help-popover'); help.id = `help-${++controlSequence}`; help.setAttribute('popover', 'auto');
  help.append(controlNode('strong', title), controlNode('p', explanation));
  button.setAttribute('popovertarget', help.id); button.setAttribute('aria-controls', help.id); button.setAttribute('aria-expanded', 'false');
  help.addEventListener('toggle', event => button.setAttribute('aria-expanded', String(event.newState === 'open')));
  const close = controlNode('button', 'Đóng', 'secondary'); close.type = 'button'; close.setAttribute('popovertarget', help.id); close.setAttribute('popovertargetaction', 'hide');
  help.append(close); row.append(button, help);
}
const fieldHelp = {
  name: 'Tên để nhận biết trong ứng dụng, ví dụ Canon văn phòng. Đổi tên không đổi địa chỉ máy in, mã định danh hay lệnh đã nhận.',
  formats: 'Chỉ bật định dạng máy và driver thực sự hỗ trợ. PDF là tài liệu; ZPL là ngôn ngữ in nhãn gửi nguyên bản. Ứng dụng không chuyển PDF thành ZPL.',
  driver: 'Driver dịch tài liệu thành dữ liệu mà máy in hiểu. Gõ model hoặc mã PPD rồi chọn một kết quả. Danh sách chỉ gồm driver đã cài trên thiết bị; tìm kiếm không cài driver mới. Không chọn model gần giống nếu chưa xác nhận tương thích.',
  uri: 'Địa chỉ mà CUPS dùng để kết nối máy in. Chọn thiết bị đã tìm thấy hoặc nhập địa chỉ LAN trong mục nâng cao. Đổi địa chỉ có thể chuyển lệnh tới máy khác; cấu hình của lệnh đã nhận không tự thay đổi.',
  defaults: 'Đối tượng JSON chứa tùy chọn mặc định, ví dụ {"media":"A4","sides":"one-sided"}. Để {} nếu dùng mặc định của hệ thống in. Tùy chọn phải được driver hỗ trợ. Không nhập số bản sao hay định dạng tài liệu ở đây.',
  allowed: 'JSON quy định các giá trị client được phép thay đổi, ví dụ {"media":["A4","A5"]}. Để {} nếu không cho client ghi đè tùy chọn mặc định. Chỉ khai báo các giá trị driver hỗ trợ.',
  grants: 'Client chỉ được gửi lệnh tới máy được chọn và xem lệnh của chính nó. Có thể chưa cấp máy nào. Mở danh sách, tìm tên và tích từng máy. Các thẻ phía ngoài thể hiện máy đã chọn; bấm × để bỏ cấp. Thay đổi quyền không hủy lệnh đã nhận.',
  client: 'Tên ứng dụng sử dụng API, ví dụ Odoo kho. Client không phải tài khoản quản trị. Mỗi client có API key riêng; đổi tên không đổi key hay quyền máy in.',
  queue: 'Hàng đợi đã có trong CUPS, tức hệ thống in trên thiết bị. Đăng ký chỉ tạo liên kết trong ứng dụng, không cài driver hay sửa hàng đợi. Máy bắt đầu ở trạng thái tạm dừng trong ứng dụng.',
};

// Multiple printer grants: explicit checkboxes, never an implicit first selection.
function createPrinterGrantPicker(host, id, getEntries, initial = []) {
  const selected = new Set(initial);
  const toggle = controlNode('button', 'Chọn máy in', 'grant-toggle secondary'); toggle.type = 'button'; toggle.id = `${id}-toggle`;
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', `${id}-popup`);
  const chips = controlNode('div', null, 'grant-chips');
  const count = controlNode('p', null, 'muted grant-count'); count.setAttribute('role', 'status');
  const popup = controlNode('div', null, 'grant-popup'); popup.id = `${id}-popup`; popup.hidden = true;
  const search = controlNode('input'); search.type = 'search'; search.className = 'picker-search'; search.placeholder = 'Tìm tên máy…'; search.setAttribute('aria-label', 'Tìm máy được cấp');
  const list = controlNode('div', null, 'grant-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Máy được cấp'); popup.append(search, list);
  host.classList.add('grant-picker'); host.append(toggle, chips, count, popup);
  const entries = () => getEntries();
  const close = () => { popup.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  function changed() { render(); host.dispatchEvent(new Event('change', {bubbles:true})); }
  function renderChips() {
    const all = entries(); chips.replaceChildren();
    for (const value of selected) {
      const name = all.find(x => x.id === value)?.name || 'Máy không còn trong danh sách';
      const chip = controlNode('span', null, 'grant-chip'); chip.append(controlNode('span', name));
      const remove = controlNode('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Bỏ cấp: ${name}`);
      remove.addEventListener('click', () => { selected.delete(value); changed(); toggle.focus(); }); chip.append(remove); chips.append(chip);
    }
    count.textContent = selected.size ? `Đã chọn ${selected.size} máy` : 'Chưa cấp máy nào';
    toggle.textContent = selected.size ? 'Thay đổi máy được cấp ▾' : 'Chọn máy in ▾';
  }
  function render() {
    renderChips(); const all=entries();
    const filtered = all.filter(x => driverSearchText(x.name).includes(driverSearchText(search.value)));
    list.replaceChildren();
    if (!filtered.length) list.append(controlNode('p', all.length ? 'Không có máy phù hợp.' : 'Chưa có máy in đăng ký.', 'muted'));
    for (const entry of filtered.slice(0, 200)) {
      const label = controlNode('label', null, 'check'); const check = controlNode('input'); check.type = 'checkbox'; check.value = entry.id; check.checked = selected.has(entry.id);
      check.addEventListener('change', () => { if (check.checked) selected.add(entry.id); else selected.delete(entry.id); renderChips(); host.dispatchEvent(new Event('change', {bubbles:true})); });
      label.append(check, controlNode('span', entry.name)); list.append(label);
    }
    if (filtered.length > 200) list.append(controlNode('p', 'Hiển thị 200 máy. Hãy nhập tên cụ thể hơn.', 'muted'));
  }
  toggle.addEventListener('click', () => { if (!popup.hidden) close(); else { render(); popup.hidden = false; toggle.setAttribute('aria-expanded', 'true'); search.focus(); } });
  search.addEventListener('input', render);
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); toggle.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); if (event.target.type === 'checkbox') event.target.click(); }
    if (['ArrowDown','ArrowUp'].includes(event.key)) {
      const controls = [search, ...list.querySelectorAll('input')]; const i = controls.indexOf(document.activeElement);
      event.preventDefault(); controls[(i + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length]?.focus();
    }
  });
  host.addEventListener('focusout', event => {
    // Do not collapse the in-flow popup between pointerdown and pointerup on Save.
    if (!host.contains(event.relatedTarget) && event.relatedTarget?.closest('form') !== host.closest('form')) close();
  });
  const outside = event => { if (!host.contains(event.target)) close(); }; document.addEventListener('click', outside);
  const picker = {values:() => [...selected], refresh:render, reset(){selected.clear();search.value='';close();render();}, destroy(){document.removeEventListener('click',outside);}, toggle};
  host.picker = picker; render(); return picker;
}

function createToasts(host) {
  host.className = 'toast-region'; host.removeAttribute('role'); host.removeAttribute('aria-live'); host.setAttribute('aria-label', 'Thông báo'); host.setAttribute('popover', 'manual'); host.hidden = false;
  const records = new Map();
  function display() { if (!host.children.length) { if (host.matches(':popover-open')) host.hidePopover(); return; } if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); }
  function dismiss(item) { const record=records.get(item); if(record)clearTimeout(record.timer); records.delete(item);item.remove();display(); }
  function show(message, kind='info') {
    for (const [item, record] of records) if (record.message === message && record.kind === kind) return;
    if (records.size >= 1) dismiss(records.keys().next().value);
    const item=controlNode('div',null,`toast ${kind}`); item.setAttribute('role',kind==='error'?'alert':'status');
    item.append(controlNode('span',message)); const close=controlNode('button','×','toast-close');close.type='button';close.setAttribute('aria-label','Đóng thông báo');item.append(close);
    const record={message,kind,timer:null}; records.set(item,record);
    const pause=()=>clearTimeout(record.timer); const start=()=>{pause();if(kind!=='error')record.timer=setTimeout(()=>dismiss(item),5000);};
    item.addEventListener('pointerenter',pause);item.addEventListener('pointerleave',start);item.addEventListener('focusin',pause);item.addEventListener('focusout',start);close.addEventListener('click',()=>dismiss(item));
    host.append(item);display();start();
  }
  return {show,clear(){for(const item of [...records.keys()])dismiss(item);},mount(parent){parent.append(host);display();}};
}

function createEntityModal({busy=()=>false, toasts}={}) {
  const dialog=controlNode('dialog',null,'entity-modal');dialog.id='entity-modal';dialog.setAttribute('aria-labelledby','modal-title');
  const header=controlNode('header',null,'modal-header');const title=controlNode('h2');title.id='modal-title';title.tabIndex=-1;
  const close=controlNode('button','×','quiet');close.type='button';close.setAttribute('aria-label','Đóng modal');header.append(title,close);
  const body=controlNode('div',null,'modal-content');const footer=controlNode('div',null,'modal-footer');const cancel=controlNode('button','Hủy','secondary');cancel.type='button';footer.append(cancel);
  dialog.append(header,body,footer);document.body.append(dialog);
  let state=null;
  function requestClose(force=false) {
    if(!state || (!force && busy()))return false;
    if(!force && state.dirty && !confirm('Bạn có thay đổi chưa lưu. Bỏ thay đổi và đóng?'))return false;
    const old=state;state=null;dialog.close();toasts?.mount(document.body);
    if(old.parent){old.parent.append(old.content);old.content.hidden=true;}else{old.content._cleanup?.();old.content.replaceChildren();}
    body.replaceChildren();old.onClose?.();old.trigger?.isConnected && old.trigger.focus();return true;
  }
  function open(caption,content,{onClose,keep=false,readOnly=false}={}) {
    if(state && !requestClose(true))return;
    state={content,parent:keep?content.parentElement:null,trigger:document.activeElement,dirty:false,onClose};
    title.textContent=caption;cancel.textContent=readOnly?'Đóng':'Hủy';content.hidden=false;content.classList.remove('hidden');body.replaceChildren(content);dialog.showModal();toasts?.mount(dialog);title.focus();
  }
  dialog.addEventListener('input',event=>{if(state && event.target.closest('form') && !event.target.classList.contains('picker-search'))state.dirty=true;});
  dialog.addEventListener('change',event=>{if(state && event.target.closest('form'))state.dirty=true;});
  dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
  close.addEventListener('click',()=>requestClose());cancel.addEventListener('click',()=>requestClose());
  return {open,close:requestClose,dialog,clearDirty(){if(state)state.dirty=false;},get isOpen(){return !!state;}};
}
