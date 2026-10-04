"""Guide structure and page-reference integrity without PDF/browser dependencies."""

import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/technical-report.md"


class Navigation(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.links = []
        self.references = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if "id" in data:
            self.ids.append(data["id"])
        if tag == "a" and data.get("href", "").startswith("#"):
            self.links.append(data["href"][1:])
        if "data-page-target" in data:
            self.references.append(data["data-page-target"])


def test_guide_front_back_matter_and_linked_navigation():
    source = SOURCE.read_text()
    for marker in ("COVER-END", "FRONT-MATTER-END", "BACK-MATTER-START"):
        assert f"<!-- {marker} -->" in source
    for name in ("MAIN TOC", "FIGURE LIST", "TABLE LIST", "INDEX"):
        assert f"<!-- BEGIN {name} -->" in source
        assert f"<!-- END {name} -->" in source
    assert "[TOC]" not in source
    assert "Luong Nguyen · Print Appliance" in source
    assert "## Tài liệu tham khảo" in source
    assert "## Chỉ mục tra cứu" in source
    # GitHub and our HTML renderer use different automatic Vietnamese heading slugs.
    # Explicit anchors keep the linked Markdown navigation working on GitHub too.
    anchors = set(re.findall(r'<a (?:id|name)="([^"]+)"', source))
    fragments = set(re.findall(r"\]\(#([^)]+)\)", source))
    assert fragments <= anchors
    navigation = Navigation()
    navigation.feed(SOURCE.with_suffix(".html").read_text())
    assert len(navigation.ids) == len(set(navigation.ids))
    assert set(navigation.links) <= set(navigation.ids)
    assert len(set(navigation.references)) >= 100
    assert {f"figure-{i}" for i in range(1, 11)} <= set(navigation.references)
    assert {f"table-{i}" for i in range(1, 14)} <= set(navigation.references)


def test_guide_is_operations_focused_and_source_steps_stop_at_clone():
    source = SOURCE.read_text()
    main = source.split("<!-- FRONT-MATTER-END -->")[1].split("<!-- BACK-MATTER-START -->")[0]
    assert "```" not in main
    assert "src/print_appliance" not in main
    source_steps = source.split("### A.1 Cài Git và clone project")[1].split("### A.2")[0]
    commands = "\n".join(re.findall(r"```[^\n]*\n(.*?)```", source_steps, re.S))
    assert "git clone" in commands and "winget install" in commands
    assert not re.search(r"\b(?:uv|pytest|ruff|pip|python)\b", commands)
    assert "uv build" not in source
    assert "uv run pytest" not in source
    assert "### A.2 Cài mới trên Linux/EDATEC" in source


def test_canonical_pdf_page_references_are_current():
    data = json.loads(SOURCE.with_suffix(".pages.json").read_text())
    assert (
        data["source_sha256"]
        == hashlib.sha256(SOURCE.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
    )
    assert data["document_version"] == "1.2"
    assert data["product_version"] == "0.1.5"
    assert 10 < data["page_count"] < 100
    assert all(isinstance(n, int) and 1 <= n <= data["page_count"] for n in data["pages"].values())
    html = SOURCE.with_suffix(".html").read_text()
    for target, page in data["pages"].items():
        assert (
            f'data-page-target="{target}" title="Trang trong bản PDF chuẩn">{page}</span>' in html
        )
    with SOURCE.with_suffix(".pdf").open("rb") as file:
        assert file.read(5) == b"%PDF-"


def test_pdf_checkout_preserves_binary_bytes():
    attributes = (ROOT / ".gitattributes").read_text()
    assert "*.pdf binary" in attributes.splitlines()
