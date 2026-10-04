const $ = (selector, root = document) => root.querySelector(selector);
const notice = $("#notice");
let csrfToken = "";
let printerData = [];
let clientData = [];
let discoveryData = null;

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
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    csrfToken = "";
    clearNotice();
    $("#dashboard").classList.add("hidden");
    $("#logout").classList.add("hidden");
    $("#login-panel").classList.remove("hidden");
  }
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
  target.textContent = "Đang tải danh sách máy in…";
  try {
    printerData = await api("/admin/api/printers");
    target.replaceChildren();
    const selection = $("#client-printers");
    const selectedBeforeRefresh = new Set(selectedValues(selection));
    selection.replaceChildren();
    for (const printer of printerData) {
      option(selection, printer.id, `${printer.name} (${printer.queue})`);
      selection.options[selection.options.length - 1].selected = selectedBeforeRefresh.has(printer.id);
    }
    if (!printerData.length) target.append(node("p", "Chưa có máy in đăng ký. Khám phá CUPS hoặc nhập queue hiện có."));
    for (const printer of printerData) target.append(renderPrinter(printer));
  } catch (error) { target.textContent = `Lỗi tải máy in: ${error.message}`; }
}
function renderPrinter(printer) {
  const card = node("article", null, "item-card");
  const heading = node("div", null, "item-heading");
  heading.append(node("h3", printer.name), node("span", printer.paused ? "Đang tạm dừng" : "Cho phép xử lý", printer.paused ? "pill bad" : "pill good"));
  card.append(heading);
  card.append(node("p", `Queue: ${printer.queue} · ${printer.managed ? "managed" : "imported / nguyên trạng"}`));
  card.append(node("p", `Định dạng: ${printer.formats.join(", ").toUpperCase()} · URI: ${printer.device_uri || "không có"}`));
  if (printer.pause_reason) card.append(node("p", `Lý do tạm dừng: ${printer.pause_reason}`, "bad"));
  const actions = node("div", null, "button-row");
  const toggle = node("button", printer.paused ? "Tiếp tục máy in" : "Tạm dừng máy in");
  toggle.type = "button";
  toggle.addEventListener("click", () => printerAction(printer, printer.paused ? "resume" : "pause"));
  actions.append(toggle);
  const details = node("details");
  const summary = node("summary", "Sửa cấu hình hiển thị / allowlist");
  details.append(summary, renderPrinterEdit(printer));
  card.append(actions, details);
  return card;
}
function renderPrinterEdit(printer) {
  const form = node("form", null, "edit-form");
  const nameId = `name-${printer.id}`;
  const nameLabel = node("label", "Tên hiển thị"); nameLabel.htmlFor = nameId;
  const name = node("input"); name.id = nameId; name.value = printer.name; name.required = true; name.maxLength = 120;
  form.append(nameLabel, name);
  const formatsWrap = node("fieldset"); formatsWrap.append(node("legend", "Định dạng"));
  for (const format of ["pdf", "zpl"]) {
    const label = node("label", null, "check"); const check = node("input");
    check.type = "checkbox"; check.value = format; check.checked = printer.formats.includes(format);
    label.append(check, document.createTextNode(` ${format.toUpperCase()}`)); formatsWrap.append(label);
  }
  form.append(formatsWrap);
  const defaultsLabel = node("label", "Default options JSON");
  const defaults = node("textarea"); defaults.rows = 2; defaults.value = JSON.stringify(printer.default_options);
  const allowedLabel = node("label", "Allowed options JSON");
  const allowed = node("textarea"); allowed.rows = 3; allowed.value = JSON.stringify(printer.allowed_options);
  defaults.id = `defaults-${printer.id}`; defaultsLabel.htmlFor = defaults.id;
  allowed.id = `allowed-${printer.id}`; allowedLabel.htmlFor = allowed.id;
  form.append(defaultsLabel, defaults, allowedLabel, allowed);
  if (printer.managed) {
    for (const [key, labelText, current] of [["device_uri", "Thiết bị CUPS", printer.device_uri], ["driver", "Driver", printer.driver]]) {
      const label = node("label", labelText); const select = node("select"); select.dataset.mapping = key;
      option(select, current, current);
      for (const item of discoveryData?.[key === "device_uri" ? "devices" : "drivers"] || []) {
        const value = key === "device_uri" ? item.uri : item.id;
        option(select, value, key === "device_uri" ? `${item.info || value} · ${value}` : `${item.make_model} · ${value}`);
      }
      label.append(select); form.append(label);
    }
  }
  const save = node("button", "Lưu cấu hình"); save.type = "submit"; form.append(save);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const data = {
        name: name.value,
        formats: [...formatsWrap.querySelectorAll("input")].filter(x => x.checked).map(x => x.value),
        default_options: jsonField(defaults.value, "Default options"),
        allowed_options: jsonField(allowed.value, "Allowed options"),
      };
      for (const select of form.querySelectorAll("select[data-mapping]")) {
        if (select.value !== printer[select.dataset.mapping]) data[select.dataset.mapping] = select.value;
      }
      await api(`/admin/api/printers/${encodeURIComponent(printer.id)}`, { method: "PUT", body: JSON.stringify(data) });
      showNotice("Đã lưu cấu hình máy in.", "success"); await loadPrinters();
    } catch (error) { showNotice(`Không lưu được: ${error.message}`, "error"); }
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
async function discover() {
  $("#discovery-state").textContent = "Đang hỏi CUPS cục bộ…";
  try {
    discoveryData = await api("/admin/api/discovery");
    const device = $("#device-uri"), driver = $("#driver"), queue = $("#existing-queue");
    device.replaceChildren(); driver.replaceChildren(); queue.replaceChildren();
    for (const item of discoveryData.devices) option(device, item.uri, `${item.info || item.make_model || item.uri} · ${item.uri}`);
    for (const item of discoveryData.drivers) option(driver, item.id, `${item.make_model} · ${item.id}`);
    const registered = new Set(printerData.map(printer => printer.queue));
    for (const name of Object.keys(discoveryData.queues).filter(name => !registered.has(name))) option(queue, name, name);
    $("#discovery").classList.remove("hidden");
    $("#discovery-state").textContent = `${discoveryData.devices.length} thiết bị, ${discoveryData.drivers.length} driver. Có thể nhập URI máy mạng thủ công; vẫn cần driver được hỗ trợ. Import không sửa cấu hình CUPS, nhưng resume/pause sẽ điều khiển queue đã chọn.`;
    await loadPrinters(); await loadClients();
  } catch (error) {
    $("#discovery-state").textContent = `Không thể khám phá CUPS: ${error.message}`;
    showNotice(`CUPS discovery thất bại: ${error.message}`, "error");
  }
}
async function loadClients() {
  const target = $("#clients"); target.textContent = "Đang tải clients…";
  try {
    clientData = await api("/admin/api/clients"); target.replaceChildren();
    if (!clientData.length) target.append(node("p", "Chưa có client API."));
    for (const client of clientData) target.append(renderClient(client));
  } catch (error) { target.textContent = `Lỗi tải clients: ${error.message}`; }
}
function renderClient(client) {
  const card = node("article", null, "item-card");
  const head = node("div", null, "item-heading"); head.append(node("h3", client.name), node("span", client.revoked ? "Đã thu hồi" : "Hoạt động", client.revoked ? "pill bad" : "pill good"));
  card.append(head, node("p", `ID: ${client.id}`));
  const form = node("form", null, "edit-form");
  const label = node("label", "Máy được cấp"); const select = node("select"); select.multiple = true; select.size = Math.min(5, Math.max(2, printerData.length));
  for (const printer of printerData) {
    option(select, printer.id, printer.name);
    select.options[select.options.length - 1].selected = client.printer_ids.includes(printer.id);
  }
  label.append(select); form.append(label);
  const grant = node("button", "Lưu quyền máy in"); grant.type = "submit"; form.append(grant);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api(`/admin/api/clients/${encodeURIComponent(client.id)}/printers`, { method: "PUT", body: JSON.stringify({ printer_ids: selectedValues(select) }) });
      showNotice("Đã cập nhật quyền máy in cho client.", "success"); await loadClients();
    } catch (error) { showNotice(error.message, "error"); }
  });
  const actions = node("div", null, "button-row");
  const rotate = node("button", "Đổi API key", "secondary"); rotate.type = "button";
  rotate.addEventListener("click", () => clientAction(client.id, "rotate-key", "Đã tạo API key mới"));
  const revoke = node("button", "Thu hồi key", "danger"); revoke.type = "button";
  revoke.disabled = client.revoked; revoke.addEventListener("click", () => clientAction(client.id, "revoke", "Đã thu hồi client key"));
  actions.append(rotate, revoke); card.append(form, actions); return card;
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
      detail.addEventListener("click", () => showJob(job)); cell.append(detail); row.append(cell); tbody.append(row);
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
      cancel.addEventListener("click", async () => {
        try { await api(`/admin/api/jobs/${encodeURIComponent(job.job_id)}/cancel`, { method: "POST", body: "{}" }); showNotice("Yêu cầu hủy đã được xử lý theo bằng chứng CUPS.", "success"); await refreshAll(); await showJob(job); }
        catch (error) { showNotice(`Không xác nhận được hủy: ${error.message}`, "error"); }
      }); actions.append(cancel);
    }
    if (["queued", "held", "submitted"].includes(job.status)) {
      const resume = node("button", "Tiếp tục riêng lệnh này", "secondary"); resume.type = "button";
      resume.addEventListener("click", async () => {
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
      const resolve = node("button", "Ghi nhận xác minh (không gửi lại)"); resolve.type = "submit"; form.append(resolve);
      form.addEventListener("submit", async event => {
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
    for (const [key, value] of Object.entries(data)) $("#settings-form").elements.namedItem(key).value = value;
  } catch (error) { showNotice(`Không tải được giới hạn: ${error.message}`, "error"); }
}

$("#login-form").addEventListener("submit", async event => {
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
$("#logout").addEventListener("click", async () => {
  try { await api("/admin/api/logout", { method: "POST", body: "{}" }); }
  catch (error) { showNotice(`Đăng xuất chưa được xác nhận: ${error.message}`, "error"); return; }
  clearNotice(); printerData = []; clientData = []; discoveryData = null;
  $("#job-details").replaceChildren();
  csrfToken = ""; $("#dashboard").classList.add("hidden"); $("#logout").classList.add("hidden"); $("#login-panel").classList.remove("hidden");
});
$("#discover").addEventListener("click", discover);
$("#managed-printer-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const payload = {
      name: $("#printer-name").value, device_uri: $("#manual-uri").value.trim() || $("#device-uri").value, driver: $("#driver").value,
      formats: checkedFormats(form), default_options: jsonField($("#default-options").value, "Default options"),
      allowed_options: jsonField($("#allowed-options").value, "Allowed options"),
    };
    await api("/admin/api/printers", { method: "POST", body: JSON.stringify(payload) });
    showNotice("Đã tạo queue được quản lý; không xóa hay chiếm queue cũ.", "success");
    form.reset(); await Promise.all([loadPrinters(), loadStatus()]); await discover();
  } catch (error) { showNotice(`Không tạo được máy in: ${error.message}`, "error"); }
});
$("#import-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const payload = { queue: $("#existing-queue").value, name: $("#import-name").value, formats: checkedFormats(event.currentTarget, 'input[name="import-format"]') };
    await api("/admin/api/printers/import", { method: "POST", body: JSON.stringify(payload) });
    showNotice("Đã nhập queue nguyên trạng; CUPS chưa bị sửa.", "success"); await Promise.all([loadPrinters(), discover()]);
  } catch (error) { showNotice(`Không nhập được queue: ${error.message}`, "error"); }
});
$("#client-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/admin/api/clients", { method: "POST", body: JSON.stringify({ name: $("#client-name").value, printer_ids: selectedValues($("#client-printers")) }) });
    $("#client-name").value = "";
    showNotice(`Client đã tạo. Sao chép API key này ngay; key chỉ xuất hiện một lần: ${result.api_key}`, "success"); await loadClients();
  } catch (error) { showNotice(`Không tạo được client: ${error.message}`, "error"); }
});
$("#settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const key of Object.keys(payload)) payload[key] = Number(payload[key]);
    await api("/admin/api/settings", { method: "PUT", body: JSON.stringify(payload) });
    showNotice("Đã lưu giới hạn.", "success"); await loadSettings();
  } catch (error) { showNotice(`Không lưu được giới hạn: ${error.message}`, "error"); }
});
$("#refresh").addEventListener("click", refreshAll);
checkSession();
