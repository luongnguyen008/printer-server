import React, { useRef, useState } from 'react';
import { Button, Input, Select } from './shared.jsx';
import contract from './client-api.json';

const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
export function curlExample(endpoint, format = 'pdf') {
  const route = endpoint.path.replace('{printer_id}', '${PRINTER_ID}').replace('{job_id}', '${JOB_ID}') + (endpoint.id === 'jobs' ? '?limit=50' : '');
  const lines = ['curl --include --silent --show-error --max-time 30', `  -X ${endpoint.method} "$BASE_URL${route}"`, '  -H "Authorization: Bearer ${API_KEY}"'];
  if (endpoint.id === 'submit') lines.push(
    '  -H "Idempotency-Key: ${REQUEST_ID:?Tao REQUEST_ID mot lan cho yeu cau moi}"',
    '  -F "printer_id=${PRINTER_ID}"', `  -F 'format=${format}'`, "  -F 'title=Invoice example'", "  -F 'copies=1'", "  -F 'options={}'",
    `  -F 'file=@./${format === 'pdf' ? 'invoice.pdf;type=application/pdf' : 'label.zpl;type=text/plain'}'`,
  );
  return lines.join(' \\\n');
}
const json = value => JSON.stringify(value, null, 2);
function schemaDocument(name) {
  const schema = contract.$defs[name], dependencies = {};
  // Include referenced definitions so copied schemas work as standalone JSON Schema.
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) { const key = node.$ref.split('/').at(-1); if (!dependencies[key]) { dependencies[key] = contract.$defs[key]; visit(dependencies[key]); } }
    Object.values(node).forEach(value => { if (typeof value === 'object') visit(value); });
  };
  visit(schema);
  return { $schema: contract.$schema, ...schema, ...(Object.keys(dependencies).length ? { $defs: dependencies } : {}) };
}
function CodeBlock({ title, text, notice, disabled = false }) {
  const ref = useRef(null);
  return <div className="api-code"><div className="section-heading"><strong>{title}</strong><Button className="secondary" disabled={disabled} aria-label={`Sao chép ${title}`} onClick={async () => {
    try { if (!navigator.clipboard) throw new Error('unavailable'); await navigator.clipboard.writeText(text); notice('Đã sao chép ví dụ.', 'success'); }
    catch { if (!ref.current) return; const range = document.createRange(); range.selectNodeContents(ref.current); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); ref.current.focus(); notice('Đã chọn nội dung. Nhấn ⌘C hoặc Ctrl+C để sao chép trên HTTP.', 'info'); }
  }}>Sao chép</Button></div><pre ref={ref} tabIndex={0} aria-label={title}><code>{text}</code></pre></div>;
}
function Endpoint({ endpoint, notice }) {
  const [format, setFormat] = useState('pdf');
  return <details className="api-endpoint"><summary><span className={`api-method api-method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span> <code>{endpoint.path}</code><span className="api-summary-title">{endpoint.title}</span></summary>
    <p>{endpoint.description}</p>
    <h3>Request</h3><p><code>Authorization: Bearer &lt;CLIENT_API_KEY&gt;</code> bắt buộc. Không dùng cookie/mật khẩu quản trị.</p>
    {!!endpoint.parameters.length && <table><caption>Header, path và query parameters</caption><thead><tr><th>Tên / vị trí</th><th>Bắt buộc</th><th>Mô tả</th></tr></thead><tbody>{endpoint.parameters.map(parameter => <tr key={parameter.name}><td><code>{parameter.name}</code><br />{parameter.in}</td><td>{parameter.required ? 'Có' : 'Không'}</td><td>{parameter.description}{parameter.pattern && <><br /><code>{parameter.pattern}</code></>}{parameter.default !== undefined && <> Mặc định: {parameter.default}.</>}</td></tr>)}</tbody></table>}
    {endpoint.bodySchema && <><p>Content-Type: <code>{endpoint.contentType}</code> — để cURL tự đặt multipart boundary.</p><CodeBlock title="Ví dụ các trường multipart (không gửi JSON)" text={json({ ...endpoint.requestExample, format, file: format === 'pdf' ? '@./invoice.pdf' : '@./label.zpl' })} notice={notice} /><details><summary>Schema request: {endpoint.bodySchema}</summary><CodeBlock title="JSON schema request" text={json(schemaDocument(endpoint.bodySchema))} notice={notice} /></details>
      <label className="setting-field">Định dạng ví dụ<Select value={format} onChange={event => setFormat(event.target.value)}><option value="pdf">PDF</option><option value="zpl">ZPL UTF-8</option></Select></label>
      <p className="bad">Lệnh cURL này có thể in thật. Tạo REQUEST_ID một lần cho yêu cầu mới; nếu mất phản hồi, giữ nguyên ID, file, filename và tất cả fields. Không chạy lại bước tạo ID và không dùng --retry.</p>
    </>}
    {endpoint.id === 'cancel' && <p className="bad">Lệnh cURL này yêu cầu hủy lệnh thật. Kiểm tra đúng JOB_ID trước khi chạy.</p>}
    <CodeBlock title={`cURL ${endpoint.method} ${endpoint.path}`} text={curlExample(endpoint, format)} notice={notice} />
    <h3>Response</h3>{endpoint.responses.map(response => <div className="subpanel" key={response.status}><h4>HTTP {response.status} · application/json</h4><p>{response.description}</p><CodeBlock title={`Ví dụ response ${response.status}`} text={json(response.example)} notice={notice} /><details><summary>JSON schema: {response.schema}</summary><CodeBlock title={`Schema response ${response.status}`} text={json(schemaDocument(response.schema))} notice={notice} /></details></div>)}
    <details><summary>Mã lỗi và schema lỗi</summary><table><thead><tr><th>HTTP</th><th>Ý nghĩa</th></tr></thead><tbody>{endpoint.errors.map(error => <tr key={error.status}><td>{error.status}</td><td>{error.description}</td></tr>)}</tbody></table><p>Lỗi trường/query sai kiểu có thể trả 422 với detail là danh sách lỗi validation.</p><CodeBlock title="Ví dụ response lỗi" text={json({ detail: 'Invalid API key' })} notice={notice} /><CodeBlock title="JSON schema lỗi" text={json(schemaDocument('Error'))} notice={notice} /></details>
  </details>;
}
export function ApiGuide({ notice }) {
  const [base, setBase] = useState(location.origin), [query, setQuery] = useState('');
  let origin = '', invalid = false;
  try { const url = new URL(base); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(); origin = url.origin; }
  catch { invalid = true; }
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const matches = contract.endpoints.filter(endpoint => normalize(`${endpoint.method} ${endpoint.path} ${endpoint.title}`).includes(normalize(query.trim())));
  const setup = invalid ? '# Nhập Base URL hợp lệ trước khi sao chép.' : `export BASE_URL=${quote(origin)}\nexport API_KEY='<API_KEY>'\nexport PRINTER_ID='ID_FROM_PRINTER_LIST'\nexport JOB_ID='ID_FROM_JOB_RESPONSE'`;
  return <><h2>API Guide · Client API v1</h2><p>Tham chiếu chỉ đọc, tương tự Swagger: request, JSON schema, response và cURL. Trang này không gọi API client, không gửi/hủy lệnh và không cần nhập API key thật.</p>
    <div className="subpanel"><h3>1. Kết nối và xác thực</h3><label className="setting-field">Base URL<Input type="url" value={base} onChange={event => setBase(event.target.value)} aria-invalid={invalid} /></label>{invalid && <p className="bad" role="alert">Nhập origin HTTP/HTTPS, không có credentials, path, query hoặc fragment.</p>}
      <p>Mỗi client có API key và danh sách máy được cấp bởi quản trị. Giữ key ngoài Git/log/chat. Chỉ dùng LAN đáng tin cậy; HTTP không mã hóa key. Trình duyệt khác origin không có quyền CORS; tích hợp nên gọi từ backend.</p>
      <CodeBlock title="Biến môi trường (thay placeholder trên máy client)" text={setup} notice={notice} disabled={invalid} />
    </div>
    <div className="subpanel"><h3>2. Chọn máy → đọc schema → gửi → theo dõi</h3><ol><li>GET /printers để lấy PRINTER_ID thuộc quyền.</li><li>GET /printers/&#123;printer_id&#125;/capabilities: chỉ gửi keyword/enum choices được cấp, không dịch các giá trị. options=&#123;&#125; dùng mặc định. PDF và ZPL có khả năng khác nhau; không áp tùy chọn PDF vào ZPL.</li><li>Với mỗi yêu cầu mới, tạo REQUEST_ID một lần rồi chạy cURL gửi multipart bên dưới.</li><li>Giữ job_id trả về. GET /jobs/&#123;job_id&#125; mỗi 3–5 giây khi còn hoạt động. Sau timeout/mất phản hồi, kiểm tra lịch sử và chỉ phát lại cùng ID/nội dung khi cần.</li></ol>
      <CodeBlock title="Tạo REQUEST_ID — chỉ một lần cho yêu cầu in mới" text={'export REQUEST_ID="client-$(python3 -c \'import secrets; print(secrets.token_hex(24))\')"'} notice={notice} />
      <p className="muted">Ví dụ tạo ID dùng Python 3. Tích hợp có thể tự tạo UUID/ID theo pattern bên dưới; ID là riêng theo từng client. Không tạo ID mới chỉ để vượt qua kết quả chưa rõ.</p>
      <p className="bad">202 = đã lưu, chưa chứng minh đã in. 200 deduplicated=true = phát lại, không tạo job mới. history_expired=true = chỉ còn bản ghi chống trùng; không tự in lại. completed chỉ là CUPS báo hoàn thành; unknown cần người vận hành xác minh.</p>
    </div>
    <label className="setting-field">Tìm endpoint<Input type="search" value={query} placeholder="GET, jobs, schema…" onChange={event => setQuery(event.target.value)} /></label><p className="muted">{matches.length} / {contract.endpoints.length} endpoints · Ví dụ dùng ID giả, không phải dữ liệu thiết bị.</p>
    {matches.map(endpoint => <Endpoint key={endpoint.id} endpoint={endpoint} notice={notice} />)}{!matches.length && <p>Không có endpoint phù hợp.</p>}
  </>;
}
