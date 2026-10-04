const $ = (selector, root = document) => root.querySelector(selector);
const notice = $("#notice");
let csrfToken = "";
let printerData = [];
let clientData = [];
let discoveryData = null;
let driverIndex = [];
let sessionEpoch = 0;
let actionPending = false;
let settingsDirty = false;

// Serialize UI actions. A network failure may have happened after the server
// applied a mutation: never auto-retry a create/delete/control request.
function bindAction(element, eventName, handler) {
  element.addEventListener(eventName, event => runAction(element, event, handler));
}
async function runAction(element, event, handler) {
    event.preventDefault();
    if (actionPending) return;
    actionPending = true;
    const before = new Map();
    const trigger = event.submitter || (element.tagName === 'BUTTON' ? element : null);
    const caption = trigger?.textContent;
    const disable = () => {
      document.querySelectorAll('input:not([type="hidden"]),select,textarea,button:not([role="tab"]):not(.help-button)').forEach(control => {
        if (!before.has(control)) before.set(control, control.disabled);
        if (!control.disabled) control.disabled = true;
      });
    };
    disable();
    const observer = new MutationObserver(disable);
    observer.observe(document.body, {childList:true, subtree:true});
    element.setAttribute('aria-busy', 'true');
    if (trigger) trigger.textContent = 'Đang xử lý…';
    $('#busy-status').hidden = false;
    try { await handler(event); }
    catch (error) { showNotice(error.message, 'error'); }
    finally {
      observer.disconnect();
      for (const [control, wasDisabled] of before) control.disabled = wasDisabled;
      element.removeAttribute('aria-busy');
      if (trigger) trigger.textContent = caption;
      $('#busy-status').hidden = true;
      actionPending = false;
    }
}
function installHelp(root = document) {
  for (const label of root.querySelectorAll('[data-help], [data-help-key]')) {
    addFieldHelp(label, label.dataset.help || fieldHelp[label.dataset.helpKey]);
  }
}
function closeEditor(form) { const details = form.closest('details'); if (details) details.open = false; }
function updateCards(target, records, render) {
  const editing = new Map([...target.querySelectorAll(':scope > article[data-id]')].filter(card => card.querySelector('details[open]')).map(card => [card.dataset.id, card]));
  target.replaceChildren(...records.map(record => editing.get(record.id) || render(record)));
}
function resetSession() {
  sessionEpoch += 1; csrfToken = ''; printerData = []; clientData = []; discoveryData = null; driverIndex = [];
  for (const id of ['printers','clients','jobs','job-details','system-status','job-counts']) document.getElementById(id).replaceChildren();
  for (const form of document.forms) form.reset();
  createPicker.reset(); settingsDirty = false;
  $('#discovery').classList.add('hidden');
  $('#dashboard').classList.add('hidden'); $('#logout').classList.add('hidden'); $('#login-panel').classList.remove('hidden');
}

function showNotice(message, kind = "info") {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
}
function clearNotice() { notice.hidden = true; notice.textContent = ""; }
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function option(select, value, label) {
  const item = node("option", label);
  item.value = value;
  select.append(item);
}
async function api(path, options = {}) {
  const epoch = sessionEpoch;
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (epoch !== sessionEpoch) throw new Error('Phiên làm việc đã thay đổi. Hãy đăng nhập lại.');
  if (response.status === 401) { clearNotice(); resetSession(); }
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}
function jsonField(value, field) {
  try { return JSON.parse(value); }
  catch { throw new Error(`${field}: JSON không hợp lệ`); }
}
function selectedValues(select) { return [...select.selectedOptions].map(item => item.value); }
function checkedFormats(form, selector = 'input[name="format"]') {
  return [...form.querySelectorAll(selector)].filter(item => item.checked).map(item => item.value);
}

const searchText = driverSearchText;
const createPicker = createDriverPicker($('#driver-picker'), 'driver', () => driverIndex);
installHelp();

const adminTabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
function activateTab(name, updateHash = true) {
  if (!adminTabs.some(tab => tab.dataset.tab === name)) name = "overview";
  for (const tab of adminTabs) {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  }
  if (updateHash) history.replaceState(null, "", `#tab=${name}`);
}
function tabFromHash() { return location.hash.startsWith("#tab=") ? location.hash.slice(5) : "overview"; }
for (const [index, tab] of adminTabs.entries()) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", event => {
    const keys = { ArrowRight: (index + 1) % adminTabs.length, ArrowLeft: (index + adminTabs.length - 1) % adminTabs.length, Home: 0, End: adminTabs.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = adminTabs[keys[event.key]];
    activateTab(next.dataset.tab); next.focus();
  });
}
window.addEventListener("hashchange", () => activateTab(tabFromHash(), false));
activateTab(tabFromHash(), false);


async function checkSession() {
  try {
    const session = await api("/admin/api/session");
    csrfToken = session.csrf_token || "";
    $("#login-panel").classList.toggle("hidden", session.authenticated);
    $("#dashboard").classList.toggle("hidden", !session.authenticated);
    $("#logout").classList.toggle("hidden", !session.authenticated);
    if (session.authenticated) await refreshAll();
  } catch (error) {
    showNotice(`Không thể kiểm tra phiên: ${error.message}`, "error");
  }
}
async function refreshAll() {
  // Client grant controls depend on the printer list; do not race these fetches.
  await loadPrinters();
  await Promise.all([loadStatus(), loadClients(), loadJobs(), loadSettings()]);
}
async function loadStatus() {
  const target = $("#system-status");
  target.textContent = "Đang tải trạng thái…";
  try {
    const value = await api("/admin/api/status");
    target.replaceChildren();
    const state = node("p", `CUPS: ${value.cups.available ? "kết nối" : "không sẵn sàng"}`, value.cups.available ? "good" : "bad");
    target.append(state, node("p", `Đĩa còn ${formatBytes(value.disk.free_bytes)} / ${formatBytes(value.disk.total_bytes)}`));
    target.append(node("p", value.cups.message || ""));
    $("#job-counts").textContent = `Chờ ${value.jobs.queued} · Giữ ${value.jobs.held} · CUPS ${value.jobs.submitted} · Chưa rõ ${value.jobs.unknown}`;
  } catch (error) { target.textContent = `Lỗi tải trạng thái: ${error.message}`; }
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "không rõ";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
async function loadPrinters() {
  const target = $("#printers");
  if (!target.children.length) target.textContent = "Đang tải danh sách máy in…";
  try {
    printerData = await api("/admin/api/printers");
    const selection = $("#client-printers");
    const selectedBeforeRefresh = new Set(selectedValues(selection));
    selection.replaceChildren();
    for (const printer of printerData) {
      option(selection, printer.id, `${printer.name} (${printer.queue})`);
      selection.options[selection.options.length - 1].selected = selectedBeforeRefresh.has(printer.id);
    }
    updateCards(target, printerData, renderPrinter);
    if (!printerData.length) target.append(node('p', 'Chưa có máy in. Chọn “Thêm máy in” để bắt đầu.'));
  } catch (error) { showNotice(`Lỗi tải máy in: ${error.message}`, "error"); }
}
function renderPrinter(printer) {
  const card = node("article", null, "item-card");
  card.dataset.id = printer.id;
  const heading = node("div", null, "item-heading");
  heading.append(node("h3", printer.name), node("span", printer.paused ? "Đang tạm dừng" : "Cho phép xử lý", printer.paused ? "pill bad" : "pill good"));
  card.append(heading);
  card.append(node("p", `Hàng đợi: ${printer.queue} · ${printer.managed ? "Ứng dụng tạo" : "Cấu hình có sẵn"}`));
  card.append(node("p", `Định dạng: ${printer.formats.join(", ").toUpperCase()} · URI: ${printer.device_uri || "không có"}`));
  if (printer.pause_reason) card.append(node("p", `Lý do tạm dừng: ${printer.pause_reason}`, "bad"));
  const actions = node("div", null, "button-row");
  const toggle = node("button", printer.paused ? "Tiếp tục máy in" : "Tạm dừng máy in");
  toggle.type = "button";
  bindAction(toggle, "click", () => printerAction(printer, printer.paused ? "resume" : "pause"));
  const remove = node('button', 'Gỡ đăng ký', 'danger'); remove.type = 'button';
  bindAction(remove, 'click', async () => {
    if (!confirm(`Gỡ “${printer.name}” khỏi ứng dụng?\nCấu hình CUPS và lịch sử vẫn được giữ. Không thể gỡ nếu còn lệnh chưa kết thúc.`)) return;
    await api(`/admin/api/printers/${encodeURIComponent(printer.id)}`, {method:'DELETE'});
    showNotice('Đã gỡ đăng ký. Hàng đợi CUPS không thay đổi.', 'success');
    await loadPrinters(); await loadClients();
  });
  actions.append(toggle, remove);
  const details = node("details");
  const summary = node("summary", "Sửa cấu hình");
  details.append(summary, renderPrinterEdit(printer));
  card.append(actions, details);
  return card;
}
function renderPrinterEdit(printer) {
  const form = node('form', null, 'edit-form');
  function field(text, control, help) {
    const label = node('label', text); control.id ||= `edit-${printer.id}-${form.querySelectorAll('label').length}`; label.htmlFor = control.id;
    form.append(label, control); addFieldHelp(label, help); return control;
  }
  const name = node('input'); name.value = printer.name; name.required = true; name.maxLength = 120;
  field('Tên hiển thị', name, fieldHelp.name);
  const formatsWrap = node('fieldset'); const legend = node('legend', 'Định dạng nhận'); formatsWrap.append(legend);
  for (const format of ['pdf', 'zpl']) {
    const label = node('label', null, 'check'); const check = node('input'); check.type = 'checkbox'; check.value = format; check.checked = printer.formats.includes(format);
    label.append(check, document.createTextNode(` ${format.toUpperCase()}`)); formatsWrap.append(label);
  }
  form.append(formatsWrap); addFieldHelp(legend, fieldHelp.formats);
  let uri, picker;
  if (printer.managed) {
    uri = node('input'); uri.value = printer.device_uri; uri.required = true;
    field('Địa chỉ thiết bị', uri, fieldHelp.uri);
    const label = node('label', 'Driver'); const host = node('div');
    label.htmlFor = `driver-${printer.id}-search`; form.append(label, host); addFieldHelp(label, fieldHelp.driver);
    picker = createDriverPicker(host, `driver-${printer.id}`, () => driverIndex, printer.driver);
    const reload = node('button', 'Cập nhật danh sách driver', 'text-button'); reload.type = 'button';
    bindAction(reload, 'click', () => discover(false)); form.append(reload);
  }
  const advanced = node('details', null, 'advanced'); advanced.append(node('summary', 'Nâng cao'));
  const defaults = node('textarea'); defaults.value = JSON.stringify(printer.default_options); defaults.rows = 2;
  const allowed = node('textarea'); allowed.value = JSON.stringify(printer.allowed_options); allowed.rows = 2;
  for (const [control, text, help, suffix] of [[defaults, 'Tùy chọn mặc định (JSON)', fieldHelp.defaults, 'defaults'], [allowed, 'Tùy chọn client được đổi (JSON)', fieldHelp.allowed, 'allowed']]) {
    const label = node('label', text); control.id = `${suffix}-${printer.id}`; label.htmlFor = control.id; advanced.append(label, control); addFieldHelp(label, help);
  }
  form.append(advanced);
  const save = node('button', 'Lưu cấu hình'); save.type = 'submit'; form.append(save);
  bindAction(form, 'submit', async () => {
    if (picker && !picker.value.value) throw new Error('Hãy chọn driver trong danh sách.');
    const data = {name:name.value, formats:[...formatsWrap.querySelectorAll('input')].filter(x => x.checked).map(x => x.value), default_options:jsonField(defaults.value, 'Tùy chọn mặc định'), allowed_options:jsonField(allowed.value, 'Tùy chọn client được đổi')};
    if (uri && uri.value !== printer.device_uri) data.device_uri = uri.value;
    if (picker && picker.value.value !== printer.driver) data.driver = picker.value.value;
    await api(`/admin/api/printers/${encodeURIComponent(printer.id)}`, {method:'PUT', body:JSON.stringify(data)});
    closeEditor(form); showNotice('Đã lưu cấu hình máy in.', 'success'); await loadPrinters();
  });
  return form;
}
async function printerAction(printer, action) {
  try {
    await api(`/admin/api/printers/${encodeURIComponent(printer.id)}/${action}`, { method: "POST", body: "{}" });
    showNotice(action === "pause" ? "Đã yêu cầu tạm dừng CUPS." : "Đã tiếp tục CUPS; hàng đợi có thể tiến FIFO.", "success");
    await Promise.all([loadPrinters(), loadStatus()]);
  } catch (error) { showNotice(`Thao tác máy in thất bại: ${error.message}`, "error"); }
}
async function discover(showForm = true) {
  $('#discovery-state').textContent = 'Đang tìm thiết bị và driver…';
  try {
    discoveryData = await api('/admin/api/discovery');
    const device = $('#device-uri'), queue = $('#existing-queue');
    const deviceBefore = device.value, queueBefore = queue.value;
    device.replaceChildren(); queue.replaceChildren();
    option(device, '', 'Chọn thiết bị…'); option(queue, '', 'Chọn hàng đợi…');
    for (const item of discoveryData.devices) option(device, item.uri, `${item.info || item.make_model || item.uri} · ${item.uri}`);
    device.value = deviceBefore;
    driverIndex = discoveryData.drivers.map(item => ({id:item.id, label:`${item.make_model} · ${item.id}`, text:searchText(`${item.make_model} ${item.id}`)}));
    for (const host of document.querySelectorAll('.driver-picker')) host.picker.refresh();
    const registered = new Set(printerData.map(printer => printer.queue));
    for (const name of Object.keys(discoveryData.queues).filter(name => !registered.has(name))) option(queue, name, name);
    queue.value = queueBefore;
    if (showForm) $('#discovery').classList.remove('hidden');
    $('#discovery-state').textContent = `${discoveryData.devices.length} thiết bị · ${discoveryData.drivers.length.toLocaleString('vi-VN')} driver đã cài`;
  } catch (error) {
    $('#discovery-state').textContent = `Không tải được từ CUPS: ${error.message}`;
    throw error;
  }
}
async function loadClients() {
  const target = $("#clients"); if (!target.children.length) target.textContent = "Đang tải clients…";
  try {
    clientData = await api("/admin/api/clients"); updateCards(target, clientData, renderClient);
    if (!clientData.length) target.append(node("p", "Chưa có client API."));

  } catch (error) { showNotice(`Lỗi tải clients: ${error.message}`, "error"); }
}
function renderClient(client) {
  const card = node("article", null, "item-card");
  card.dataset.id = client.id;
  const head = node("div", null, "item-heading"); head.append(node("h3", client.name), node("span", client.revoked ? "Đã thu hồi" : "Hoạt động", client.revoked ? "pill bad" : "pill good"));
  card.append(head, node("p", `ID: ${client.id}`));
  const details = node('details'); details.append(node('summary', 'Sửa client'));
  const form = node('form', null, 'edit-form');
  const nameLabel = node('label', 'Tên client'); const name = node('input'); name.id = `client-name-${client.id}`; name.value = client.name; name.required = true; name.maxLength = 120; nameLabel.htmlFor = name.id;
  form.append(nameLabel, name); addFieldHelp(nameLabel, fieldHelp.client);
  const label = node("label", "Máy được cấp"); const select = node("select"); select.multiple = true; select.size = Math.min(5, Math.max(2, printerData.length));
  for (const printer of printerData) {
    option(select, printer.id, printer.name);
    select.options[select.options.length - 1].selected = client.printer_ids.includes(printer.id);
  }
  label.append(select); form.append(label); addFieldHelp(label, fieldHelp.grants);
  const grant = node("button", "Lưu client"); grant.type = "submit"; form.append(grant);
  bindAction(form, "submit", async event => {
    event.preventDefault();
    try {
      const payload = {name: name.value};
      const grants = selectedValues(select);
      if (JSON.stringify([...grants].sort()) !== JSON.stringify([...client.printer_ids].sort())) payload.printer_ids = grants;
      await api(`/admin/api/clients/${encodeURIComponent(client.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      closeEditor(form); showNotice("Đã lưu client.", "success"); await loadClients();
    } catch (error) { showNotice(error.message, "error"); }
  });
  const actions = node("div", null, "button-row");
  const rotate = node("button", "Đổi API key", "secondary"); rotate.type = "button";
  bindAction(rotate, 'click', () => {
    if (confirm(`Đổi API key của “${client.name}”? Key cũ sẽ ngừng hoạt động ngay.`)) return clientAction(client.id, 'rotate-key', 'Đã tạo API key mới');
  });
  const revoke = node("button", "Thu hồi key", "danger"); revoke.type = "button";
  revoke.disabled = client.revoked; bindAction(revoke, 'click', () => {
    if (confirm(`Thu hồi key của “${client.name}”? Ứng dụng này sẽ không gửi được yêu cầu mới.`)) return clientAction(client.id, 'revoke', 'Đã thu hồi client key');
  });
  const remove = node('button', 'Xóa client', 'danger'); remove.type = 'button';
  bindAction(remove, 'click', async () => {
    if (!confirm(`Xóa “${client.name}”? API key sẽ mất hiệu lực.\nLịch sử vẫn giữ. Không thể xóa nếu còn lệnh chưa kết thúc.`)) return;
    await api(`/admin/api/clients/${encodeURIComponent(client.id)}`, {method:'DELETE'});
    showNotice('Đã xóa client và vô hiệu hóa key.', 'success'); await loadClients();
  });
  actions.append(rotate, revoke, remove); details.append(form); card.append(details, actions); return card;
}
async function clientAction(id, action, message) {
  try {
    const result = await api(`/admin/api/clients/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
    if (result.api_key) showNotice(`${message}. Sao chép ngay; key chỉ xuất hiện lần này: ${result.api_key}`, "success");
    else showNotice(message, "success");
    await loadClients();
  } catch (error) { showNotice(`Client action thất bại: ${error.message}`, "error"); }
}
async function loadJobs() {
  const target = $("#jobs"); target.textContent = "Đang tải lệnh in…";
  try {
    const jobs = await api("/admin/api/jobs?limit=100");
    target.replaceChildren();
    if (!jobs.length) target.append(node("p", "Chưa có lệnh in."));
    const table = node("table"); const thead = node("thead"); const header = node("tr");
    for (const text of ["Lệnh", "Client / máy", "Trạng thái", "Nhận lúc", "Chi tiết"]) header.append(node("th", text));
    thead.append(header); table.append(thead); const tbody = node("tbody");
    for (const job of jobs) {
      const row = node("tr");
      row.append(node("td", `${job.title} · ${job.format.toUpperCase()} × ${job.copies}`));
      row.append(node("td", `${job.client_name} / ${job.printer_name}`));
      row.append(node("td", job.status, `status-${job.status}`));
      row.append(node("td", job.accepted_at));
      const cell = node("td"); const detail = node("button", "Xem"); detail.type = "button"; detail.className = "text-button";
      bindAction(detail, "click", () => showJob(job)); cell.append(detail); row.append(cell); tbody.append(row);
    }
    table.append(tbody); target.append(table);
  } catch (error) { target.textContent = `Lỗi tải lệnh in: ${error.message}`; }
}
async function showJob(summary) {
  const target = $("#job-details"); target.classList.remove("hidden"); target.textContent = "Đang tải chi tiết…";
  try {
    const job = await api(`/admin/api/jobs/${encodeURIComponent(summary.job_id)}`);
    target.replaceChildren(node("h3", `Chi tiết ${job.job_id}`));
    target.append(node("p", `${job.status}: ${job.reason || "Không có lỗi được ghi nhận"}`));
    target.append(node("h4", "Cấu hình khi nhận"), node("pre", JSON.stringify(job.printer_snapshot, null, 2)));
    if (job.cups_job_id) target.append(node("p", `CUPS job ID: ${job.cups_job_id}`));
    const pre = node("pre", JSON.stringify(job.events, null, 2)); target.append(node("h4", "Sự kiện"), pre);
    const actions = node("div", null, "button-row");
    if (["queued", "held", "submitted", "unknown"].includes(job.status)) {
      const cancel = node("button", "Hủy lệnh", "danger"); cancel.type = "button";
      bindAction(cancel, "click", async () => {
        if (!confirm("Hủy lệnh này? Phần đã in không thể thu hồi.")) return;
        try { await api(`/admin/api/jobs/${encodeURIComponent(job.job_id)}/cancel`, { method: "POST", body: "{}" }); showNotice("Yêu cầu hủy đã được xử lý theo bằng chứng CUPS.", "success"); await refreshAll(); await showJob(job); }
        catch (error) { showNotice(`Không xác nhận được hủy: ${error.message}`, "error"); }
      }); actions.append(cancel);
    }
    if (["queued", "held", "submitted"].includes(job.status)) {
      const resume = node("button", "Tiếp tục riêng lệnh này", "secondary"); resume.type = "button";
      bindAction(resume, "click", async () => {
        try { await api(`/admin/api/jobs/${encodeURIComponent(job.job_id)}/resume`, { method: "POST", body: "{}" }); showNotice("Chỉ lệnh được chọn đã được tiếp tục.", "success"); await refreshAll(); await showJob(job); }
        catch (error) { showNotice(`Không thể tiếp tục lệnh: ${error.message}`, "error"); }
      }); actions.append(resume);
    }
    if (job.status === "unknown") {
      const form = node("form", null, "edit-form");
      const outcome = node("select"); for (const value of ["completed", "failed", "canceled"]) option(outcome, value, value);
      const reason = node("textarea"); reason.rows = 3; reason.required = true; reason.minLength = 8; reason.placeholder = "Ghi bằng chứng / lý do xử lý (tối thiểu 8 ký tự)";
      const outcomeLabel = node("label", "Kết quả xác minh"); outcomeLabel.htmlFor = "resolve-outcome"; outcome.id = "resolve-outcome";
      const reasonLabel = node("label", "Bằng chứng"); reasonLabel.htmlFor = "resolve-reason"; reason.id = "resolve-reason";
      form.append(outcomeLabel, outcome, reasonLabel, reason);
      addFieldHelp(outcomeLabel, "Chọn kết quả đã xác minh của lệnh chưa rõ kết quả. Thao tác chỉ ghi nhận, không gửi lại để in.");
      addFieldHelp(reasonLabel, "Ghi bằng chứng kiểm tra thực tế hoặc phản hồi hệ thống in (8–1000 ký tự). Không suy đoán thất bại để gửi lại vì có thể gây in trùng.");
      reason.maxLength = 1000;
      const resolve = node("button", "Ghi nhận xác minh (không gửi lại)"); resolve.type = "submit"; form.append(resolve);
      bindAction(form, "submit", async event => {
        event.preventDefault();
        try { await api(`/admin/api/jobs/${encodeURIComponent(job.job_id)}/resolve`, { method: "POST", body: JSON.stringify({ outcome: outcome.value, reason: reason.value }) }); showNotice("Đã ghi nhận xử lý unknown; không gửi lại job.", "success"); await refreshAll(); await showJob(job); }
        catch (error) { showNotice(error.message, "error"); }
      }); target.append(form);
    }
    target.append(actions);
  } catch (error) { target.textContent = `Không tải được chi tiết: ${error.message}`; }
}
async function loadSettings() {
  try {
    const data = await api("/admin/api/settings");
    if (!settingsDirty) for (const [key, value] of Object.entries(data)) $("#settings-form").elements.namedItem(key).value = value;
  } catch (error) { showNotice(`Không tải được giới hạn: ${error.message}`, "error"); }
}

bindAction($("#login-form"), "submit", async event => {
  event.preventDefault(); clearNotice();
  try {
    const response = await fetch("/admin/api/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#password").value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Login failed (${response.status})`);
    csrfToken = data.csrf_token; $("#password").value = "";
    $("#login-panel").classList.add("hidden"); $("#dashboard").classList.remove("hidden"); $("#logout").classList.remove("hidden");
    showNotice("Đăng nhập thành công.", "success"); await refreshAll();
  } catch (error) { showNotice(`Đăng nhập thất bại: ${error.message}`, "error"); }
});
bindAction($("#logout"), "click", async () => {
  try { await api("/admin/api/logout", { method: "POST", body: "{}" }); }
  catch (error) { showNotice(`Đăng xuất chưa được xác nhận: ${error.message}`, "error"); return; }
  clearNotice(); resetSession(); activateTab('overview');
});
bindAction($('#discover'), 'click', () => discover());
for (const [id, importing] of [['new-printer-mode', false], ['import-printer-mode', true]]) {
  document.getElementById(id).addEventListener('click', () => {
    $('#managed-printer-form').hidden = importing; $('#import-form').hidden = !importing;
    $('#new-printer-mode').setAttribute('aria-pressed', String(!importing)); $('#import-printer-mode').setAttribute('aria-pressed', String(importing));
  });
}
$('#close-add').addEventListener('click', () => { $('#discovery').classList.add('hidden'); $('#discover').focus(); });
bindAction($("#managed-printer-form"), "submit", async event => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    if (!$("#driver").value) throw new Error("Hãy chọn driver trong danh sách.");
    if (!$("#manual-uri").value.trim() && !$("#device-uri").value) throw new Error("Hãy chọn thiết bị hoặc nhập địa chỉ mạng.");
    const payload = {
      name: $("#printer-name").value, device_uri: $("#manual-uri").value.trim() || $("#device-uri").value, driver: $("#driver").value,
      formats: checkedFormats(form), default_options: jsonField($("#default-options").value, "Default options"),
      allowed_options: jsonField($("#allowed-options").value, "Allowed options"),
    };
    await api("/admin/api/printers", { method: "POST", body: JSON.stringify(payload) });
    showNotice("Đã tạo queue được quản lý; không xóa hay chiếm queue cũ.", "success");
    form.reset(); createPicker.reset(); await loadPrinters(); await loadStatus(); await discover();
  } catch (error) { showNotice(`Không tạo được máy in: ${error.message}`, "error"); }
});
bindAction($("#import-form"), "submit", async event => {
  event.preventDefault();
  try {
    const payload = { queue: $("#existing-queue").value, name: $("#import-name").value, formats: checkedFormats(event.currentTarget, 'input[name="import-format"]') };
    await api("/admin/api/printers/import", { method: "POST", body: JSON.stringify(payload) });
    showNotice("Đã nhập queue nguyên trạng; CUPS chưa bị sửa.", "success"); await loadPrinters(); await discover();
  } catch (error) { showNotice(`Không nhập được queue: ${error.message}`, "error"); }
});
bindAction($("#client-form"), "submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/admin/api/clients", { method: "POST", body: JSON.stringify({ name: $("#client-name").value, printer_ids: selectedValues($("#client-printers")) }) });
    $("#client-name").value = "";
    showNotice(`Client đã tạo. Sao chép API key này ngay; key chỉ xuất hiện một lần: ${result.api_key}`, "success"); await loadClients();
  } catch (error) { showNotice(`Không tạo được client: ${error.message}`, "error"); }
});
bindAction($("#settings-form"), "submit", async event => {
  event.preventDefault();
  try {
    const payload = Object.fromEntries([...event.currentTarget.elements].filter(control => control.name).map(control => [control.name, control.value]));
    for (const key of Object.keys(payload)) payload[key] = Number(payload[key]);
    await api("/admin/api/settings", { method: "PUT", body: JSON.stringify(payload) });
    settingsDirty = false; showNotice("Đã lưu giới hạn.", "success"); await loadSettings();
  } catch (error) { showNotice(`Không lưu được giới hạn: ${error.message}`, "error"); }
});
bindAction($("#refresh"), "click", refreshAll);
$("#settings-form").addEventListener("input", () => { settingsDirty = true; });
runAction(document.body, new Event("startup"), checkSession);
