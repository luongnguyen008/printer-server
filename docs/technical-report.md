# Báo cáo kỹ thuật — Print Appliance

Thiết bị quản lý in tại chỗ, API đa client và giao diện quản trị

- **Mã nguồn:** https://github.com/luongnguyen008/printer-server
- **Phiên bản phần mềm được mô tả:** 0.1.5.
- **Mốc mã nguồn:** `056e2e7823d8e4579a02aab027d6a2dad678549f`.
- **Ngôn ngữ tài liệu:** tiếng Việt. Lệnh có nhãn hệ điều hành và nơi thực thi.
- **Đối tượng đọc:** người triển khai, người vận hành, lập trình viên tích hợp và người tiếp nhận bảo trì.

Báo cáo này đủ để lấy mã nguồn, chạy môi trường local, cài một thiết bị Linux mới và gửi lệnh qua API. Các ví dụ dùng dữ liệu mẫu; người đọc tự chọn IP, máy in, API key và mật khẩu. Không có mật khẩu mặc định hoặc thông tin bí mật trong tài liệu.

> **Quy tắc an toàn:** lệnh `POST /api/v1/jobs` yêu cầu in thật. Các lệnh cài driver, thay queue, pause/resume và restore dữ liệu có thể ảnh hưởng máy đang dùng. Đọc điều kiện trước từng phần; không chạy cả tài liệu như một script.

[TOC]

## 1. Tóm tắt ứng dụng

Print Appliance biến một máy Linux, chẳng hạn EDATEC dùng Raspberry Pi Compute Module 4, thành đầu mối tiếp nhận và quản lý in. Nhiều ứng dụng gửi PDF hoặc ZPL qua API. Thiết bị xác thực người gửi, lưu lệnh, điều phối hàng đợi, giao nội dung cho CUPS và ghi nhận kết quả hệ thống in.

Odoo, PDA, phần mềm kho và ứng dụng desktop đều có thể là client. Lõi in không phụ thuộc Odoo. PDA không phải cài driver của từng máy in nếu gửi nội dung qua appliance; driver chạy ở thiết bị Linux.

Các chức năng hiện có:

- API key riêng cho từng client; chỉ dùng máy được cấp và xem lệnh của chính mình.
- Nhận file PDF/ZPL; lưu bền vững trước khi trả kết quả tiếp nhận.
- Chống gửi trùng bằng `Idempotency-Key`, tồn tại qua restart và dọn lịch sử.
- FIFO theo máy đăng ký; xử lý độc lập tối đa bốn máy trong một vòng điều phối.
- Dừng khi có lỗi/offline, tiếp tục thủ công, hủy có đối soát và xử lý kết quả chưa rõ.
- Quản trị máy in/client bằng modal; tìm driver, chọn nhiều máy bằng checkbox, xem chi tiết lệnh và chỉnh giới hạn lưu trữ.
- Đọc khả năng driver/CUPS để tạo form khổ giấy, duplex và tùy chọn nâng cao.
- Trang `/client` để gửi thử bằng API key, tải file và xem lịch sử. Tải lại giữ kết nối theo tab; không tự gửi lại nội dung.
- Chạy một service systemd, SQLite và spool trên đĩa; không cần Redis, Docker hoặc cơ sở dữ liệu ngoài.

Bản này dành cho một thiết bị trong LAN. Nó không phải hệ thống kho, phần mềm thiết kế nhãn, driver máy in, dịch vụ cloud hoặc nền tảng nhiều node. Chưa có webhook, bộ tích hợp Odoo đóng gói sẵn, trình cài driver qua web hoặc chuyển PDF thành ZPL.

## 2. Chọn cách chạy theo hệ điều hành

| Môi trường | Vai trò phù hợp | In thật trong phạm vi báo cáo |
| --- | --- | --- |
| macOS | Chạy local, test, build; quản trị Linux bằng trình duyệt/SSH; gọi API | Gửi API tới appliance Linux. Không coi CUPS macOS là môi trường triển khai được hỗ trợ |
| Windows 10/11 + PowerShell | Trình duyệt, SSH, SCP và gọi API | Gửi API tới appliance Linux |
| Windows + WSL2 Ubuntu | Chạy mã Python, test, build và trình duyệt qua localhost | Local dùng để phát triển; không chứng nhận USB/CUPS/driver trong WSL |
| Debian 12 ARM64 + Python 3.11 | Môi trường triển khai Linux đã được dùng trên EDATEC | CUPS và driver đúng kiến trúc; từng model cần kiểm thử |
| Linux khác | Có thể phát triển; triển khai sau khi kiểm tra Python/CUPS/driver/quyền | Không suy ra tương thích chỉ từ việc cài được wheel |

**Không chạy service trực tiếp bằng Python native Windows.** Worker dùng `fcntl.flock`, quyền file POSIX, đồng bộ thư mục và Unix socket CUPS. Windows không có đầy đủ các cơ chế này. Dùng WSL2 cho phát triển; dùng Linux thật cho appliance.

macOS có một số cơ chế POSIX nhưng socket mặc định `/run/cups/cups.sock` là đường dẫn Linux. Bản cài local không tự tìm hoặc dùng máy in của Mac. Khi không có pycups/CUPS phù hợp, trang quản trị vẫn chạy và báo CUPS không khả dụng; đó là trạng thái đúng, không phải mô phỏng đã in thành công.

### 2.1 Lộ trình ngắn

- **Chỉ cần sử dụng:** mở trang quản trị và `/client` trên thiết bị đã cài; xem phần 10–12.
- **Muốn chạy thử mã nguồn:** làm phần 6 trên Mac hoặc phần 7 trên Windows/WSL.
- **Muốn cài thiết bị mới:** build ở phần 8, rồi triển khai Debian ở phần 9.
- **Muốn tích hợp ứng dụng:** đọc phần 13–15; giữ request ID trong dữ liệu nghiệp vụ của client.
- **Muốn bảo trì:** đọc phần 16–20 trước khi restart, restore hoặc nâng phiên bản.

## 3. Kiến trúc và trách nhiệm

![Kiến trúc appliance: client, quản trị, lưu trữ, worker, CUPS và máy in](diagrams/01-architecture.svg)

_Hình 1 — Hai đường truy cập dùng cơ chế xác thực riêng; driver và việc truyền tới máy nằm ở phía CUPS._

Các hình trong báo cáo là SVG, có thể phóng to mà không vỡ chữ. Trên GitHub có thể mở riêng từng hình; HTML đã nhúng hình để đọc offline. Màn hình nhỏ có thể cuộn ngang bên trong sơ đồ.

CUPS chịu trách nhiệm driver, filter, hàng đợi hệ thống và truyền dữ liệu tới máy. Appliance chịu trách nhiệm quyền client, tiếp nhận bền vững, chống trùng, cấu hình đăng ký, chính sách điều phối và lịch sử. Không thay CUPS bằng một spooler tự viết.

Driver chạy cùng CUPS trên Linux. Vì vậy driver dành cho Windows, macOS hoặc x86 không thay thế được driver ARM64 trên EDATEC. Một file PPD chỉ mô tả lựa chọn; driver có thể còn cần executable filter và thư viện.

### 3.1 Bản đồ mã nguồn

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `src/print_appliance/app.py` | Route FastAPI, xác thực/CSRF, giới hạn HTTP, lifecycle và khóa process |
| `src/print_appliance/service.py` | Tiếp nhận, quyền, snapshot, idempotency, FIFO, điều phối và đối soát |
| `src/print_appliance/cups.py` | Adapter CUPS thật, discovery, mapping, capability, job/control |
| `src/print_appliance/db.py` | Schema SQLite, migrations đơn giản, giới hạn mặc định |
| `src/print_appliance/auth.py` | Hash mật khẩu, session/token và kiểm tra phiên |
| `src/print_appliance/config.py` | Thư mục dữ liệu, địa chỉ/port và biến môi trường |
| `src/print_appliance/cli.py` | Chạy service, đặt/reset mật khẩu và backup SQLite |
| `src/print_appliance/static/` | HTML/CSS/JS offline của admin và client |
| `deploy/print-appliance.service` | Mẫu service systemd không chạy root |
| `tests/` | API, CRUD, coordinator, adapter và regression bằng fake/mock |
| `tests/browser/` | Kiểm thử Chrome/Playwright, chỉ cho phép URL loopback |
| `CONTEXT.md` | Thuật ngữ miền nghiệp vụ |
| `docs/adr/` | Quyết định kiến trúc |
| `uv.lock` | Phiên bản dependency dùng khi tái tạo môi trường |

Frontend dùng JavaScript thuần, không cần build Node để vận hành. Node/Playwright chỉ phục vụ kiểm thử trình duyệt. Wheel chứa các asset offline; không cần CDN hay Internet sau khi đã cài đủ package/driver.

### 3.2 Dữ liệu và cơ chế bền vững

SQLite dùng WAL, `synchronous=FULL`, foreign keys và transaction. Các bảng chính là `printers`, `clients`, `client_printers`, `jobs`, `idempotency`, `events`, `admin`, `sessions`, `login_guard`, `settings`, `audit_events`.

- File tải lên được ghi, kiểm hash và `fsync`; thư mục spool được đồng bộ trước phản hồi tiếp nhận.
- Job có `sequence` tăng theo thứ tự tiếp nhận; FIFO không dựa vào đồng hồ tường.
- Mỗi job giữ snapshot queue, URI, driver fingerprint, định dạng và tùy chọn hiệu lực.
- Request digest dùng trường gốc, tên file và SHA-256 nội dung. Cấu hình thay đổi sau đó không làm một retry biến thành lệnh khác.
- Worker giữ khóa độc quyền `worker.lock`. Hai instance dùng cùng data directory sẽ bị chặn. Không tăng `--workers`, không chạy thêm coordinator trên cùng dữ liệu.

![Luồng nhận job mới, replay cùng request ID và từ chối xung đột](diagrams/02-admission.svg)

_Hình 2 — Request ID chống tạo lệnh trùng trong phạm vi client. Chỉ job mới được lưu bền vững mới trả 202; replay không tạo một lần giao mới._

Các bảo đảm phụ thuộc ổ đĩa, filesystem và hệ điều hành thực hiện đồng bộ đúng. Mất điện vật lý cần kiểm thử riêng; SQLite transaction không tạo được transaction chung với máy in.

## 4. Trạng thái lệnh và giới hạn bảo đảm

| Status | Ý nghĩa | Cách xử lý |
| --- | --- | --- |
| `queued` | Đã lưu, chưa giao CUPS | Chờ FIFO; có thể hủy trước giao |
| `held` | Đang giữ do pause, lỗi hoặc cấu hình | Sửa nguyên nhân; quản trị cho tiếp tục |
| `submitting` | Đã ghi ý định giao; chưa chốt phản hồi | Để service đối soát, không gửi lệnh mới |
| `submitted` | Có CUPS job, đang theo dõi | Poll trạng thái; cancel cần xác nhận CUPS |
| `completed` | CUPS báo hoàn thành | Không đồng nghĩa chứng minh mọi trang đã ra giấy |
| `failed` | Kết thúc với lỗi xác định | Kiểm tra reason và sự kiện trước khi quyết định in thêm |
| `canceled` | Đã hủy với mức xác nhận ghi nhận | Không thu hồi được giấy đã in |
| `unknown` | Không đủ bằng chứng về kết quả giao/in | Chặn tiến trình máy đó; quản trị đối soát thủ công |

Ba status terminal là `completed`, `failed`, `canceled`. `unknown` không phải terminal và vẫn giữ payload.

![Vòng đời queued, held, submitting, submitted, unknown và các kết quả terminal](diagrams/03-job-lifecycle.svg)

_Hình 3 — Vòng đời nghiệp vụ rút gọn, không liệt kê mọi chuyển trạng thái nội bộ. Unknown cần đối soát, không phải một trạng thái được tự retry._

### 4.1 Vì sao không hứa exactly-once vật lý

CUPS có thể nhận nội dung rồi mạng/process mất trước khi appliance lưu phản hồi. Máy in có thể ra giấy rồi CUPS mất lịch sử. Không thể kết luận “không thấy job = chưa in”.

Đường giao bình thường là:

1. Lưu ý định và correlation `pa-<job-id>`.
2. Gửi CUPS job ở trạng thái giữ (`job-hold-until=indefinite`).
3. Lưu CUPS job ID vào SQLite.
4. Release đúng job bằng `setJobHoldUntil(id, 'no-hold')` khi được phép.
5. Theo dõi bằng CUPS ID và correlation; đối soát khi restart.

![Trình tự giao CUPS: lưu ý định, submit held, lưu CUPS ID, release và poll](diagrams/04-cups-handoff.svg)

_Hình 4 — Thứ tự giao bình thường. 202 xác nhận tiếp nhận của appliance; release xuống CUPS là một bước sau đó, có điều kiện._

Khi không xác minh được danh tính hoặc kết quả, chuyển `unknown`, giữ file và chờ người vận hành. Không tự resend để “thử lại”. Job tìm lại ở trạng thái held sau restart cần resume thủ công.

### 4.2 Một máy vật lý, một đường điều phối

FIFO được bảo đảm theo **máy đăng ký**, không theo địa chỉ vật lý chung. Nếu hai `printer_id` hoặc hai queue cùng trỏ tới một Canon, chúng có thể xử lý song song và làm mất giả định “một lệnh tại một thời điểm” trên máy vật lý đó. Nên đăng ký một đích cho một máy và tránh nhiều sender ngoài appliance dùng cùng queue.

![FIFO riêng theo từng máy đăng ký và xử lý độc lập giữa các máy](diagrams/05-printer-fifo.svg)

_Hình 5 — Máy C có unknown không làm máy A/B dừng theo. Mỗi đích đăng ký có FIFO riêng; nhiều ID cùng trỏ một máy vật lý không tạo FIFO chung._

## 5. Quy ước lệnh và dữ liệu mẫu

- Khối `bash` chạy trong Terminal macOS, WSL hoặc shell Linux đúng nhãn.
- Khối `powershell` chạy trong PowerShell của Windows; không dán vào CMD.
- Các lệnh dưới phần **trên Linux** chạy sau khi SSH vào thiết bị, không chạy trên Mac/Windows.
- Thay các biến mẫu trước khi dùng. `192.168.88.228` chỉ là IP triển khai từng dùng, không phải địa chỉ bắt buộc.
- Chọn một commit cố định để tái tạo. Tài liệu dùng mốc 0.1.5; đừng thay bằng `main` giữa chừng.
- Lệnh tải công cụ/package cần Internet. CUPS/admin UI vận hành offline sau cài đặt, nhưng lần cài đầu không phải bộ cài air-gap.

Mật khẩu web admin, mật khẩu SSH và API key client là ba thứ khác nhau. Tài liệu không dùng tài khoản `pi` hoặc mật khẩu mặc định như một bảo đảm chung: tài khoản SSH phải do chủ thiết bị cấp.

## 6. Chạy local trên macOS

### 6.1 Cài công cụ

Mở **Terminal**. Kiểm tra Git và Command Line Tools:

```bash
xcode-select -p
git --version
```

Nếu chưa có công cụ, chạy một lần và hoàn tất hộp thoại của Apple:

```bash
xcode-select --install
```

Cài `uv` bằng installer chính thức. Lệnh thực thi script tải từ Internet; đọc script hoặc chính sách công ty trước khi chạy:

```bash
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/install-uv.sh
less /tmp/install-uv.sh
sh /tmp/install-uv.sh
```

Mở Terminal mới hoặc cập nhật PATH rồi kiểm tra:

```bash
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

### 6.2 Clone và tạo môi trường

```bash
mkdir -p "$HOME/work"
cd "$HOME/work"
git clone https://github.com/luongnguyen008/printer-server.git
cd printer-server
```

```bash
APP_COMMIT=056e2e7823d8e4579a02aab027d6a2dad678549f
git checkout --detach "$APP_COMMIT"
uv python install 3.11
uv sync --frozen --python 3.11 --extra dev
```

`--detach` phù hợp đọc/chạy lại phiên bản đã chọn. Nếu sửa code, tạo nhánh trước:

```bash
git switch -c my-change
```

### 6.3 Test và chạy web

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

Tạo dữ liệu local và đặt mật khẩu quản trị riêng, ít nhất 12 ký tự:

```bash
mkdir -p .local-data/local-demo
chmod 700 .local-data .local-data/local-demo
uv run print-appliance admin-password --data-dir .local-data/local-demo
```

Chạy foreground; giữ cửa sổ Terminal mở:

```bash
uv run print-appliance run --data-dir .local-data/local-demo --host 127.0.0.1 --port 8081
```

Mở Terminal khác:

```bash
open http://127.0.0.1:8081/
```

Đăng nhập bằng mật khẩu vừa đặt. Chưa cài Linux CUPS/pycups thì discovery báo không khả dụng; vẫn có thể kiểm tra giao diện và test mock. Không thêm địa chỉ LAN hoặc máy thật vào môi trường local chỉ để bỏ cảnh báo. CLI dùng adapter CUPS thật, không phải chế độ giả; nếu bạn đã cài pycups và cấu hình socket dùng được trên máy local, không đăng ký/submit vào queue thật trong lúc test.

Dừng bằng **Ctrl+C**. Nếu cổng bận, chọn 18081 và mở URL cùng cổng:

```bash
uv run print-appliance run --data-dir .local-data/local-demo --host 127.0.0.1 --port 18081
```

## 7. Chạy local trên Windows với WSL2

### 7.1 Công cụ Windows

Dùng Windows 10/11 có WSL2. Trong PowerShell, kiểm tra:

```powershell
wsl --status
ssh -V
curl.exe --version
```

Nếu WSL chưa cài, mở **PowerShell as Administrator**:

```powershell
wsl --install -d Ubuntu-24.04
```

Khởi động lại nếu Windows yêu cầu. Mở Ubuntu, tạo user Linux và mật khẩu riêng. Không nhầm user WSL với user SSH của EDATEC. Nếu WSL đã có distro phù hợp, không bắt buộc cài thêm distro.

Có thể cài Git Windows để clone tài liệu hoặc quản lý mã ngoài WSL:

```powershell
winget install --id Git.Git -e
```

Git Windows không thay WSL để chạy worker. Với phần local Python bên dưới, clone vào home Linux của WSL, không vào `C:\...` hoặc `/mnt/c/...`; filesystem Linux phù hợp hơn cho lock/quyền và SQLite.

### 7.2 Công cụ và clone trong Ubuntu/WSL

Các lệnh này chạy trong cửa sổ **Ubuntu**, không phải PowerShell:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends git curl ca-certificates
```

```bash
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/install-uv.sh
less /tmp/install-uv.sh
sh /tmp/install-uv.sh
export PATH="$HOME/.local/bin:$PATH"
```

```bash
mkdir -p "$HOME/work"
cd "$HOME/work"
git clone https://github.com/luongnguyen008/printer-server.git
cd printer-server
```

```bash
APP_COMMIT=056e2e7823d8e4579a02aab027d6a2dad678549f
git checkout --detach "$APP_COMMIT"
uv python install 3.11
uv sync --frozen --python 3.11 --extra dev
```

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

```bash
mkdir -p .local-data/local-demo
chmod 700 .local-data .local-data/local-demo
uv run print-appliance admin-password --data-dir .local-data/local-demo
```

```bash
uv run print-appliance run --data-dir .local-data/local-demo --host 127.0.0.1 --port 8081
```

Trên trình duyệt Windows mở `http://localhost:8081/`. WSL2 thường chuyển tiếp localhost; nếu không truy cập được, kiểm tra WSL/firewall/VPN và xác nhận service đang chạy. Không mở `0.0.0.0` ra LAN như bước chữa lỗi mặc định.

Dừng bằng **Ctrl+C** trong WSL. Không chạy `uv run print-appliance run` bằng Python native Windows; lỗi `No module named fcntl` là giới hạn nền tảng, không phải thiếu package để pip-install.

### 7.3 Phạm vi đã kiểm chứng

Lệnh PowerShell/WSL trong báo cáo được thiết kế cho các công cụ nêu trên và đã được đối chiếu cú pháp/mã nguồn; chưa chạy trực tiếp trên máy Windows trong đợt này. Python tests và browser tests đã chạy trên Mac; runtime thật đã chạy trên Debian ARM64. USB pass-through, CUPS và driver vendor trong WSL không nằm trong chứng nhận triển khai.

## 8. Build, kiểm thử trình duyệt và chuẩn bị release

### 8.1 Build wheel và dependency đã khóa

Thực hiện trong repo trên **Mac hoặc WSL** sau khi test:

```bash
uv build
mkdir -p .local-data/release
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file .local-data/release/runtime-requirements.txt
```

Wheel 0.1.5 nằm ở `dist/print_appliance-0.1.5-py3-none-any.whl`. Dependency export có hash và marker hệ điều hành; không xóa marker hoặc hash. `python3-cups` dùng từ distro Linux, không cài extra `cups` trong quy trình này.

Đảm bảo source đã push và ghi commit:

```bash
git status --short
git rev-parse HEAD
```

Nếu có sửa đổi, test và commit/push trước build release cuối. Build từ cây sạch. Không gửi bản đã sửa nhưng chưa commit lên thiết bị.

Tạo checksum bằng Python sẵn trong môi trường uv; dùng được trên Mac và WSL:

```bash
uv run python - <<'PY'
from pathlib import Path
import hashlib
wheel = Path('dist/print_appliance-0.1.5-py3-none-any.whl')
Path('.local-data/release/wheel.sha256').write_text(hashlib.sha256(wheel.read_bytes()).hexdigest() + '\n')
PY
```

### 8.2 Browser regression

Python test không thay kiểm tra giao diện. Hai suite browser dùng API mock và chỉ cho URL loopback. Chúng không gửi nội dung tới máy in thật.

Cần Node.js và Playwright/Chromium. Trên Mac có Homebrew thì cài Node bằng `brew install node`; nếu chưa có Homebrew, cài Node LTS từ bộ cài chính thức. Trong WSL:

```bash
sudo apt-get install --no-install-recommends nodejs npm
node --version
npm --version
```

Node phải đáp ứng phiên bản Playwright được chọn. Bộ lệnh dưới dùng Playwright 1.51.1 (yêu cầu Node 18 trở lên); máy công ty có thể pin bản mới hơn và chạy lại suite.

Cài test tooling vào thư mục ignored, không thêm dependency frontend:

```bash
mkdir -p .local-data/browser-tools
npm install --prefix .local-data/browser-tools playwright@1.51.1
```

Trên Mac:

```bash
./.local-data/browser-tools/node_modules/.bin/playwright install chromium
```

Trong WSL có thể cần thư viện browser; chỉ chạy trong môi trường dev được phép cài dependency:

```bash
./.local-data/browser-tools/node_modules/.bin/playwright install --with-deps chromium
```

Chạy ứng dụng local ở Terminal thứ nhất:

```bash
uv run print-appliance run --data-dir .local-data/browser-data --host 127.0.0.1 --port 18081
```

Terminal thứ hai, tại repo:

```bash
export PLAYWRIGHT_MODULE="$PWD/.local-data/browser-tools/node_modules/playwright"
export UI_BASE_URL=http://127.0.0.1:18081
export UI_ARTIFACT_DIR="$PWD/.local-data/browser-screens"
node tests/browser/admin-ui.cjs
node tests/browser/client-ui.cjs
```

Nếu dùng Chrome có sẵn trên Mac thay Chromium tải về:

```bash
export CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

Suite kiểm tra tab/modal, dirty-close, driver 16k lựa chọn, multi-grants, toast, loading/error, schema theo máy, client session/reload/revoke, request retry không đổi và mobile. Sau khi chạy, dừng server local bằng Ctrl+C. Không đổi URL của suite sang EDATEC: suite chủ động từ chối URL không phải loopback.

## 9. Cài mới trên Debian 12/EDATEC

Đây là quy trình **cài mới**, không áp vào thiết bị đã có `/opt/print-appliance` hoặc `/var/lib/print-appliance`. Thiết bị đã cài dùng phần cập nhật. Không cài lại đè lên dữ liệu đang vận hành.

### 9.1 Chuẩn bị mạng và SSH

Ghi IP appliance, IP máy in, tài khoản SSH và phạm vi được phép thay đổi. Nên cấp DHCP reservation cho thiết bị và máy in. Cùng SSID/băng tần không chứng minh cùng LAN; 2.4 GHz và 5 GHz có thể nằm cùng mạng, nhưng guest VLAN/client isolation có thể chặn kết nối.

Mac, Terminal:

```bash
ApplianceHost=192.168.88.228
SshUser=pi
SshTarget="$SshUser@$ApplianceHost"
ssh "$SshTarget"
```

Windows, PowerShell:

```powershell
$ApplianceHost = '192.168.88.228'
$SshUser = 'pi'
$SshTarget = "$SshUser@$ApplianceHost"
ssh $SshTarget
```

Lần đầu, kiểm tra host fingerprint qua kênh tin cậy trước khi chấp nhận. Không dùng `StrictHostKeyChecking=no`. Trên Mac, chuyển bộ gõ sang **ABC/U.S.** khi nhập mật khẩu SSH; không suy ra mật khẩu sai chỉ từ lỗi do bộ gõ.

### 9.2 Inventory chỉ đọc trên Linux

```bash
cat /etc/os-release
uname -m
dpkg --print-architecture
python3 --version
df -h /
```

```bash
systemctl is-active cups
sudo ss -ltnp
lpstat -v
lpstat -W not-completed -o
```

`lpstat` có thể chưa có trước khi cài CUPS. Nếu máy đã có CUPS/service khác, sao lưu cấu hình trước và không dừng/xóa queue của người khác. Chọn port còn trống.

Môi trường đã dùng là Debian 12, `aarch64`/`arm64`, Python 3.11. Không tự nâng OS nếu thiết bị khác. Root eMMC nhỏ phải có đủ chỗ cho venv, wheel, backup và spool. Khoảng 1 GB trống chỉ là mức chuẩn bị thực tế nên có, không phải bảo đảm dung lượng cho mọi tải.

Nếu cache apt chiếm nhiều chỗ và người quản lý cho phép, `sudo apt-get clean` chỉ dọn cache package đã tải. Không dùng `autoremove`, xóa log/spool hoặc driver để giải quyết đầy đĩa mà chưa đánh giá ảnh hưởng.

### 9.3 Cài dependency hệ thống

Trong SSH Linux, khi đã có quyền cài package và maintenance phù hợp:

```bash
sudo apt-get update
sudo apt-get -s install --no-install-recommends cups python3-cups python3-venv python3-pip git ca-certificates
```

Đọc kết quả simulation. Dừng nếu có removals/upgrades ngoài phạm vi cho phép. Nếu chấp thuận:

```bash
sudo apt-get install --no-install-recommends cups python3-cups python3-venv python3-pip git ca-certificates
sudo systemctl enable --now cups
```

```bash
/usr/bin/python3 -c 'import sys, cups; print(sys.version); print(cups.__file__)'
test -S /run/cups/cups.sock
```

Không cần bật CUPS web admin từ xa hoặc `cupsctl --remote-admin`. Appliance gọi local Unix socket. Quyền dùng CUPS phải được kiểm tra dưới user service; thêm group không tự chứng minh mọi policy đã cho phép.

### 9.4 Tạo user và thư mục mới

Các lệnh sau cố ý dừng nếu phát hiện đã có installation:

```bash
if [ -e /opt/print-appliance ] || [ -e /var/lib/print-appliance ]; then
  echo 'Existing installation: use the update procedure, not a fresh install'
  exit 1
fi
```

```bash
sudo useradd --system --user-group --home-dir /var/lib/print-appliance --shell /usr/sbin/nologin print-appliance
sudo usermod -a -G lpadmin print-appliance
sudo install -d -o print-appliance -g print-appliance -m 0750 /var/lib/print-appliance
sudo install -d -o root -g print-appliance -m 0750 /opt/print-appliance
```

Đừng thay user hiện có hoặc thêm tài khoản web vào root/sudo không mật khẩu. User `print-appliance` không cần đăng nhập SSH.

### 9.5 Copy artifact từ Mac/Windows

Trước tiên thoát SSH hoặc dùng Terminal thứ hai trên **máy cá nhân**. Trong SSH Linux đã mở, tạo nơi upload tạm theo user SSH:

```bash
mkdir -p "$HOME/print-appliance-upload"
chmod 700 "$HOME/print-appliance-upload"
```

Mac/WSL tại repo (biến `SshTarget` đã đặt):

```bash
scp dist/print_appliance-0.1.5-py3-none-any.whl "$SshTarget:print-appliance-upload/"
scp .local-data/release/runtime-requirements.txt "$SshTarget:print-appliance-upload/"
scp .local-data/release/wheel.sha256 "$SshTarget:print-appliance-upload/"
```

Windows PowerShell có file build từ WSL thì copy artifact ra một thư mục Windows. Trong WSL, ví dụ thay `WindowsUser` bằng tên user thật:

```bash
mkdir -p /mnt/c/Users/WindowsUser/Downloads/print-appliance-release
cp dist/print_appliance-0.1.5-py3-none-any.whl .local-data/release/runtime-requirements.txt .local-data/release/wheel.sha256 /mnt/c/Users/WindowsUser/Downloads/print-appliance-release/
```

Sau đó trong PowerShell:

```powershell
$ReleaseDir = Join-Path $HOME 'Downloads\print-appliance-release'
scp "$ReleaseDir\print_appliance-0.1.5-py3-none-any.whl" "${SshTarget}:print-appliance-upload/"
scp "$ReleaseDir\runtime-requirements.txt" "${SshTarget}:print-appliance-upload/"
scp "$ReleaseDir\wheel.sha256" "${SshTarget}:print-appliance-upload/"
```

### 9.6 Clone đúng commit và cài venv trên Linux

Trở lại SSH Linux:

```bash
APP_COMMIT=056e2e7823d8e4579a02aab027d6a2dad678549f
UPLOAD="$HOME/print-appliance-upload"
```

```bash
ACTUAL=$(sha256sum "$UPLOAD/print_appliance-0.1.5-py3-none-any.whl" | cut -d ' ' -f 1)
EXPECTED=$(cat "$UPLOAD/wheel.sha256")
test "$ACTUAL" = "$EXPECTED" || { echo 'Wheel checksum mismatch'; exit 1; }
```

```bash
sudo git clone https://github.com/luongnguyen008/printer-server.git /opt/print-appliance/source
sudo git -C /opt/print-appliance/source checkout --detach "$APP_COMMIT"
sudo /usr/bin/python3 -m venv --system-site-packages /opt/print-appliance/.venv
```

Cài runtime theo dependency export và wheel. Dùng `/usr/bin/python3` Debian 12 để khớp ABI với `python3-cups`:

```bash
sudo /opt/print-appliance/.venv/bin/python -m pip install --require-hashes -r "$UPLOAD/runtime-requirements.txt"
sudo /opt/print-appliance/.venv/bin/python -m pip install --no-deps "$UPLOAD/print_appliance-0.1.5-py3-none-any.whl"
sudo find /opt/print-appliance/.venv/lib/python3.11/site-packages/print_appliance -type d -exec chmod 755 {} +
sudo find /opt/print-appliance/.venv/lib/python3.11/site-packages/print_appliance -type f -exec chmod 644 {} +
```

Không thay bằng Python 3.13 do uv tải rồi kỳ vọng tự import CUPS binding của Python 3.11. Không dùng `sudo pip install` vào system Python hoặc `--break-system-packages`.

Lưu wheel cho rollback:

```bash
sudo install -d -m 0700 "/opt/print-appliance/releases/$APP_COMMIT"
sudo install -m 0600 "$UPLOAD/print_appliance-0.1.5-py3-none-any.whl" "$UPLOAD/runtime-requirements.txt" "$UPLOAD/wheel.sha256" "/opt/print-appliance/releases/$APP_COMMIT/"
```

### 9.7 Kiểm tra package và CUPS bằng service account

```bash
sudo -u print-appliance /opt/print-appliance/.venv/bin/python -c 'import cups, print_appliance; import importlib.metadata as m; print(m.version("print-appliance")); print(cups.__file__); print(print_appliance.__file__)'
```

Đọc health/discovery, không tạo queue hoặc in:

```bash
sudo -u print-appliance /opt/print-appliance/.venv/bin/python - <<'PY'
from print_appliance.cups import PyCupsBackend
backend = PyCupsBackend()
print(backend.health())
discovery = backend.discover()
print('devices:', len(discovery['devices']))
print('drivers:', len(discovery['drivers']))
PY
```

Nếu denied, kiểm tra local CUPS policy, socket và group. Không tắt authentication/privacy toàn cục để làm test pass. Discovery thành công chưa chứng minh queue creation, hold/release hoặc cancel đã được cho phép.

### 9.8 Đặt mật khẩu, cài service loopback

```bash
sudo -u print-appliance /opt/print-appliance/.venv/bin/print-appliance admin-password --data-dir /var/lib/print-appliance
```

Nhập hai lần; không truyền password trên command line. Reset sau này bằng chính lệnh này sẽ hủy các phiên admin hiện có.

```bash
sudo install -m 0644 /opt/print-appliance/source/deploy/print-appliance.service /etc/systemd/system/print-appliance.service
sudo systemctl daemon-reload
sudo systemctl enable --now print-appliance
```

```bash
systemctl is-active print-appliance cups
sudo journalctl -u print-appliance -n 50 --no-pager
curl -sS --retry 8 --retry-connrefused --retry-delay 1 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/
```

Kết quả HTTP cuối kỳ vọng là `200`; service vừa start có thể chưa bind ngay nên lệnh readiness có retry connection refused. `000` kéo dài cần đọc journal/bind/port, không coi là lỗi mật khẩu. API client không có key phải trả `401`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/api/v1/printers
```

Service chạy non-root, restart khi lỗi và chỉ được ghi data directory theo systemd hardening. `After=cups.service` là thứ tự startup, không phải bảo đảm CUPS luôn sẵn sàng; ứng dụng phải báo unavailable khi CUPS lỗi.

### 9.9 Truy cập an toàn từ máy cá nhân

Cách mặc định là SSH tunnel, không cần đổi listener hoặc mở firewall. Trên **Mac**:

```bash
ssh -N -L 127.0.0.1:18081:127.0.0.1:8081 "$SshTarget"
```

Trên **Windows PowerShell**:

```powershell
ssh -N -L 127.0.0.1:18081:127.0.0.1:8081 $SshTarget
```

Mở `http://127.0.0.1:18081/` trên máy cá nhân, giữ tunnel mở. Đây là tunnel tới installation loopback vừa tạo. Nếu service hiện có chỉ bind IP LAN, đích tunnel phải là IP LAN đó thay vì `127.0.0.1`.

Muốn nhiều máy LAN truy cập trực tiếp, quản trị phải phê duyệt listener/firewall hoặc TLS reverse proxy. Ví dụ **HTTP trong LAN tin cậy**, không phải HTTPS:

```bash
sudo systemctl edit print-appliance
```

Nhập drop-in, thay IP bằng địa chỉ đã reservation:

```ini
[Service]
Environment=PRINT_APPLIANCE_HOST=192.168.88.228
Environment=PRINT_APPLIANCE_SECURE_COOKIE=0
```

Sau khi xác nhận không có lệnh đang xử lý:

```bash
sudo systemctl daemon-reload
sudo systemctl restart print-appliance
```

Chỉ mở firewall từ subnet/client cần thiết theo chính sách của site. Không tự bật/tắt UFW trên thiết bị đang vận hành, không port-forward ra Internet. HTTP không mã hóa password/key. Nếu dùng TLS reverse proxy, cấu hình forwarding/scheme/origin đúng và bật Secure cookie; đừng bật `Secure` trên HTTP rồi kết luận login bị lỗi. TLS cụ thể phụ thuộc tên miền/chứng chỉ/proxy tại site và không có bộ cài tự động trong repo.

### 9.10 Chốt release

So sánh package với source trước khi ghi release identifier:

```bash
sudo /opt/print-appliance/.venv/bin/python - <<'PY'
from pathlib import Path
import hashlib
import print_appliance
source = Path('/opt/print-appliance/source/src/print_appliance')
installed = Path(print_appliance.__file__).parent
for path in source.rglob('*'):
    if not path.is_file() or '__pycache__' in path.parts:
        continue
    relative = path.relative_to(source)
    assert hashlib.sha256(path.read_bytes()).digest() == hashlib.sha256((installed / relative).read_bytes()).digest(), str(relative)
print('Source and installed package match')
PY
```

Nếu HTTP, auth, package và read-only CUPS checks đều đạt:

```bash
printf '%s\n' "$APP_COMMIT" | sudo tee /opt/print-appliance/SOURCE_COMMIT >/dev/null
sudo chmod 600 /opt/print-appliance/SOURCE_COMMIT
```

Xóa đúng thư mục upload chỉ chứa ba artifact đã tạo khi không còn cần:

```bash
rm "$UPLOAD/print_appliance-0.1.5-py3-none-any.whl" "$UPLOAD/runtime-requirements.txt" "$UPLOAD/wheel.sha256"
rmdir "$UPLOAD"
```

## 10. Cấu hình máy in và driver

### 10.1 Kiểm tra kết nối trước

Trên Windows:

```powershell
Test-NetConnection 192.168.88.210 -Port 9100
Test-NetConnection 192.168.88.210 -Port 631
```

Trên Mac/WSL:

```bash
ping -c 3 192.168.88.210
nc -vz -w 3 192.168.88.210 9100
nc -vz -w 3 192.168.88.210 631
```

`nc` có thể cần package riêng trong WSL. Kiểm tra quan trọng nhất vẫn là **từ appliance tới máy in**, vì máy cá nhân kết nối được không chứng minh EDATEC kết nối được. Port đóng không luôn là lỗi: model có thể chỉ hỗ trợ một giao thức. Ping bị chặn cũng không chứng minh máy offline.

Không chọn `socket://...:9100` chỉ vì port mở nếu chưa biết ngôn ngữ/driver model. `IPP`, `IPPS`, `socket`, `LPD`, USB và DNS-SD có ý nghĩa khác nhau.

### 10.2 Driver Canon LBP6230dw trên ARM64

Một triển khai đã dùng Canon UFRII LT V5.10, package `cnrdrvcups-ufr2lt-uk_5.10-1.00_arm64.deb`, PPD `CNRCUPSLBP6230ZNK.ppd` với tên Canon LBP6230/6240. Người dùng đã xác nhận có giấy in ra. Đây không phải chứng nhận mọi lựa chọn hoặc mọi bản driver Canon.

Driver `splix` dành cho các model dùng SPL2/SPLc; không thay Canon UFRII LT. Generic PostScript/PCL không được suy ra tương thích với LBP6230dw. Driver chính thức có license riêng; đọc điều kiện của Canon trước tải/cài.

Các lệnh sau chạy **trên Linux ARM64**, trong maintenance window, khi app không có job nonterminal và CUPS không có job đang chờ. Package Canon có maintainer script restart CUPS/reload udev; cài driver là thay đổi hệ thống chung, không chỉ catalog web.

Download chính thức của bundle đã kiểm tra (nhà cung cấp có thể thay URL/nội dung; xác minh lại package):

```bash
mkdir -p "$HOME/canon-driver-install"
chmod 700 "$HOME/canon-driver-install"
cd "$HOME/canon-driver-install"
curl -fL 'https://pdisp01.c-wss.com/gdl/WWUFORedirectTarget.do?id=MDEwMDAwNTk1MDEx&cmp=ACB&lang=EN' -o linux-UFRIILT-drv-v510-m17n.tar.gz
```

```bash
tar -tzf linux-UFRIILT-drv-v510-m17n.tar.gz | head -n 25
tar -xzf linux-UFRIILT-drv-v510-m17n.tar.gz
find . -name cnrdrvcups-ufr2lt-uk_5.10-1.00_arm64.deb
```

Đặt `DEB` bằng đường dẫn `find` trả về, không chọn x86/ARM32:

```bash
DEB=$(find "$PWD" -path '*/ARM64/Debian/cnrdrvcups-ufr2lt-uk_5.10-1.00_arm64.deb' -print -quit)
test -n "$DEB"
dpkg-deb -f "$DEB" Package Version Architecture Depends
dpkg --print-architecture
sudo apt-get -s install "$DEB"
```

Kỳ vọng package architecture và hệ thống đều `arm64`. Dừng nếu simulation đề nghị gỡ/nâng cấp hệ thống ngoài phạm vi. Không chạy vendor `install.sh` như lối tắt.

Sao lưu CUPS, bảo vệ backup và kiểm tra service/queue trước cài:

```bash
DRIVER_BACKUP="$HOME/canon-driver-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$DRIVER_BACKUP"
sudo tar -czf "$DRIVER_BACKUP/cups-before.tar.gz" -C / etc/cups
sudo chown "$(id -u):$(id -g)" "$DRIVER_BACKUP/cups-before.tar.gz"
chmod 600 "$DRIVER_BACKUP/cups-before.tar.gz"
gzip -t "$DRIVER_BACKUP/cups-before.tar.gz"
lpstat -W not-completed -o
```

Xác nhận trên UI không còn `queued`, `held`, `submitting`, `submitted`, `unknown`. Nếu maintenance được phép:

```bash
sudo systemctl stop print-appliance
sudo apt-get install "$DEB"
sudo systemctl start print-appliance
systemctl is-active cups print-appliance
lpinfo -m | grep -i 'LBP6230'
```

Nếu apt thất bại, lưu lỗi và vẫn kiểm tra/start lại appliance, không để service dừng không rõ lý do. Không `autoremove`, purge driver hoặc restore CUPS tùy tiện. `lsb/...` và `usr/...` có thể là alias cùng một PPD, không phải hai máy.

### 10.3 Thêm máy trong UI

1. Mở `/`, đăng nhập admin, chọn **Máy in → Thêm máy in**.
2. Chọn **Tạo cấu hình mới** nếu muốn appliance tạo queue riêng `pa_...`.
3. Chọn thiết bị CUPS discovery. USB/DNS-SD phải thuộc discovery hiện tại; không tự bịa URI.
4. Gõ model/PPD trong Driver và chọn kết quả rõ ràng. Gõ text chưa chọn không phải driver hợp lệ. Catalog chỉ chứa driver đã cài.
5. Chọn định dạng thực sự hỗ trợ: PDF qua driver; ZPL chỉ cho máy hiểu ZPL. Không cấp ZPL cho Canon laser chỉ để thấy đủ tùy chọn.
6. Lưu và kiểm tra queue/driver/URI trong modal xem chi tiết.

Có thể nhập URI mạng trong phần nâng cao nếu thiết bị không được khám phá: URI IPP/IPPS/socket/LPD hợp lệ trong LAN. Không nhập URL file hoặc command shell. URI có credential nhúng không phải nơi lưu mật khẩu trong form này.

**Nhập queue CUPS hiện có** là cách khác, không phải bước thứ hai bắt buộc. Import không sửa queue; máy bắt đầu paused trong app. Resume yêu cầu error policy `stop-printer`. Chỉ import queue dành riêng cho appliance, không queue có sender khác đang dùng.

Nếu được phép đổi policy cho queue dedicated, technician chạy trên Linux:

```bash
sudo lpadmin -p QUEUE -o printer-error-policy=stop-printer
```

Đây là lệnh thay cấu hình; thay `QUEUE` đúng queue đã phê duyệt, không chạy hàng loạt. Gỡ đăng ký khỏi web **không xóa queue CUPS**, kể cả queue managed; việc dọn queue thừa là maintenance riêng.

### 10.4 Sửa và xóa

Đổi tên hoặc tùy chọn trong modal rồi lưu. Đổi mapping/driver có thể làm snapshot của job cũ không còn khớp; appliance giữ job thay vì âm thầm in sang cấu hình mới. Mapping không được sửa khi còn job đã giao hoặc `unknown`.

Gỡ đăng ký/xóa client bị chặn `409` khi còn job nonterminal. Xóa là soft-delete để giữ lịch sử và tombstone. Không có CRUD xóa/sửa lịch sử lệnh. Đăng ký lại cùng queue sau xóa tạo một printer ID mới, không phục hồi quyền cũ.

## 11. Tùy chọn in theo capability

Ba lớp riêng biệt:

1. **Khả năng driver/CUPS:** enum, defaults và constraints máy báo.
2. **Mặc định appliance:** lựa chọn quản trị muốn áp cho PDF.
3. **Quyền ghi đè:** giá trị client được phép chọn; driver hỗ trợ không tự cấp quyền.

![Từ capability driver tới mặc định, quyền client, validation và snapshot](diagrams/06-option-permissions.svg)

_Hình 6 — Driver hỗ trợ một lựa chọn chưa có nghĩa client được dùng nó. Server vẫn kiểm quyền và constraints, không chỉ dựa vào form._

Vào **Máy in → Sửa cấu hình** để chọn trường phổ biến và mở nâng cao khi cần. Mặc định appliance phải nằm trong allowlist tương ứng. UI tự tích mặc định; muốn cố định thì không cấp thêm lựa chọn khác. Không đặt mặc định riêng sẽ dùng default driver đã đọc.

Client chọn **Dùng mặc định** thì bỏ khóa đó khỏi `options`. `options:{}` là hợp lệ khi không có quyền override, nếu schema vẫn đọc được. ZPL gửi nguyên bản và dùng `{}`; PDF driver options không áp lên nội dung ZPL.

### 11.1 Khổ giấy, duplex và căn PDF

| Tùy chọn | Ví dụ | Giới hạn |
| --- | --- | --- |
| `PageSize` | A4, A5, Letter | Chỉ giá trị schema hiện tại cho phép |
| `Duplex` | None, DuplexNoTumble, DuplexTumble | Có constraints giấy/loại giấy/binding |
| `BindEdge` | Left, Top | Driver Canon có cặp ràng buộc với Duplex |
| `print-scaling` | auto, auto-fit, fit, fill, none | Chỉ hiện khi CUPS quảng bá; không có nghĩa borderless |
| Driver-specific | toner save, media, collate… | Không suy từ tên model hoặc copy allowlist máy khác |

Với PPD Canon đã đọc: duplex cạnh dài tương ứng `DuplexNoTumble` với binding Left; cạnh ngắn `DuplexTumble` với binding Top. Một số khổ/media không dùng duplex. Đây là ví dụ của driver hiện tại, không phải quy tắc chung mọi máy.

`fit` hướng tới giữ nội dung trong vùng in; `fill` có thể cắt nội dung để lấp vùng; `none` không yêu cầu scaling. Kết quả phụ thuộc filter/driver/giấy. Máy laser có lề vật lý; “đầy trang” không đồng nghĩa in sát mọi mép. Thử một file kiểm chuẩn trên giấy trước khi đưa vào biểu mẫu nghiệp vụ.

### 11.2 Schema unavailable hoặc stale

`available` là có schema dùng được; `partial` chỉ có một phần thuộc tính. `stale` là mapping đã khác đăng ký. `unknown`/`unavailable` không phải bằng chứng máy không có tính năng.

Adapter đọc PPD groups/choices và IPP scaling, bỏ `PageRegion` như một lựa chọn độc lập để tránh đè `PageSize`. Một pycups build có thể trả constraints rỗng dù PPD có `UIConstraints`; adapter có parser giới hạn cho cặp cụ thể và gộp đối xứng. Resolver/wildcard/cú pháp vượt hỗ trợ phải báo unavailable, không âm thầm bỏ qua.

Schema validation chưa chứng minh mọi tổ hợp hoạt động trên giấy. Nếu UI/server báo conflict, sửa lựa chọn; không đổi Idempotency-Key để vượt qua lỗi. Khi schema không đọc được, chưa thể nhận job mới một cách hợp lệ; CUPS unavailable có thể trả 503. Những job đã nhận trước đó vẫn được giữ để xử lý/đối soát.

Xem lựa chọn queue trên Linux bằng lệnh đọc-only:

```bash
lpoptions -p QUEUE -l
```

## 12. Clients, API key và trang gửi thử

### 12.1 Tạo quyền

1. **Clients → Thêm client**.
2. Đặt tên theo ứng dụng/người dùng thử, ví dụ `odoo-warehouse`.
3. Mở dropdown **Máy được cấp**, tìm và tích từng máy. Các chip thể hiện lựa chọn; bỏ chip để bỏ quyền.
4. Lưu. Sao chép API key trong modal hiện một lần và lưu ở secret store của ứng dụng.
5. Đóng modal sẽ không xem lại key. Mất key thì rotate và cập nhật client; không tìm plaintext trong DB.

Không có printer grants thì key vẫn xác thực nhưng `/client` không có máy để gửi. Sửa client và cấp máy; không cần rotate key chỉ để đổi quyền. Revoke dừng request mới; không mặc nhiên hủy job đã được nhận. Delete còn bị chặn bởi job nonterminal.

![Luồng cấp key, kết nối client, gửi file, theo dõi và xử lý mất phản hồi](diagrams/07-client-workflow.svg)

_Hình 7 — Kết nối được không đồng nghĩa đã được cấp máy. Retry sau mất phản hồi dùng request gốc; reload chỉ phục hồi kết nối, không phục hồi giao dịch in._

### 12.2 Sử dụng `/client`

Mở `http://APPLIANCE_HOST:8081/client`, nhập API key và kết nối. Trang chỉ gọi `/api/v1/...` bằng Bearer, bỏ admin cookies khỏi request; không dùng password admin.

Key được lưu **sessionStorage theo tab** sau khi kết nối. Reload tự xác thực lại và tải danh sách/history của đúng client. Ngắt kết nối hoặc API 401 xóa key. Không đưa key vào URL/localStorage. Một số trình duyệt có thể khôi phục hoặc copy session khi restore/duplicate tab; đừng coi đóng tab là bằng chứng secret đã bị xóa khỏi mọi cơ chế browser.

Nếu storage bị chặn, vẫn dùng được trong bộ nhớ nhưng reload cần nhập lại. Máy dùng chung phải ngắt kết nối khi dùng xong. Script cùng origin có thể đọc sessionStorage; tránh extension không tin cậy và luôn cập nhật bảo mật.

Chọn máy, file, số bản và tùy chọn rồi bấm **Gửi lệnh in**. POST yêu cầu in thật. Reload chỉ giữ danh tính, **không phục hồi file, lựa chọn hoặc request đang gửi**, và không tự POST.

Nếu mất phản hồi, giữ tab và dùng **Gửi lại cùng yêu cầu**: file, fields và request ID không đổi. Nếu đã reload/đóng tab, kiểm tra lịch sử và nhờ admin đối soát trước khi tạo lệnh mới. Lưu kết nối không phải lưu an toàn giao dịch in chưa xác nhận.

## 13. API client: hợp đồng và kết quả

Base URL mẫu: `http://192.168.88.228:8081`. Mọi API client cần:

```text
Authorization: Bearer <API_KEY>
```

| Method và route | Chức năng |
| --- | --- |
| `GET /api/v1/printers` | Máy được cấp cho client |
| `GET /api/v1/printers/{id}/capabilities` | Schema/choices trong quyền của client |
| `POST /api/v1/jobs` | Nhận multipart; bắt buộc Idempotency-Key |
| `GET /api/v1/jobs?limit=50` | Lịch sử của chính client |
| `GET /api/v1/jobs/{id}` | Metadata, status và sự kiện được phép xem |
| `POST /api/v1/jobs/{id}/cancel` | Yêu cầu hủy lệnh của client, có đối soát |

Không có file-download/reprint endpoint. Không có public OpenAPI `/docs` trong bản này. Client không có quyền resume, resolve hoặc quản trị máy.

Danh sách máy trả JSON array, không envelope. Ví dụ rút gọn:

```json
[
  {
    "id": "printer-id",
    "name": "Canon dedicated",
    "formats": ["pdf"],
    "default_options": {"PageSize": "A4"},
    "allowed_options": {"PageSize": ["A4"]},
    "status": "ready",
    "pause_reason": null
  }
]
```

`ready` ở đây là pause latch của app không bật, không phải chứng nhận máy online/đã ra giấy. URI, driver và spool path không nằm trong client list.

Capability là object versioned. Ví dụ hình dạng, không phải allowlist dùng chung:

```json
{
  "schema_version": 1,
  "printer_id": "printer-id",
  "availability": "available",
  "source": "ppd",
  "mapping_fingerprint": "opaque-mapping-hash",
  "schema_fingerprint": "opaque-schema-hash",
  "raw": false,
  "groups": [{"id": "common", "label": "Common"}],
  "options": [
    {"name": "PageSize", "label": "Paper", "group": "common", "default": "A4", "choices": [{"value": "A4", "label": "A4"}]}
  ],
  "constraints": [],
  "default_options": {"PageSize": "A4"}
}
```

Client schema chỉ expose choice được cấp; defaults/constraints có thể giải thích vì sao một giá trị hiệu lực cố định. Fingerprint là dấu phát hiện thay đổi, không phải request ID hoặc giấy phép ghi đè. Khi availability không dùng được, đọc reason; không biến schema rỗng thành quyền tùy chọn tự do.

### 13.1 Multipart của job mới

| Field | Giá trị |
| --- | --- |
| `file` | Nội dung trực tiếp, PDF `%PDF-` hoặc UTF-8 ZPL `^XA...^XZ`; không URL/path server |
| `printer_id` | ID từ danh sách cấp quyền |
| `format` | `pdf` hoặc `zpl`, phù hợp máy |
| `title` | Không rỗng, tối đa 128 ký tự theo server; tránh dữ liệu bí mật |
| `copies` | Số nguyên 1–100; số bản vật lý vẫn phụ thuộc driver/ngôn ngữ |
| `options` | JSON object, chỉ key/value allowlist; ZPL dùng `{}` |

Header `Idempotency-Key` dài 1–128, chỉ `[A-Za-z0-9._~-]`. Scope là client, không phải toàn server. Request identity còn gồm tên file, title, định dạng, copies gốc và nội dung; retry không được tự đổi tên file hoặc chuẩn hóa fields theo cách khác. Thứ tự/whitespace JSON option được canonical hóa, nhưng không nên dựa vào việc server chấp nhận biến thể fields.

**202** sau lưu bền vững cho job mới; **200** cho cùng request đã nhận:

```json
{"job_id":"opaque-job-id","status":"queued","deduplicated":false}
```

Sau dọn history, replay có thể trả `history_expired:true` và metadata tối thiểu, vẫn không tạo lệnh mới. Key hiện tại phải hợp lệ; replay được kiểm trước quyền/mapping mới nhưng không bỏ authentication.

GET job trả các trường `job_id`, `printer_id`, `status`, `accepted_at`, `updated_at`, `title`, `format`, `copies`, `reason`; detail còn có `events` theo thứ tự. Danh sách jobs là array, mới nhất trước, có limit; không phải cơ chế phân trang/export toàn bộ. Client detail không trả file/snapshot nội bộ; admin detail có snapshot và CUPS ID để đối soát.

### 13.2 Mã lỗi

| HTTP | Ý nghĩa | Hành động |
| --- | --- | --- |
| 401 | Key không hợp lệ/revoked | Kiểm tra key, không log key |
| 403 | Máy chưa được cấp | Admin sửa grants |
| 404 | Resource không tồn tại/không thuộc client | Kiểm tra ID; không dò dữ liệu client khác |
| 409 | Cùng request ID nhưng nội dung khác, hoặc xung đột vận hành admin | Giữ bằng chứng; không đổi ID để che một retry |
| 413 | File/body vượt giới hạn | Giảm file hoặc admin đánh giá nâng limit |
| 422 | Fields, signature, enum hoặc constraints sai | Sửa trước một yêu cầu mới được xác định rõ |
| 429 | Hàng đợi đầy hoặc login bị khóa | Chờ/operator kiểm tra; không spam |
| 503 | CUPS/capability/control không xác minh được | Kiểm tra CUPS; không suy ra nội dung chắc chắn chưa nhận chỉ từ lỗi mạng |
| 507 | Thiếu dung lượng | Dừng gửi mới, bảo vệ job đã nhận |
| Timeout/mất kết nối/5xx | Có thể đã nhận trước khi mất phản hồi | Retry chính ID + nội dung gốc, không tự tạo request mới |

Header/signature checks không phải PDF security scanner hoặc ZPL sandbox. Chỉ cấp API key cho sender đáng tin; raw ZPL có thể chứa lệnh thiết bị ngoài việc in một nhãn.

## 14. Gọi API từ macOS và Windows

Các ví dụ sau gửi **một file đã có**. Không dùng PDF giả chỉ gồm header để in thật. Kiểm tra máy/driver và thông báo người vận hành trước POST.

### 14.1 macOS: biến, key và danh sách

Trong Terminal, dùng Bash để đọc key không echo (nếu Terminal đang chạy zsh thì gõ `bash` trước):

```bash
BaseUrl=http://192.168.88.228:8081
read -r -s -p 'Client API key: ' ApiKey
printf '\n'
curl -sS "$BaseUrl/api/v1/printers" -H "Authorization: Bearer $ApiKey"
```

Sao chép đúng ID vào biến; thay đường dẫn file:

```bash
PrinterId=REPLACE_WITH_GRANTED_PRINTER_ID
PdfPath="$HOME/Downloads/invoice.pdf"
test -f "$PdfPath"
```

Đọc schema trước chọn overrides:

```bash
curl -sS "$BaseUrl/api/v1/printers/$PrinterId/capabilities" -H "Authorization: Bearer $ApiKey"
```

Tạo ID **chỉ một lần cho thao tác mới** và lưu để retry:

```bash
mkdir -p .local-data/api-example
chmod 700 .local-data .local-data/api-example
RequestId="manual-$(uuidgen)"
printf '%s\n' "$RequestId" > .local-data/api-example/request-id.txt
chmod 600 .local-data/api-example/request-id.txt
printf '%s' '{}' > .local-data/api-example/options.json
```

Gửi, ghi status và response để người đọc không nhầm curl thành công với HTTP 202:

```bash
curl -sS -w '\nHTTP %{http_code}\n' "$BaseUrl/api/v1/jobs" -H "Authorization: Bearer $ApiKey" -H "Idempotency-Key: $RequestId" -F "printer_id=$PrinterId" -F 'format=pdf' -F 'title=Manual API test' -F 'copies=1' -F 'options=<.local-data/api-example/options.json' -F "file=@$PdfPath;type=application/pdf"
```

Lấy `job_id` response rồi poll:

```bash
JobId=REPLACE_WITH_RETURNED_JOB_ID
curl -sS "$BaseUrl/api/v1/jobs/$JobId" -H "Authorization: Bearer $ApiKey"
```

Nếu timeout/mất phản hồi, **không chạy lại dòng tạo RequestId**. Đọc ID đã lưu và chạy lại chính lệnh curl POST với file/fields/options không đổi:

```bash
RequestId=$(cat .local-data/api-example/request-id.txt)
```

Hủy nếu đó là quyết định thực sự của người vận hành:

```bash
curl -sS -X POST "$BaseUrl/api/v1/jobs/$JobId/cancel" -H "Authorization: Bearer $ApiKey"
```

Dọn biến key khi dùng xong:

```bash
unset ApiKey
```

### 14.2 Windows PowerShell: gọi bằng curl.exe

Dùng `curl.exe`, không `curl` alias của Windows PowerShell 5.1. Không dùng cú pháp `export`, `read` hoặc dấu `\` nối dòng của Bash trong PowerShell.

```powershell
$BaseUrl = 'http://192.168.88.228:8081'
$Secret = Read-Host 'Client API key' -AsSecureString
$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
try { $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }
curl.exe -sS "$BaseUrl/api/v1/printers" -H "Authorization: Bearer $ApiKey"
```

```powershell
$PrinterId = 'REPLACE_WITH_GRANTED_PRINTER_ID'
$PdfPath = Join-Path $HOME 'Downloads\invoice.pdf'
if (-not (Test-Path $PdfPath -PathType Leaf)) { throw 'PDF file does not exist' }
curl.exe -sS "$BaseUrl/api/v1/printers/$PrinterId/capabilities" -H "Authorization: Bearer $ApiKey"
```

Tạo ID một lần và file JSON UTF-8 **không BOM**. File được dùng để tránh lỗi escape dấu nháy của native arguments trên PowerShell 5.1:

```powershell
$WorkDir = Join-Path $HOME 'print-appliance-api-example'
New-Item -ItemType Directory -Force $WorkDir | Out-Null
$RequestId = 'manual-' + [guid]::NewGuid().ToString()
$RequestIdFile = Join-Path $WorkDir 'request-id.txt'
$OptionsFile = Join-Path $WorkDir 'options.json'
[IO.File]::WriteAllText($RequestIdFile, $RequestId, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($OptionsFile, '{}', [Text.UTF8Encoding]::new($false))
```

```powershell
curl.exe -sS -w "`nHTTP %{http_code}`n" "$BaseUrl/api/v1/jobs" -H "Authorization: Bearer $ApiKey" -H "Idempotency-Key: $RequestId" -F "printer_id=$PrinterId" -F 'format=pdf' -F 'title=Manual API test' -F 'copies=1' -F "options=<$OptionsFile" -F "file=@$PdfPath;type=application/pdf"
```

Theo dõi và retry:

```powershell
$JobId = 'REPLACE_WITH_RETURNED_JOB_ID'
curl.exe -sS "$BaseUrl/api/v1/jobs/$JobId" -H "Authorization: Bearer $ApiKey"
```

```powershell
$RequestId = [IO.File]::ReadAllText($RequestIdFile).Trim()
```

Sau dòng đọc ID, chạy lại **lệnh POST cũ**, không thay fields/file/options. Không tạo GUID mới cho transport retry.

```powershell
curl.exe -sS -X POST "$BaseUrl/api/v1/jobs/$JobId/cancel" -H "Authorization: Bearer $ApiKey"
Remove-Variable ApiKey, Secret -ErrorAction SilentlyContinue
```

Key không echo/history literal, nhưng `curl -H` có thể xuất hiện trong process arguments khi đang chạy. Trên máy nhiều user, ưu tiên ứng dụng gọi HTTP trực tiếp hoặc secret mechanism theo chính sách. Không log URL chứa query key, header Authorization, file content hoặc toàn bộ shell transcript.

### 14.3 PDF options và ZPL

Muốn override, ghi JSON đúng schema và quyền vào options file, ví dụ `{"PageSize":"A4"}`. Không copy `Duplex`/`BindEdge` từ ví dụ sang một driver khác. Client cần được cấp các giá trị đó, và tổ hợp hiệu lực phải hợp lệ.

ZPL dùng `format=zpl`, `options={}` và file UTF-8 `^XA...^XZ` cho máy hiểu ZPL. Appliance không rasterize PDF thành nhãn và không kiểm chứng mọi command ZPL. `copies`/`^PQ` có thể tương tác; kiểm tra số nhãn trên model thật.

## 15. API quản trị và tích hợp Odoo/PDA

### 15.1 Quản trị

Admin dùng cookie `pa_admin`, session phía server hết hạn sau 8 giờ và `X-CSRF-Token` cho mutations. Login JSON có password; response trả token và cookie. Bearer client không thay admin session.

| Nhóm | Route chính |
| --- | --- |
| Auth | `POST /admin/api/login`, `GET /admin/api/session`, `POST /admin/api/logout` |
| Status | `GET /admin/api/status`, `/discovery`, `/audit?limit=100` |
| Printer | `GET/POST /admin/api/printers`, `GET/PUT/DELETE .../{id}`, `GET .../{id}/capabilities`, `POST .../import`, `POST .../{id}/pause`, `.../resume` |
| Client | `GET/POST /admin/api/clients`, `GET/PUT/DELETE .../{id}`, `PUT .../{id}/printers`, `POST .../{id}/rotate-key`, `.../revoke` |
| Job | `GET /admin/api/jobs`, `GET .../{id}`, `POST .../{id}/cancel`, `.../resume`, `.../resolve` |
| Settings | `GET/PUT /admin/api/settings` |

`PUT` client với `printer_ids` thay toàn bộ grant list. Nếu chỉ đổi tên, chỉ gửi `{"name":"..."}` để tránh ghi lại grants cũ sau một thu hồi đồng thời. Key không xuất hiện trong list/history/audit. Resolve cần `outcome` terminal và reason 8–1000 ký tự, không submit lại.

Thường dùng UI cho admin để khỏi tự giữ cookie/CSRF. Client tích hợp nghiệp vụ chỉ dùng API client. Không gọi SQL trực tiếp như một API quản trị.

### 15.2 Mẫu luồng tích hợp

1. Admin tạo client riêng cho Odoo/PDA/application và cấp printer IDs.
2. Ứng dụng tạo nội dung PDF hoặc ZPL đúng loại máy; lưu file/parameters và request ID trong cơ sở dữ liệu của chính nó.
3. POST multipart bằng API key trong secret config. Lưu appliance `job_id` và HTTP kết quả.
4. Nếu transport lỗi, gửi lại ID + nội dung gốc. Nếu yêu cầu nghiệp vụ mới thực sự, tạo ID mới.
5. Poll 3–5 giây hoặc backoff có giới hạn; ngừng poll terminal. `unknown` chuyển sang workflow vận hành, không reprint tự động.
6. Nếu rotate key, cập nhật secret; request ID scope client vẫn là cùng danh tính, không tạo client mới như một cách retry.

Để không phụ thuộc timezone, không dùng chỉ timestamp làm ID duy nhất. UUID hoặc ID thao tác đã lưu trong nghiệp vụ phù hợp hơn. Phía Odoo có thể render report và gửi backend-to-backend; người dùng PDA không cần truy cập trực tiếp appliance nếu chỉ làm việc qua Odoo.

Bản này không cung cấp callback/webhook. Không tự suy ra gateway cũ/Odoo addon cũ dùng được nguyên cấu hình với API mới: header, route, request ID và quyền đã khác.

## 16. Cấu hình runtime và giới hạn

### 16.1 Biến môi trường/CLI

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PRINT_APPLIANCE_DATA_DIR` | `/var/lib/print-appliance` | DB/spool/worker lock |
| `PRINT_APPLIANCE_HOST` | `127.0.0.1` | Bind app; IP triển khai, không IP máy in |
| `PRINT_APPLIANCE_PORT` | `8081` | Port HTTP |
| `PRINT_APPLIANCE_SECURE_COOKIE` | `0` | `1`, `true`, `yes` bật Secure admin cookie; cần HTTPS |
| `PRINT_APPLIANCE_CUPS_SOCKET` | `/run/cups/cups.sock` | Unix socket tuyệt đối; không remote TCP CUPS |

`run --data-dir --host --port` override biến tương ứng. Worker interval mặc định 2 giây là settings nội bộ, không có biến môi trường documented để chỉnh. Không dùng một file YAML cũ của gateway làm config cho ứng dụng này.

### 16.2 Giới hạn qua web

| Setting | Mặc định | Khoảng server cho phép |
| --- | --- | --- |
| `max_upload_bytes` | 10 MiB = 10485760 | 64 KiB–512 MiB |
| `max_pending_jobs` | 100 | 1–10000 |
| `min_free_bytes` | 100 MiB = 104857600 | 0–100 GiB |
| `history_retention_days` | 30 | 1–3650 |

HTTP body limit là ít nhất 12 MiB, hoặc upload limit + 2 MiB overhead nếu lớn hơn. Đây không thay connection/rate limits ở mạng/proxy. Không đặt min-free bằng 0 trên eMMC nhỏ chỉ để tiếp nhận thêm.

Job chưa kết thúc tính cả `unknown`. Khi hàng đợi đầy hoặc disk thấp, app từ chối lệnh mới thay vì xóa job đang chờ. Terminal payload bị xóa; history hết hạn bị dọn; tombstone chống trùng lưu riêng và tăng theo số yêu cầu lâu dài. Cần theo dõi cả DB và CUPS spool, không chỉ thư mục appliance.

## 17. Vận hành hàng ngày và xử lý sự cố

### 17.1 Các kiểm tra thường dùng trên Linux

```bash
systemctl is-active print-appliance cups
sudo journalctl -u print-appliance -n 100 --no-pager
df -h /
sudo du -sh /var/lib/print-appliance /var/spool/cups
lpstat -v
lpstat -W not-completed -o
```

Chỉ kiểm tra; không clear queue. Logs có thể chứa metadata lỗi; lọc trước khi đưa lên issue công khai. Uvicorn CLI tắt access log, nhưng proxy/router/monitor vẫn có thể log; không coi đó là giấy phép truyền credential trong URL.

### 17.2 Pause, resume, cancel

- Pause printer giữ queue cho người vận hành; pause latch lưu bền vững trước thao tác CUPS.
- Resume toàn máy cho phép FIFO tiếp tục sau xác minh policy/mapping/kết quả job đang hoạt động.
- Resume riêng chỉ cho job đầu tiên đủ điều kiện, giữ pause cho phần còn lại. Không vượt job trước hoặc `unknown`.
- Cancel trước giao CUPS có thể xác nhận chắc chắn. Sau giao phải gọi cancel và poll state; `cancelJob()` trả `None` không phải bằng chứng.
- CUPS stopped/aborted có thể đã ra một phần giấy. Không restart/reprocess như một retry tự động.

Không chạy `cancel -a`, `cupsenable` hoặc `systemctl restart cups` như bước đầu sửa mọi lỗi. Chúng có thể tác động sender/job ngoài appliance hoặc làm mất bằng chứng.

### 17.3 Unknown và job identity

Vào **Lệnh in → Xem**, ghi job ID, CUPS ID, snapshot, reason và events. Đối chiếu CUPS job correlation với `pa-<job-id>`; chỉ terminal state có danh tính khớp mới làm bằng chứng cho lệnh đó.

IPP state: `7=canceled`, `8=aborted`, `9=completed`. Không đọc state 9 thành canceled. Fresh local connection có thể bị CUPS privacy ẩn job-name/owner kể cả root; adapter xác thực cùng connection bằng read-only `adminGetServerSettings()` trước job query. Không tắt global privacy hoặc bỏ correlation check.

Khi CUPS còn nonterminal phải cancel/xác minh trước. Khi không còn lịch sử, cần bằng chứng vận hành đáng tin và reason; thiếu lịch sử không phải bằng chứng chưa in. Admin resolve ghi kết quả terminal và lý do, không in lại nội dung. Một job từng bị unknown đã được đối soát completed bằng correlation/state khớp trên EDATEC, không resend.

![Đối soát unknown bằng CUPS ID, correlation, state và quyết định có lý do](diagrams/08-unknown-resolution.svg)

_Hình 8 — Không gán kết quả của một CUPS job khác cho lệnh đang đối soát. Resolve là ghi nhận có bằng chứng, không in lại._

### 17.4 Bảng lỗi nhanh

| Hiện tượng | Kiểm tra | Tránh |
| --- | --- | --- |
| Không mở được web | IP/bind/port/firewall, service/journal, tunnel | Đổi IP printer để chữa IP app |
| SSH login không được | User, fingerprint, key, keyboard layout/bộ gõ | Reset password/flash OS ngay |
| `No module named fcntl` | Có đang chạy native Windows? | `pip install fcntl` |
| CUPS unavailable | `cups` import/ABI, socket, service account/policy | Fake success, remote-admin không auth |
| Không thấy driver | `lpinfo -m`, đúng model/architecture/filter | Cài splix/generic PS vì cùng tên hãng |
| Không thấy máy ở `/client` | Client grants và active printer | Rotate key vô cớ |
| Key mất sau reload | sessionStorage bị chặn, 401, có đổi origin/port/tab? | Đưa key vào URL |
| Login admin lặp | Secure cookie trên HTTP, session expiry, origin | Bỏ CSRF/SameSite |
| Tạo queue báo discovery URI | Rediscover, manual URI trống/đúng, DNS-SD còn hiện | Giả mạo USB/DNS-SD URI |
| Job held sau đổi driver | Snapshot/mapping fingerprint và settings | Ép job cũ dùng driver mới |
| Job unknown nhưng CUPS completed | Private auth/correlation/CUPS ID/state | Tạo request ID mới để in lại |
| 409 dedup conflict | Tên file/title/copies/options/hash so với lần đầu | Xóa tombstone |
| 507/disk gần đầy | App spool, DB, CUPS retention, apt cache | Xóa unknown payload hoặc DB/WAL |
| Toast/UI cũ | Hard reload, asset hash, wheel/source parity | Patch riêng JS trên EDATEC |

## 18. Sao lưu và phục hồi

![Hai luồng backup đầy đủ và restore có kiểm soát, với điều kiện trước activation](diagrams/09-backup-restore.svg)

_Hình 9 — Backup và restore không đối xứng: restore phải đối soát lệnh mới sau backup và kiểm dữ liệu trước khi cho worker chạy._

### 18.1 Backup SQLite online

Lệnh CLI dùng SQLite backup API, xử lý WAL và kiểm integrity. Destination phải chưa tồn tại và khác live DB. Trên Linux:

```bash
sudo install -d -o print-appliance -g print-appliance -m 0750 /var/backups/print-appliance
BACKUP_NAME="db-$(date +%Y%m%d-%H%M%S).sqlite3"
sudo -u print-appliance /opt/print-appliance/.venv/bin/print-appliance backup --data-dir /var/lib/print-appliance --destination "/var/backups/print-appliance/$BACKUP_NAME"
```

Đây **chỉ backup DB**, không đủ phục hồi spool của queued/held/unknown. Không copy riêng `appliance.sqlite3` khi service đang chạy và WAL có dữ liệu.

### 18.2 Backup đầy đủ khi đã maintenance

Xác nhận không còn job nonterminal trong UI và không còn CUPS job đang chờ. Nếu có unknown, xử lý có phép trước; không gọi đó là queue trống.

Trên Linux, tạo backup do user SSH được phép giữ. Thư mục này chứa dữ liệu riêng, không đưa vào Git:

```bash
BACKUP_DIR="$HOME/appliance-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$HOME/appliance-backups" "$BACKUP_DIR"
lpstat -W not-completed -o
```

Tạo archive trong subshell với trap start service khi lệnh backup lỗi. Kiểm tra lại DB sau khi stop để tránh bỏ sót lệnh vừa nhận:

```bash
(
  set -eu
  trap 'sudo systemctl start print-appliance' EXIT
  sudo systemctl stop print-appliance
  sudo /opt/print-appliance/.venv/bin/python -c "import sqlite3; c=sqlite3.connect('file:/var/lib/print-appliance/appliance.sqlite3?mode=ro',uri=True); assert c.execute(\"select count(*) from jobs where status not in ('completed','failed','canceled')\").fetchone()[0]==0, 'Nonterminal jobs: arrange maintenance before this procedure'; c.close()"
  sudo tar -czf "$BACKUP_DIR/full-appliance.tar.gz" -C / var/lib/print-appliance etc/cups etc/systemd/system/print-appliance.service opt/print-appliance/SOURCE_COMMIT opt/print-appliance/releases
)
```

Nếu dùng drop-in systemd, bổ sung `etc/systemd/system/print-appliance.service.d` vào archive sau khi kiểm thư mục tồn tại. CUPS backup không đồng nghĩa đã lưu package driver/dependencies; giữ inventory và bộ cài/license để tái tạo khi phần cứng hỏng.

```bash
sudo chown "$(id -u):$(id -g)" "$BACKUP_DIR/full-appliance.tar.gz"
chmod 600 "$BACKUP_DIR/full-appliance.tar.gz"
gzip -t "$BACKUP_DIR/full-appliance.tar.gz"
sha256sum "$BACKUP_DIR/full-appliance.tar.gz" > "$BACKUP_DIR/SHA256SUMS"
chmod 600 "$BACKUP_DIR/SHA256SUMS"
systemctl is-active print-appliance
```

Đưa backup ra thiết bị khác. Trên Mac:

```bash
mkdir -p "$HOME/private-appliance-backups"
chmod 700 "$HOME/private-appliance-backups"
scp "$SshTarget:appliance-backups/REPLACE_BACKUP_TIMESTAMP/full-appliance.tar.gz" "$HOME/private-appliance-backups/"
chmod 600 "$HOME/private-appliance-backups/full-appliance.tar.gz"
```

Windows PowerShell:

```powershell
$BackupLocal = Join-Path $HOME 'private-appliance-backups'
New-Item -ItemType Directory -Force $BackupLocal | Out-Null
scp "${SshTarget}:appliance-backups/REPLACE_BACKUP_TIMESTAMP/full-appliance.tar.gz" $BackupLocal
```

Dùng thư mục user riêng, ACL phù hợp và ổ mã hóa theo chính sách trên Windows. Không dùng `ssh ... > backup.tar.gz` trong Windows PowerShell 5.1 cho luồng nhị phân: redirection có thể làm hỏng archive; dùng SCP.

### 18.3 Restore có kiểm soát

Restore có thể làm mất job mới và phá idempotency nếu snapshot cũ thiếu lệnh đã giao. Chỉ restore sau khi đã lưu backup hiện tại, đối soát mọi job nhận sau backup và chấp thuận maintenance. Không restore DB cũ như cách thử xem “có hết lỗi không”.

Ví dụ dưới chỉ phục hồi **app data** trên Linux; không restore toàn `/etc/cups` hoặc service/driver chung tự động:

```bash
ARCHIVE=/absolute/path/to/full-appliance.tar.gz
gzip -t "$ARCHIVE"
tar -tzf "$ARCHIVE" | head -n 30
```

Xác minh checksum và archive nguồn tin cậy. Khi đã có backup trạng thái hiện tại và quyết định restore:

```bash
sudo systemctl stop print-appliance
sudo mv /var/lib/print-appliance "/var/lib/print-appliance-before-restore-$(date +%Y%m%d-%H%M%S)"
sudo tar -xzf "$ARCHIVE" -C / var/lib/print-appliance
sudo chown -R print-appliance:print-appliance /var/lib/print-appliance
```

```bash
sudo -u print-appliance /opt/print-appliance/.venv/bin/python - <<'PY'
import sqlite3
path = 'file:/var/lib/print-appliance/appliance.sqlite3?mode=ro'
connection = sqlite3.connect(path, uri=True)
assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert connection.execute("SELECT count(*) FROM jobs WHERE status NOT IN ('completed','failed','canceled')").fetchone()[0] == 0, 'Restored nonterminal jobs: keep service stopped; reconcile before activation'
print('Integrity OK; no restored nonterminal jobs')
connection.close()
PY
```

Chỉ tiếp tục khi kiểm tra trên pass. Nếu backup có nonterminal job, giữ service dừng và lập kế hoạch đối soát/khôi phục riêng với người quản lý; không start để thử vì queued job có thể được giao ngay. Chọn package/schema tương thích với backup, kiểm snapshot với CUPS thực, rồi mới start:

```bash
sudo systemctl start print-appliance
sudo journalctl -u print-appliance -n 50 --no-pager
```

Không xóa thư mục before-restore cho tới khi đã xác minh. Restore app data có thể đưa queued job cũ trở lại; operator phải đối soát và quyết định trạng thái trước khi để in tiếp. Backup/restore không chứng minh job vật lý chưa được thực hiện.

## 19. Cập nhật bằng Git, checksum và rollback

Quy trình bắt buộc: **sửa/test trên máy phát triển → commit/push → checkout đúng commit trên Linux → cài wheel cùng commit → kiểm source/package/served assets**. Không sửa riêng Python/JS trên thiết bị.

![Luồng release cùng commit từ Mac hoặc WSL tới Linux, kiểm tra và rollback](diagrams/10-git-rollout.svg)

_Hình 10 — Checkout source không đủ chứng minh package đang chạy đúng. Chỉ ghi SOURCE_COMMIT sau xác minh; rollback phụ thuộc tính tương thích dữ liệu._

### 19.1 Chuẩn bị release mới

Trên Mac hoặc WSL:

```bash
git switch main
git pull --ff-only origin main
uv sync --frozen --python 3.11 --extra dev
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv build
```

Ghi commit mới và version wheel thực. Các lệnh 0.1.5 trong báo cáo chỉ áp cho mốc 0.1.5; version khác phải đổi tên artifact đồng bộ, không đổi version trong device source.

Chạy lại browser suite, export dependency/checksum như phần 8. Upload vào thư mục tạm và giữ previous wheel. Kiểm disk, active jobs, CUPS inventory; backup stopped-service đầy đủ trước migrations.

### 19.2 Activate trên Linux

Giả sử thư mục upload đã chứa wheel/checksum/dependency của version mới. Đặt biến rõ ràng; thay placeholder trước chạy:

```bash
NEW_COMMIT=REPLACE_WITH_FULL_COMMIT
NEW_WHEEL=/absolute/path/to/upload/print_appliance-NEW_VERSION-py3-none-any.whl
PREVIOUS_COMMIT=$(sudo cat /opt/print-appliance/SOURCE_COMMIT)
```

```bash
sudo git -C /opt/print-appliance/source status --short
sudo git -C /opt/print-appliance/source fetch origin main
sudo git -C /opt/print-appliance/source checkout --detach "$NEW_COMMIT"
sudo git -C /opt/print-appliance/source rev-parse HEAD
```

Phải là tree sạch trước checkout, HEAD đúng commit, wheel checksum đúng. Với dependency không đổi, cập nhật package không kéo dependency mới. Khi dependency đổi, cài export hash-pinned đã review trong maintenance:

```bash
sudo systemctl stop print-appliance
sudo /opt/print-appliance/.venv/bin/python -m pip install --no-deps --force-reinstall "$NEW_WHEEL"
sudo systemctl start print-appliance
```

Chỉ start khi lệnh pip thành công; nếu pip lỗi, giữ service dừng và dùng rollback, không chạy tiếp tự động. Nếu có dependency changes, thêm bước `pip install --require-hashes -r runtime-requirements.txt` trước wheel. Sau activation: kiểm permission package đọc được dưới user service, health/auth/discovery và package hash như phần 9.10; không gửi lệnh thật trừ khi acceptance đã được cho phép. Lưu wheel mới vào `releases/$NEW_COMMIT` và chỉ ghi `SOURCE_COMMIT` sau kiểm tra thành công.

### 19.3 Rollback

Nếu update chỉ thay frontend/code và không đổi schema/dữ liệu không tương thích, có thể cài lại wheel trước. Chọn đúng wheel đã giữ:

```bash
PREVIOUS_WHEEL=/absolute/path/to/preserved/previous.whl
sudo systemctl stop print-appliance
sudo /opt/print-appliance/.venv/bin/python -m pip install --no-deps --force-reinstall "$PREVIOUS_WHEEL"
sudo git -C /opt/print-appliance/source checkout --detach "$PREVIOUS_COMMIT"
sudo systemctl start print-appliance
```

Kiểm tra rồi khôi phục SOURCE_COMMIT. Nếu dependency đã đổi, rollback dependency cũng phải theo artifact cũ tương thích.

**Không downgrade 0.1.2+ sang 0.1.1 bằng wheel-only trên DB đã soft-delete.** App cũ có thể coi deleted rows là live. Schema/migration rollback yêu cầu backup dữ liệu phù hợp và đối soát job mới trước restore. Không silent rollback mất job đã nhận.

Nếu SSH key tạm được tạo cho rollout, xóa chính authorized-key entry đó và key local sau hoàn tất; giữ các key khác. Không cài GitHub account token trên thiết bị cho repo public.

## 20. Bảo mật, khả năng và giới hạn triển khai

### 20.1 Biện pháp hiện có

- API keys random, plaintext hiển thị một lần, server lưu SHA-256 hash.
- Password admin dùng scrypt có salt; session token phía server lưu hash, cookie HttpOnly/SameSite Strict, CSRF mutation.
- Login guard khóa sau năm lần sai trong cửa sổ năm phút; lock năm phút.
- Không wildcard CORS, không public OpenAPI, CSP cùng origin và no-store cho trang/API.
- Validate enum, URI, queue/options, kích thước file/body, dung lượng và quyền; request không thực thi shell.
- Service non-root, systemd filesystem hardening; data không nằm trong repo.
- Local CUPS authentication và job identity được kiểm trước tracking/control/reconciliation.

Những biện pháp này không thay TLS, firewall, cập nhật OS/driver hoặc kiểm soát client đáng tin. Driver/filter vendor là native executable; PDF/ZPL có thể kích hoạt hành vi phức tạp. Không cấp quyền upload cho người không tin cậy chỉ vì có allowlist option.

### 20.2 Điều chưa được hứa

- Không proof-of-paper universal, exactly-once vật lý hoặc thu hồi giấy đã in.
- Không multi-node HA, replicated storage, cloud/Internet deployment, webhooks hoặc fleet management.
- Không chứng nhận CUPS 3/PPD-free và mọi driverless printer. Queue non-raw không đọc được PPD fingerprint phải fail closed.
- Không auto-resume khi offline hết; không auto-retry unknown.
- Không retained-file reprint/download API, không chỉnh/xóa job history qua CRUD.
- Không benchmark throughput/RAM/CPU dài hạn hoặc dung lượng tối đa cho mọi workload.
- Application cleanup không dọn CUPS spool/history. `PreserveJobFiles`/`PreserveJobHistory` là policy CUPS chung phải inventory và phê duyệt riêng.
- SessionStorage trên `/client` là tiện ích theo tab, không secret vault và không bảo đảm request đang gửi sống qua reload.

## 21. Bằng chứng kiểm thử và checklist nghiệm thu

### 21.1 Đã kiểm tra ở mốc báo cáo

- Đã clone lại repo public vào thư mục mới, checkout mốc 0.1.5 và chạy nguyên luồng uv sync frozen, 93 tests, Ruff, build và CLI/password/web/assets/401 trên Mac. Không dùng dữ liệu hay dependency project cũ để giả định bước setup đúng.
- 93 Python tests pass trên Mac; release 0.1.4 cũng đã chạy 93 tests trên ARM64. 0.1.5 không thay backend, có browser/real-LAN session tests riêng.
- Ruff lint/format, JavaScript syntax, wheel/sdist và isolated-wheel asset/browser checks pass.
- Browser tests cover admin modal, driver search, grants, error/loading, capability/constraints, client immutable retry và session reload/revocation.
- Một test actual FastAPI/SQLite + explicit FakeCups cố ý làm mất HTTP 202 rồi replay: đúng một durable job.
- EDATEC Debian 12/Python 3.11/CUPS 2.4.2/pycups 2.0.1 chạy service non-root, discovery và package/source/served hash đã được kiểm tra.
- Adapter thực đọc được 14 tùy chọn Canon/CUPS và 70 constraint riêng biệt, cùng authenticated correlation/completed metadata.
- Người dùng báo Canon LBP6230dw đã in ra giấy; không phải quan sát tự động của test suite.
- Real LAN kiểm tra reload desktop/mobile, tab isolation, disconnect và revoked key; chặn mọi client POST khi smoke, không in thêm và không đổi printer settings.

Một warning Starlette/httpx TestClient vẫn có trong môi trường test; không coi warning là production outage. Windows chưa được chạy trực tiếp. Workflow review trước đây bị gián đoạn; kiểm thử và manual audit không được gọi là chứng nhận independent review hoàn chỉnh.

### 21.2 Trước đưa vào vận hành chính thức

| Gate | Tiêu chí đạt |
| --- | --- |
| Platform/permission | Python ABI, pycups, socket và service-account auth đúng; không fake production |
| Printer/driver | Model/architecture/filter đúng; test PDF/ZPL trên đúng thiết bị phù hợp |
| Content/options | Giấy, duplex cạnh dài/ngắn, fit/fill, copies/collate ra kết quả kiểm chuẩn |
| FIFO/parallel | Một đường điều phối mỗi máy vật lý; nhiều client không bypass queue |
| Dedup/restart | Lost-response replay, restart sau accept/handoff không tạo lệnh trùng |
| Faults | Offline/hết giấy/pause/resume/cancel/partial-output xử lý có bằng chứng |
| Capacity | Upload/count/free-disk reject đúng; không mất job đã nhận |
| Backup/rollback | Restore thử trên môi trường riêng; giữ metadata/spool, không mất bằng chứng job |
| Security/network | LAN scope, firewall/TLS phù hợp, secrets protected, revoke hoạt động |
| Operator handoff | Người vận hành biết unknown/resume/cancel khác nhau và có người chịu trách nhiệm |

Đánh dấu kết quả và ngày/người thử ở site. Không chạy fault/power-loss test trên queue production đang có việc.

## 22. Tiếp nhận và bảo trì dự án

Người tiếp nhận cần giữ ngoài Git: danh sách thiết bị/IP reservation, tài khoản SSH được phê duyệt, password admin, client secrets, backup policy, driver package/license, release wheel/checksum và kết quả nghiệm thu phần cứng.

Repo public không có nghĩa dữ liệu runtime hoặc secrets được public. Không commit `.local-data`, API keys, ảnh chứa key, spool/PDF/ZPL nghiệp vụ hoặc bản backup. Báo cáo này không chứa các secret đã dùng tại site.

Repo ở mốc này chưa có file `LICENSE` riêng cho mã ứng dụng; public GitHub không tự cấp mọi quyền sử dụng/phân phối. Làm rõ license với chủ repo trước khi tái phân phối. Driver Canon và dependency có license riêng; báo cáo không phân phối lại PPD/filter của nhà sản xuất.

Để sửa lỗi, ghi triệu chứng, version/commit, môi trường và reason không nhạy cảm. Tạo regression rồi sửa nhỏ nhất có thể; test/build/browser; deploy exact commit. Đừng dùng việc xóa dữ liệu hoặc nới kiểm tra danh tính làm fix cho một lỗi đối soát.

## 23. Checklist chạy từ đầu

1. Chọn vai trò: Mac/Windows phát triển hay Linux in thật.
2. Clone repo, checkout mốc và cài Python/uv đúng hướng dẫn.
3. Chạy pytest/lint; đặt password local; mở web loopback để hiểu giao diện.
4. Nếu in thật: inventory/backup Linux, cài CUPS/pycups ABI phù hợp, tạo user/data/venv/service mới.
5. Verify wheel/source, auth và CUPS read dưới service account; mở bằng SSH tunnel hoặc LAN đã phê duyệt.
6. Cài driver đúng model/architecture trong maintenance, không dùng generic driver phỏng đoán.
7. Tạo một registered printer dedicated cho máy, chọn PDF/ZPL đúng khả năng.
8. Đọc schema, đặt defaults/allowlist và thử tổ hợp trên giấy có kiểm soát.
9. Tạo client/grants, lưu key một lần; dùng `/client` hoặc API.
10. Thử dedup/fault/restart/backup/rollback trên môi trường nghiệm thu riêng; bàn giao runbook và secrets qua kênh an toàn.

## 24. Đọc và tái tạo bản HTML

Bản Markdown là nguồn nội dung; `docs/technical-report.html` là bản HTML self-contained để đọc offline hoặc in. Không tải font/script/CDN ngoài. Mở file tải về bằng trình duyệt; GitHub thường hiển thị mã HTML thay vì render trang.

Sơ đồ nguồn nằm trong `docs/diagrams/`. Muốn sửa sơ đồ, sửa `tools/render_report_diagrams.py`, tạo lại SVG rồi render lại HTML. SVG dùng font hệ thống và không có thư viện/ảnh từ Internet:

```bash
python3 tools/render_report_diagrams.py
```

Có thể tái tạo từ checkout có cả báo cáo và tool renderer (commit tài liệu sau mốc runtime 0.1.5; checkout chỉ mốc runtime nêu đầu báo cáo chưa có hai file này):

```bash
uv run --no-project --with markdown==3.7 python tools/render_technical_report.py
```

Mac:

```bash
open docs/technical-report.html
```

Windows PowerShell ở checkout Windows:

```powershell
Start-Process .\docs\technical-report.html
```

Nếu checkout chỉ có trong WSL, copy HTML ra Downloads như artifact ở phần 9.5, hoặc mở đường dẫn WSL qua File Explorer. Bản HTML không cần Python/uv để đọc. Chọn **Print → Save as PDF** nếu cần gửi bản in; kiểm tra preview vì code/table dài có thể chia trang.
