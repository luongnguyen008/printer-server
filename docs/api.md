# API contract (v1)

Base URL local: `http://EDATEC_IP:8081`. Cổng 8081 cho bản mới nhằm tránh đụng `pi-print-gateway` cũ thường chạy 8080; port/host đổi được. Không đổi service cũ trong giai đoạn thử.

## Client authentication

`Authorization: Bearer <API_KEY>`. Mỗi client có một key và danh sách printer IDs được cấp; key không cấp quyền quản trị. Không cần Odoo để gọi API.

### GET /api/v1/printers

Chỉ trả máy được cấp cho client: ID, tên, định dạng được hỗ trợ, tùy chọn mặc định/ghi đè, trạng thái vận hành. Không cần tiết lộ URI/driver/password nội bộ cho client.

### GET /api/v1/printers/{id}/capabilities

Trả schema capability `schema_version:1` và fingerprint mapping/schema hiện tại; đọc không tạo/sửa queue. Client chỉ nhận các enum thật sự nằm trong `allowed_options` đã lưu, không tự được cấp quyền từ khả năng driver. Defaults được trả riêng; `constraints` giải thích các tổ hợp không hợp lệ. Admin dùng `GET /admin/api/printers/{id}/capabilities` để xem các lựa chọn PPD đầy đủ và allowlist hiện tại. Hai endpoint yêu cầu Bearer/Admin session tương ứng; client không được cấp printer và printer không tồn tại đều trả 404. Khi CUPS không truy cập được endpoint vẫn trả 200 với `availability:"unavailable"`, `reason` và danh sách khả năng rỗng; không được hiểu đó là máy không hỗ trợ tính năng nào.

Schema ví dụ:

```json
{
  "schema_version": 1,
  "printer_id": "opaque-id",
  "availability": "available",
  "source": "ppd",
  "mapping_fingerprint": "sha256…",
  "schema_fingerprint": "sha256…",
  "groups": [{"id":"common","label":"Common"},{"id":"advanced","label":"Advanced"}],
  "options": [{"name":"Duplex","label":"Duplex","group":"common","group_label":"General","default":"None","overridable":true,"choices":[{"value":"None","label":"Off"},{"value":"DuplexNoTumble","label":"Long edge"}]}],
  "constraints": [{"option1":"Duplex","choice1":"DuplexTumble","option2":"BindEdge","choice2":"Left"}],
  "default_options": {},
  "allowed_options": null
}
```

`availability` là `available`, `partial` (chỉ một số thuộc tính IPP được CUPS báo), `unknown` (không có PPD/IPP capability đáng tin) hoặc `stale` (mapping hiện tại khác mapping đã đăng ký). Raw/driverless queue không được suy diễn tính năng từ tên model; capability IPP chưa biểu diễn thành PPD enum sẽ chỉ được báo trong `ipp_attributes`, không thành điều khiển override. Schema bị giới hạn kích thước và chuỗi; giá trị enum dùng đúng keyword/choice của driver. PDF scaling (`print-scaling`: auto/auto-fit/fit/fill/none) chỉ hiện các giá trị CUPS báo trong `print-scaling-supported`; không áp cho ZPL. Scaling không đồng nghĩa borderless.

### POST /api/v1/jobs

Multipart với:

- `file`: PDF hoặc UTF-8 ZPL, không URL hoặc executable.
- `printer_id`: ID máy lấy từ danh sách.
- `format`: `pdf` hoặc `zpl`.
- `title`: tiêu đề ngắn, không thông tin bí mật.
- `copies`: 1–100, còn bị giới hạn theo máy nếu cần.
- `options`: JSON object tùy chọn client yêu cầu, chỉ keys/values được máy cho phép.

Header `Idempotency-Key` bắt buộc, 1–128 ký tự an toàn. Mỗi thao tác in mới dùng mã mới; gửi lại cùng thao tác dùng mã cũ. Không suy luận cùng file là cùng thao tác.

202 cho lệnh mới sau khi lưu an toàn; 200 cho cùng mã và cùng nội dung đã nhận:

```json
{"job_id":"opaque-id","status":"queued","deduplicated":false}
```

Sau khi lịch sử bị dọn vẫn có thể trả bản ghi tối thiểu và đánh dấu `history_expired`, không tạo lệnh mới.

Errors: 401 invalid/revoked key; 403 máy chưa được cấp; 404 đối tượng không thuộc client; 409 cùng mã khác nội dung; 413 file quá lớn; 422 định dạng/options không phù hợp; 429 đầy số lệnh; 507 thiếu dung lượng. Lỗi không trả stack trace, API key hoặc đường dẫn file nội bộ.

### GET /api/v1/jobs?limit=50

Danh sách giới hạn của chính client, mới nhất trước. Metadata/status/timestamps/reason, không download file đã lưu. API không trả jobs của client khác.

### GET /api/v1/jobs/{job_id}

Trạng thái hiện tại và sự kiện được phép xem của chính client. Poll 3–5 giây; ngừng khi terminal. `unknown` cần quản trị, không tạo mã mới chỉ để vượt qua chống trùng.

### POST /api/v1/jobs/{job_id}/cancel

Chỉ lệnh của client. Lệnh đang chờ có thể hủy chắc chắn; đã giao trả phản hồi dựa trên CUPS. Không bảo đảm thu hồi giấy. Không báo canceled khi CUPS không xác nhận được.

## Admin interface

`/` là trang quản trị cùng nguồn với app; OpenAPI/docs routes bị tắt. Admin routes dưới đây dùng session cookie riêng, không dùng API key client. Login nhận JSON `{"password":"…"}`, trả `csrf_token` và cookie `pa_admin` (HttpOnly, SameSite=Strict, 8 giờ). Mọi POST/PUT mutation ngoài login cần `X-CSRF-Token`; nếu Origin có mặt phải cùng origin. `PRINT_APPLIANCE_SECURE_COOKIE=1` bật cờ Secure. Năm lần sai mật khẩu trong cửa sổ 5 phút sẽ khóa login trong 5 phút. Bootstrap/reset bằng CLI, không có mật khẩu mặc định.

Admin routes đã triển khai:

- `POST /admin/api/login`, `GET /admin/api/session`, `POST /admin/api/logout`.
- `GET /admin/api/status` — trạng thái CUPS, dung lượng và số lệnh.
- `GET /admin/api/discovery` — CUPS devices, drivers, existing queues.
- `GET /admin/api/printers` và `GET /admin/api/printers/{id}`; `POST /admin/api/printers` tạo queue managed từ URI/driver đã khám phá; `POST /admin/api/printers/import` nhập queue hiện có nguyên trạng; `PUT /admin/api/printers/{id}` sửa; `DELETE /admin/api/printers/{id}` gỡ đăng ký; `POST /admin/api/printers/{id}/pause|resume` điều khiển CUPS.
- `GET /admin/api/clients` và `GET /admin/api/clients/{id}`; `POST /admin/api/clients` body `{"name":"…","printer_ids":[…]}`; key chỉ xuất hiện một lần. `PUT /admin/api/clients/{id}` đổi tên và/hoặc thay toàn bộ grant list; `DELETE /admin/api/clients/{id}` xóa mềm; `PUT /admin/api/clients/{id}/printers` đổi grant; `POST /admin/api/clients/{id}/rotate-key|revoke` đổi/thu hồi key.
- Xóa máy in/client trả 409 nếu còn job chưa terminal (`queued`, `held`, `submitting`, `submitted`, `unknown`). Xóa máy in chỉ gỡ đăng ký khỏi ứng dụng; không xóa, pause hay sửa queue/driver/job trong CUPS.
- `GET /admin/api/jobs?limit=100`, `GET /admin/api/jobs/{id}`, `POST /admin/api/jobs/{id}/cancel|resume`; `POST /admin/api/jobs/{id}/resolve` body `{"outcome":"completed|failed|canceled","reason":"evidence …"}`. Resolve unknown không submit lại.
- `GET /admin/api/settings`; `PUT /admin/api/settings` nhận `max_upload_bytes`, `max_pending_jobs`, `min_free_bytes`, `history_retention_days` với giới hạn hữu hạn.

Client contract không đổi. API keys đã revoke trả 401; client chỉ thấy printers được cấp và jobs của mình. Một retry idempotent cùng client/key/nội dung được xử lý trước khi kiểm tra quyền printer hiện tại, nhưng request vẫn phải xác thực. `history_expired` đánh dấu replay tombstone không còn lịch sử. Các response job không chứa file path.

## Tình trạng xác minh

Routes trên đã được cài đặt và test với adapter giả tường minh. Đã đọc schema/job metadata thực trên EDATEC ARM64/pycups 2.0.1/CUPS 2.4.2 và driver Canon; người dùng báo in được. Các test offline/duplex/copies/cancel/power-loss phần cứng vẫn riêng biệt; không coi test giả là chứng minh mọi chức năng phần cứng. Xem README/runbook để chạy cục bộ và các giới hạn đã biết.

## Admin routes implemented

- `POST /admin/api/login`, `GET /admin/api/session`, `POST /admin/api/logout`. Login returns `csrf_token`; include `X-CSRF-Token` on all subsequent mutations.
- `GET /admin/api/status`, `/discovery`, `/printers`, `/printers/{id}`, `/clients`, `/clients/{id}`, `/jobs?limit=100`, `/jobs/{job_id}`, `/settings`, `/audit?limit=100`.
- `POST /admin/api/printers`: `name`, `device_uri`, `driver`, `formats`, `default_options`, `allowed_options`. Driver must be in CUPS discovery; discovered USB/DNS-SD or manually entered local network URI.
- `POST /admin/api/printers/import`: `queue`, `name`, `formats`; imported queue starts paused and must have verified stop-printer policy before resume.
- `PUT /admin/api/printers/{id}`: changed fields from the create payload. Mapping edits are refused while handed-off/unknown jobs exist. Imported queue device/driver changes are not allowed here. `GET` the same resource returns its active record; missing or deleted IDs return 404.
- `DELETE /admin/api/printers/{id}` takes no body and returns `{"id":"<printer-id>","deleted":true}`. It returns 409 while any `queued`, `held`, `submitting`, `submitted` or `unknown` job exists; otherwise it unregisters only the application record and grants. It never deletes, pauses or changes a CUPS queue, driver or job. The old ID/history remains; registering the same existing CUPS queue later creates a new printer ID.
- `POST /admin/api/printers/{id}/pause` and `/resume`. Resume is refused for unresolved unknowns and unsafe error policy.
- `POST /admin/api/clients`: `name`, `printer_ids`; returns a one-time `api_key`. `GET /admin/api/clients/{id}` returns `{id,name,revoked,created_at,printer_ids}`. `PUT /admin/api/clients/{id}` accepts `{"name":"New name"}`, `{"printer_ids":["<active-printer-id>"]}` or both; `printer_ids` replaces the complete grant list. It returns the same public client record (never the key). `PUT /admin/api/clients/{id}/printers` remains the grant-only form. `DELETE /admin/api/clients/{id}` takes no body and returns `{"id":"<client-id>","deleted":true}`. `POST .../{id}/rotate-key` and `/revoke` affect only active clients.
- `POST /admin/api/jobs/{id}/cancel`, `/resume`; `POST .../{id}/resolve` takes `outcome` (completed/failed/canceled) and `reason` (8–1000 chars). A matching CUPS job must be terminal before resolution; another correlation is not evidence for this job.
- `PUT /admin/api/settings`: finite integer limits `max_upload_bytes`, `max_pending_jobs`, `min_free_bytes`, `history_retention_days`.

Admin APIs return 200 on successful mutations; keys are never returned by list/history/audit routes. In-use deletes return 409, missing/deleted resource mutations return 404, invalid fields 422 and unavailable CUPS 503. Deleted printers/clients are omitted from lists and grants; deleted clients' keys cannot authenticate or be rotated back to active. Successful deletions and configuration/control changes have a minimal credential-free audit entry. All mutations require the admin session and `X-CSRF-Token`.

## Client test page

`GET /client` serves an offline Vietnamese client UI using the existing `/api/v1` contract. The page itself is public, but all printer/job data still requires a scoped Bearer API key. It never calls admin APIs or sends admin session cookies. Keys are held in tab memory, not storage/URL; files remain only while needed by the form or an unresolved submission. Unknown submission responses expose the original request ID and an explicit immutable replay, not a new job. Reload/disconnect can discard an unconfirmed request; inspect history rather than creating a new print request. No new client privileges, CORS changes or printing backend are introduced.
