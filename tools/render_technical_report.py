"""Render the report without changing application dependencies.

Run: uv run --no-project --with markdown==3.7 python tools/render_technical_report.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

CSS = """
:root{color-scheme:light;--ink:#202832;--muted:#53616f;--line:#d9e1e8;--accent:#145a73}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f6f8;color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}
.shell{max-width:1140px;margin:auto;padding:40px 42px 64px;background:white;min-height:100vh}
.report-bar{font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:28px;display:flex;gap:16px;flex-wrap:wrap}
h1,h2,h3,h4{line-height:1.3;scroll-margin-top:20px}h1{font-size:34px;letter-spacing:-.6px;margin-bottom:14px}h2{font-size:25px;margin:48px 0 18px;border-top:1px solid var(--line);padding-top:24px}h3{font-size:20px;margin-top:30px}h4{font-size:17px}
p,ul,ol{margin:12px 0}li{margin:5px 0}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}strong{font-weight:650}
code{font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;background:#edf2f5;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}
pre{border:1px solid var(--line);background:#f5f7f9;border-radius:7px;padding:15px 18px;overflow-x:auto;margin:18px 0;max-width:100%}pre code{background:none;padding:0;border-radius:0;white-space:pre;overflow-wrap:normal}
blockquote{margin:20px 0;padding:8px 20px;border-left:4px solid #b88728;background:#fff8e8}blockquote p{margin:6px 0}
table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px;table-layout:fixed}th,td{text-align:left;vertical-align:top;border:1px solid var(--line);padding:10px 12px;overflow-wrap:anywhere}th{background:#edf2f5;font-weight:650}tr:nth-child(even){background:#fafcfd}td code,th code{font-size:12px}
.toc{margin:30px 0;padding:16px 22px;background:#edf4f7;border:1px solid var(--line);border-radius:8px}.toc::before{content:"Mục lục";display:block;font-weight:650;font-size:20px;margin-bottom:12px}.toc>ul{columns:2;column-gap:36px;padding-left:22px}.toc li{break-inside:avoid}.toc li li{font-size:13px}.toc a{text-decoration:none}.toc a:hover{text-decoration:underline}
.report-end{border-top:1px solid var(--line);margin-top:44px;padding-top:16px;color:var(--muted);font-size:13px}
@media(max-width:720px){.shell{padding:24px 18px 40px}body{font-size:15px}h1{font-size:27px}h2{font-size:22px}.toc>ul{columns:1}th,td{padding:7px;font-size:12px}pre{padding:12px}}
@page{size:A4;margin:16mm 14mm 18mm}
@media print{body{background:white;font-size:10pt;line-height:1.45}.shell{padding:0;max-width:none}.report-bar{font-size:8pt}h1{font-size:24pt}h2{font-size:17pt;margin-top:26pt;padding-top:12pt}h3{font-size:13pt}h1,h2,h3,h4{break-after:avoid}p,li{orphans:3;widows:3}pre{font-size:8pt;padding:8pt;overflow:visible;break-inside:auto}pre code{font-size:8pt;white-space:pre-wrap;overflow-wrap:anywhere}table{font-size:8.5pt;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{padding:5pt}td code,th code{font-size:8pt}a{color:inherit}.toc{background:white}.toc>ul{columns:2}.toc li li{font-size:8pt}.report-end{font-size:8pt}blockquote{background:white}html{scroll-behavior:auto}}
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the self-contained technical report")
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--source", type=Path, default=root / "docs/technical-report.md")
    parser.add_argument("--output", type=Path, default=root / "docs/technical-report.html")
    args = parser.parse_args()
    try:
        import markdown
    except ImportError as exc:
        raise SystemExit(
            "Run with: uv run --no-project --with markdown==3.7 python tools/render_technical_report.py"
        ) from exc
    body = markdown.markdown(
        args.source.read_text(encoding="utf-8"),
        extensions=["tables", "fenced_code", "toc", "sane_lists"],
        extension_configs={"toc": {"toc_depth": "2-3"}},
    )
    document = f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Báo cáo kỹ thuật Print Appliance 0.1.5: kiến trúc, cài đặt macOS/Windows/WSL/Linux, API và vận hành.">
<title>Báo cáo kỹ thuật — Print Appliance 0.1.5</title>
<style>{CSS}</style>
</head>
<body><div class="shell">
<header class="report-bar"><span>PRINT APPLIANCE · TECHNICAL REPORT</span><span>0.1.5 · Tiếng Việt · Đọc offline / Print → Save as PDF</span></header>
<main>{body}</main>
<footer class="report-end">Nguồn nội dung: technical-report.md. Không có credential hoặc tài nguyên CDN trong bản HTML. Kiểm tra hệ điều hành và điều kiện trước khi chạy lệnh.</footer>
</div></body>
</html>
"""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document, encoding="utf-8")
    print(f"Written {args.output}")


if __name__ == "__main__":
    main()
