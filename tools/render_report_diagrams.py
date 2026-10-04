"""Generate the report's offline SVG diagrams using only the Python standard library.

Run: python tools/render_report_diagrams.py
"""

from __future__ import annotations

from html import escape
from pathlib import Path

COLORS = {
    "normal": ("#f3f6f9", "#c9d4df", "#243849"),
    "blue": ("#edf5fb", "#8cb6d2", "#174d71"),
    "green": ("#edf7f2", "#90bba4", "#245c43"),
    "amber": ("#fff7e6", "#d8b56e", "#785715"),
    "red": ("#fcf0ef", "#d4a09b", "#853d36"),
}


class Diagram:
    def __init__(self, name: str, title: str, description: str, height: int) -> None:
        self.name, self.title, self.description = name, title, description
        self.height = height
        self.edges: list[str] = []
        self.nodes: list[str] = []

    def text(
        self,
        x: int,
        y: int,
        lines: list[str],
        *,
        size: int = 17,
        color: str = "#243849",
        bold: bool = False,
        anchor: str = "middle",
    ) -> str:
        weight = 650 if bold else 400
        spans = "".join(
            f'<tspan x="{x}" dy="{0 if i == 0 else size + 7}">{escape(line)}</tspan>'
            for i, line in enumerate(lines)
        )
        return (
            f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{anchor}">{spans}</text>'
        )

    def box(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        title: str,
        lines: list[str] | None = None,
        tone: str = "normal",
    ) -> None:
        fill, stroke, ink = COLORS[tone]
        lines = lines or []
        top = y + (h - 22 - len(lines) * 24) // 2 + 17
        content = self.text(x + w // 2, top, [title], color=ink, bold=True)
        if lines:
            content += self.text(x + w // 2, top + 28, lines, size=16, color=ink)
        self.nodes.append(
            '<g data-box="true">'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>'
            f"{content}</g>"
        )

    def diamond(self, x: int, y: int, w: int, h: int, lines: list[str]) -> None:
        self.nodes.append(
            f'<polygon points="{x + w // 2},{y} {x + w},{y + h // 2} '
            f'{x + w // 2},{y + h} {x},{y + h // 2}" fill="#edf5fb" '
            'stroke="#8cb6d2" stroke-width="1.5"/>'
        )
        self.nodes.append(self.text(x + w // 2, y + h // 2 - (len(lines) - 1) * 12 + 6, lines))

    def arrow(
        self,
        points: list[tuple[int, int]],
        label: str = "",
        at: tuple[int, int] | None = None,
        *,
        bidirectional: bool = False,
    ) -> None:
        start = f' marker-start="url(#{self.name}-arrow)"' if bidirectional else ""
        coordinates = " ".join(f"{x},{y}" for x, y in points)
        self.edges.append(
            f'<polyline points="{coordinates}" fill="none" stroke="#617687" stroke-width="1.8" '
            f'marker-end="url(#{self.name}-arrow)"{start}/>'
        )
        if label and at:
            self.nodes.append(self.text(*at, [label], size=15))

    def note(self, x: int, y: int, lines: list[str]) -> None:
        self.nodes.append(self.text(x, y, lines, size=15, color="#53616f"))

    def line(self, x: int, y: int, end_y: int) -> None:
        self.edges.append(
            f'<line x1="{x}" y1="{y}" x2="{x}" y2="{end_y}" stroke="#b3c3cf" '
            'stroke-width="1.5" stroke-dasharray="5 5"/>'
        )

    def svg(self) -> str:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 {self.height}" '
            f'width="920" height="{self.height}" role="img" '
            f'aria-labelledby="{self.name}-title {self.name}-desc" '
            'font-family="system-ui, -apple-system, Segoe UI, sans-serif">\n'
            f'<title id="{self.name}-title">{escape(self.title)}</title>\n'
            f'<desc id="{self.name}-desc">{escape(self.description)}</desc>\n'
            f'<defs><marker id="{self.name}-arrow" viewBox="0 0 10 10" refX="9" refY="5" '
            'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            '<path d="M 0 0 L 10 5 L 0 10 z" fill="#617687"/></marker></defs>\n'
            '<rect width="920" height="100%" rx="16" fill="#fff"/>\n'
            + "\n".join(self.edges + self.nodes)
            + "\n</svg>\n"
        )


def diagrams() -> list[Diagram]:
    result = []
    d = Diagram(
        "01-architecture",
        "Kiến trúc và hai đường truy cập",
        "Client gọi API bằng Bearer key. Admin quản lý bằng session và CSRF. FastAPI lưu SQLite và spool, worker giao CUPS qua Unix socket; CUPS dùng driver để in USB hoặc LAN. Hai cách xác thực không thay thế nhau.",
        650,
    )
    d.box(40, 24, 390, 92, "Client: Odoo / PDA / /client", ["Bearer key + Idempotency-Key"], "blue")
    d.box(490, 24, 390, 92, "Web admin", ["Session cookie + CSRF"], "blue")
    d.box(
        230,
        178,
        460,
        85,
        "FastAPI trên appliance Linux",
        ["Xác thực • quyền • tiếp nhận • quản trị"],
    )
    d.arrow([(235, 116), (235, 145), (350, 145), (350, 178)])
    d.arrow([(685, 116), (685, 145), (570, 145), (570, 178)])
    d.box(40, 310, 340, 92, "SQLite + file spool", ["Job • snapshot • hash • lịch sử"], "green")
    d.box(480, 310, 400, 92, "Worker một process", ["FIFO theo từng printer_id"])
    d.arrow([(350, 263), (350, 286), (210, 286), (210, 310)])
    d.arrow([(570, 263), (570, 286), (680, 286), (680, 310)])
    d.arrow([(380, 356), (480, 356)], "Đọc / ghi", (430, 337), bidirectional=True)
    d.box(480, 459, 400, 86, "CUPS + driver / filter", ["pycups → Unix socket"], "blue")
    d.arrow([(680, 402), (680, 459)])
    d.box(40, 459, 340, 86, "Máy in vật lý", ["USB hoặc mạng LAN"], "green")
    d.arrow([(480, 502), (380, 502)], "Truyền nội dung", (430, 573))
    d.note(460, 612, ["Appliance quản lý yêu cầu; CUPS quản lý driver và truyền tới máy."])
    result.append(d)

    d = Diagram(
        "02-admission",
        "Tiếp nhận và chống gửi trùng",
        "Sau xác thực và kiểm tra đầu vào, server tính digest và tra request ID trong scope client. Cùng digest trả kết quả cũ, khác digest trả 409. Request mới kiểm quyền, cấu hình, tùy chọn và sức chứa; ghi file và transaction job, snapshot, idempotency trước khi trả 202.",
        760,
    )
    d.box(
        255, 20, 410, 78, "Nhận POST /api/v1/jobs", ["API key + request ID + file + fields"], "blue"
    )
    d.box(255, 132, 410, 80, "Xác thực và kiểm đầu vào", ["Digest từ fields gốc + hash file"])
    d.arrow([(460, 98), (460, 132)])
    d.diamond(310, 245, 300, 120, ["Request ID đã có?", "Trong phạm vi client"])
    d.arrow([(460, 212), (460, 245)])
    d.box(30, 250, 220, 112, "Đã có", ["Cùng digest → 200", "Khác digest → 409"], "amber")
    d.arrow([(310, 305), (250, 305)], "Có", (278, 283))
    d.box(
        255,
        408,
        410,
        100,
        "Kiểm tra request mới",
        ["Grants • mapping • capability", "Constraints • capacity"],
        "blue",
    )
    d.arrow([(460, 365), (460, 408)], "Chưa có", (530, 390))
    d.box(710, 408, 185, 100, "Không hợp lệ", ["Trả mã lỗi", "Không nhận job"], "red")
    d.arrow([(665, 458), (710, 458)])
    d.box(
        255,
        552,
        410,
        95,
        "Lưu bền vững",
        ["File + fsync; transaction SQLite", "Job • snapshot • sequence • dedup"],
        "green",
    )
    d.arrow([(460, 508), (460, 552)], "Đạt", (500, 536))
    d.box(255, 685, 410, 55, "202 + job_id: đã nhận, chưa phải đã in", tone="green")
    d.arrow([(460, 647), (460, 685)])
    d.note(783, 610, ["Grant/revocation được", "kiểm lại trong transaction."])
    result.append(d)

    d = Diagram(
        "03-job-lifecycle",
        "Vòng đời lệnh in",
        "Luồng chính queued tới submitting tới submitted và một trạng thái terminal. Held cần sửa nguyên nhân và resume thủ công. Không đủ bằng chứng giao hoặc tracking chuyển unknown, chặn máy và yêu cầu đối soát; resolve ghi kết quả, không gửi lại. Đây là sơ đồ nghiệp vụ rút gọn, không liệt kê mọi chuyển trạng thái nội bộ.",
        640,
    )
    d.box(35, 50, 230, 86, "queued", ["Đã nhận, chờ FIFO"], "blue")
    d.box(345, 50, 230, 86, "submitting", ["Ý định giao đã lưu"], "blue")
    d.box(655, 50, 230, 86, "submitted", ["Có CUPS ID; theo dõi"], "blue")
    d.arrow([(265, 93), (345, 93)])
    d.arrow([(575, 93), (655, 93)])
    d.box(35, 225, 230, 108, "held", ["Pause / offline / drift", "Resume do admin"], "amber")
    d.arrow([(150, 136), (150, 225)], "Giữ trước giao", (235, 184))
    d.arrow([(65, 225), (65, 172), (55, 172), (55, 136)])
    d.box(345, 225, 230, 108, "unknown", ["Chưa rõ kết quả", "Chặn tiến trình máy"], "red")
    d.arrow([(460, 136), (460, 225)])
    d.arrow([(770, 136), (770, 180), (530, 180), (530, 225)])
    d.box(655, 225, 230, 108, "Kết quả terminal", ["completed / failed", "canceled"], "green")
    d.arrow([(840, 136), (905, 136), (905, 279), (885, 279)])
    d.arrow([(575, 279), (655, 279)], "Đối soát", (615, 260))
    d.box(
        95,
        395,
        730,
        88,
        "Các nhánh khác",
        [
            "queued / held có thể hủy trước giao; lỗi xác định có thể kết thúc failed.",
            "Hủy sau giao cần đối chiếu kết quả CUPS, không hứa thu hồi giấy.",
        ],
    )
    d.box(
        95,
        528,
        730,
        78,
        "Giới hạn bảo đảm",
        ["completed là CUPS báo hoàn thành, không phải proof-of-paper."],
        "amber",
    )
    result.append(d)

    d = Diagram(
        "04-cups-handoff",
        "Giao CUPS theo hold → lưu ID → release",
        "Client nhận 202 sau durable acceptance. Worker ghi submitting và correlation, gửi CUPS ở trạng thái held, lưu CUPS ID rồi mới release. Poll xác thực trên cùng connection và đối chiếu ID với correlation. Nếu đứt giữa các bước thì đối soát, không tự gửi bản sao.",
        705,
    )
    for x, label in ((115, "Client"), (345, "App + worker"), (575, "SQLite"), (805, "CUPS")):
        d.box(x - 90, 20, 180, 60, label, tone="blue")
        d.line(x, 90, 610)
    d.arrow([(115, 123), (345, 123)], "POST file + request ID", (230, 109))
    d.arrow([(345, 174), (575, 174)], "Lưu bền vững", (460, 160))
    d.arrow([(345, 225), (115, 225)], "202 + job_id", (230, 211))
    d.arrow([(345, 280), (575, 280)], "submitting + correlation", (460, 266))
    d.arrow([(345, 335), (805, 335)], "submit_held: chưa cho in", (575, 321))
    d.arrow([(805, 390), (345, 390)], "CUPS job ID", (575, 376))
    d.arrow([(345, 445), (575, 445)], "Lưu ID + submitted", (460, 431))
    d.arrow([(345, 500), (805, 500)], "Release khi được phép", (575, 486))
    d.arrow([(345, 555), (805, 555)], "Auth + poll ID / correlation", (575, 541))
    d.arrow([(805, 605), (345, 605)], "State → lưu kết quả", (575, 591))
    d.box(
        75, 637, 770, 52, "Đứt giữa các bước → đối soát; không tự submit lại nội dung", tone="amber"
    )
    result.append(d)

    d = Diagram(
        "05-printer-fifo",
        "FIFO riêng và xử lý song song",
        "Mỗi printer_id có FIFO theo sequence và một công việc CUPS đang được theo dõi. Các máy đăng ký khác có thể xử lý độc lập, tối đa bốn tác vụ máy mỗi vòng. Unknown chặn máy tương ứng, không chặn tất cả máy. Nhiều ID cùng trỏ một máy vật lý không tạo FIFO chung.",
        485,
    )
    for y, label, jobs, tone in (
        (40, "Máy đăng ký A", "A1 → A2 → A3", "green"),
        (175, "Máy đăng ký B", "B1 → B2 → B3", "blue"),
        (310, "Máy đăng ký C", "C1 unknown • C2 chờ", "amber"),
    ):
        d.box(25, y, 235, 90, label, ["FIFO theo sequence"])
        d.box(
            315,
            y,
            270,
            90,
            jobs,
            ["Một lệnh đang giao / theo dõi" if label[-1] != "C" else "Chặn máy C; không resend"],
            tone,
        )
        d.box(
            650,
            y,
            245,
            90,
            "CUPS / máy " + label[-1],
            ["Xử lý độc lập" if label[-1] != "C" else "Đối soát thủ công"],
            tone,
        )
        d.arrow([(260, y + 45), (315, y + 45)])
        if label[-1] != "C":
            d.arrow([(585, y + 45), (650, y + 45)])
    d.note(
        460,
        448,
        ["Tối đa 4 tác vụ máy mỗi vòng. Hai printer_id cùng một máy vật lý không có FIFO chung."],
    )
    result.append(d)

    d = Diagram(
        "06-option-permissions",
        "Khả năng máy không đồng nghĩa quyền client",
        "CUPS và driver cung cấp capability. Admin chọn defaults và các giá trị override. Client chỉ thấy quyền được cấp; dùng mặc định bỏ khóa đó. Server kiểm enum, constraints và fingerprint, lưu effective options trong snapshot. ZPL không dùng PDF options.",
        605,
    )
    d.box(
        60,
        25,
        340,
        96,
        "CUPS / driver",
        ["Choices • defaults • constraints", "PPD + thuộc tính IPP"],
        "blue",
    )
    d.box(
        520,
        25,
        340,
        96,
        "Quản trị máy",
        ["Mặc định appliance", "Các giá trị client được chọn"],
        "blue",
    )
    d.box(
        240,
        181,
        440,
        96,
        "Schema theo printer_id",
        ["Capability ∩ quyền được cấp", "Fingerprint để phát hiện thay đổi"],
    )
    d.arrow([(230, 121), (230, 150), (350, 150), (350, 181)])
    d.arrow([(690, 121), (690, 150), (570, 150), (570, 181)])
    d.box(
        60,
        337,
        340,
        94,
        "Client chọn",
        ["Dùng mặc định → bỏ khóa", "Override → chọn giá trị được cấp"],
    )
    d.box(
        520,
        337,
        340,
        94,
        "Server kiểm tra",
        ["Enum • constraints • mapping", "Không tin form client"],
        "green",
    )
    d.arrow([(350, 277), (350, 303), (230, 303), (230, 337)])
    d.arrow([(400, 384), (520, 384)])
    d.box(
        240,
        491,
        440,
        85,
        "Snapshot của job mới",
        ["Tùy chọn hiệu lực không tự đổi về sau"],
        "green",
    )
    d.arrow([(690, 431), (690, 461), (570, 461), (570, 491)])
    d.note(150, 520, ["ZPL: options = {}", "Không áp PDF defaults."])
    result.append(d)

    d = Diagram(
        "07-client-workflow",
        "Từ cấp quyền tới theo dõi lệnh",
        "Admin tạo client, cấp máy và cung cấp one-time key. Trang client xác thực, lấy máy được cấp, chọn file và gửi. Nhận job_id rồi poll. Nếu mất phản hồi, chỉ retry request gốc khi còn trong tab; nếu reload làm mất request state thì xem history và đối soát. Reload chỉ tự kết nối lại, không tự in.",
        650,
    )
    d.box(245, 20, 430, 80, "Admin tạo client và cấp máy", ["Sao chép API key một lần"], "blue")
    d.box(245, 138, 430, 80, "Client kết nối bằng key", ["Tải máy được cấp + lịch sử"])
    d.arrow([(460, 100), (460, 138)])
    d.box(
        245,
        258,
        430,
        82,
        "Chọn máy • file • copies • options",
        ["Bấm gửi = yêu cầu in thật"],
        "amber",
    )
    d.arrow([(460, 218), (460, 258)])
    d.box(720, 250, 175, 102, "Lỗi xác định", ["401 / 403 / 422", "Không tự đổi ID"], "red")
    d.arrow([(675, 300), (720, 300)], "Lỗi", (697, 282))
    d.diamond(335, 382, 250, 102, ["Có phản hồi nhận?"])
    d.arrow([(460, 340), (460, 382)])
    d.box(
        35,
        527,
        385,
        96,
        "Có job_id",
        ["GET status / history", "Không tạo thêm job để kiểm tra"],
        "green",
    )
    d.arrow([(335, 433), (225, 433), (225, 527)], "Có", (265, 412))
    d.box(
        500,
        527,
        385,
        96,
        "Mất phản hồi",
        ["Còn tab → retry nguyên request", "Mất state → lịch sử + đối soát"],
        "amber",
    )
    d.arrow([(585, 433), (690, 433), (690, 527)], "Chưa rõ", (658, 412))
    d.note(125, 384, ["sessionStorage lưu key.", "Reload không tự POST."])
    result.append(d)

    d = Diagram(
        "08-unknown-resolution",
        "Đối soát unknown: không tự in lại",
        "Giữ payload và chặn máy. Xác thực connection CUPS rồi kiểm ID, correlation và state. Matching terminal evidence có thể được admin dùng để resolve có lý do; nonterminal cần xử lý và xác minh trước; thiếu hoặc sai danh tính giữ unknown và cần bằng chứng vận hành. Resolve không gửi nội dung.",
        655,
    )
    d.box(
        255,
        20,
        410,
        85,
        "unknown: giữ file, chặn máy",
        ["Không coi thiếu history là chưa in"],
        "red",
    )
    d.box(255, 147, 410, 85, "Đọc CUPS có xác thực", ["CUPS ID + correlation + state"], "blue")
    d.arrow([(460, 105), (460, 147)])
    d.diamond(305, 275, 310, 120, ["Danh tính khớp", "và terminal?"])
    d.arrow([(460, 232), (460, 275)])
    d.box(
        35,
        442,
        390,
        108,
        "Bằng chứng đủ",
        ["Admin resolve + reason", "Ghi completed / failed / canceled"],
        "green",
    )
    d.arrow([(305, 335), (230, 335), (230, 442)], "Có", (258, 314))
    d.box(
        495,
        442,
        390,
        108,
        "Chưa đủ bằng chứng",
        ["Nonterminal: xử lý / xác minh trước", "Thiếu history: đối soát vận hành"],
        "amber",
    )
    d.arrow([(615, 335), (690, 335), (690, 442)], "Không", (662, 314))
    d.note(
        460,
        602,
        [
            "Thiếu / sai correlation: giữ unknown, không gán kết quả từ một job CUPS khác.",
            "Resolve chỉ sửa lịch sử có bằng chứng, không resend payload.",
        ],
    )
    result.append(d)

    d = Diagram(
        "09-backup-restore",
        "Backup và restore là hai quy trình có điều kiện",
        "Backup maintenance kiểm nonterminal jobs và CUPS, dừng service và kiểm lại rồi lưu full data cùng cấu hình/artifacts, checksum và bản ngoài thiết bị. Restore phải đối soát jobs mới sau backup, lưu trạng thái hiện tại, dùng package tương thích, kiểm integrity/snapshot/nonterminal rồi mới start. DB-only không đủ phục hồi payload.",
        715,
    )
    d.box(35, 20, 395, 62, "BACKUP ĐẦY ĐỦ", tone="blue")
    d.box(490, 20, 395, 62, "RESTORE CÓ KIỂM SOÁT", tone="amber")
    left = [
        ("Maintenance được phép", ["Không còn app nonterminal", "CUPS không có job chờ"]),
        ("Stop service và kiểm lại", ["Tránh job vừa được nhận", "Không backup bằng copy DB sống"]),
        (
            "Archive được bảo vệ",
            ["DB + spool + cấu hình + artifacts", "Checksum • kiểm archive • off-device"],
        ),
        (
            "Start service sau backup",
            ["Kiểm readiness / service", "Backup driver có kế hoạch riêng"],
        ),
    ]
    right = [
        (
            "Duyệt quyết định restore",
            ["Đối soát jobs nhận sau backup", "Backup trạng thái hiện tại"],
        ),
        ("Giữ service dừng", ["Restore app data đúng phạm vi", "Dùng package/schema tương thích"]),
        (
            "Kiểm trước activation",
            ["Integrity • snapshot • nonterminal", "Chưa đạt → giữ dừng, đối soát"],
        ),
        (
            "Start chỉ khi đủ điều kiện",
            ["Không coi backup cũ là chưa in", "Giữ bản before-restore"],
        ),
    ]
    for x, blocks in ((35, left), (490, right)):
        for i, (title, lines) in enumerate(blocks):
            y = 119 + i * 135
            d.box(x, y, 395, 98, title, lines, "normal" if x == 35 else "amber")
            if i:
                d.arrow([(x + 197, y - 37), (x + 197, y)])
    d.note(
        460,
        691,
        ["Backup SQLite online chỉ có DB. Full restore cần payload và đối soát kết quả in."],
    )
    result.append(d)

    d = Diagram(
        "10-git-rollout",
        "Release theo một commit và rollback có điều kiện",
        "Sửa, test, build trên Mac hoặc WSL rồi commit push và tạo artifacts cùng commit. Thiết bị kiểm maintenance, backup, checkout đúng commit và install matching wheel; kiểm hash/readiness trước ghi SOURCE_COMMIT. Khi thất bại chỉ rollback wheel nếu dữ liệu tương thích; migration cần backup và đối soát, không restore mù.",
        670,
    )
    d.box(
        40,
        25,
        360,
        92,
        "Mac / WSL",
        ["Sửa → test → build", "Commit / push; artifacts cùng commit"],
        "blue",
    )
    d.box(
        520,
        25,
        360,
        92,
        "GitHub + bộ release",
        ["Commit cố định", "Wheel • dependencies • checksums"],
    )
    d.arrow([(400, 71), (520, 71)])
    d.box(
        235,
        171,
        450,
        82,
        "Linux: kiểm trước update",
        ["Disk • job/CUPS • maintenance • backup"],
        "amber",
    )
    d.arrow([(700, 117), (700, 144), (570, 144), (570, 171)])
    d.box(235, 296, 450, 82, "Checkout + install", ["Đúng commit; stop service; matching wheel"])
    d.arrow([(460, 253), (460, 296)])
    d.diamond(315, 421, 290, 110, ["Kiểm tra activation đạt?", "Hash • UI • readiness"])
    d.arrow([(460, 378), (460, 421)])
    d.box(35, 572, 390, 78, "Ghi SOURCE_COMMIT", ["Giữ previous release; cleanup key tạm"], "green")
    d.arrow([(315, 476), (230, 476), (230, 572)], "Đạt", (270, 455))
    d.box(
        495,
        572,
        390,
        78,
        "Rollback được duyệt",
        ["Tương thích dữ liệu? Hay cần đối soát?"],
        "amber",
    )
    d.arrow([(605, 476), (690, 476), (690, 572)], "Lỗi", (650, 455))
    result.append(d)
    return result


def main() -> None:
    destination = Path(__file__).resolve().parents[1] / "docs/diagrams"
    destination.mkdir(parents=True, exist_ok=True)
    for diagram in diagrams():
        (destination / f"{diagram.name}.svg").write_text(diagram.svg(), encoding="utf-8")
    print(f"Written {len(diagrams())} SVG diagrams in {destination}")


if __name__ == "__main__":
    main()
