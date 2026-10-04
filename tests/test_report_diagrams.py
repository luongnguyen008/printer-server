"""Documentation diagrams must remain reproducible and self-contained."""

import re
import runpy
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SVG = "{http://www.w3.org/2000/svg}"
RENDERER = runpy.run_path(str(ROOT / "tools/render_technical_report.py"))
GENERATOR = runpy.run_path(str(ROOT / "tools/render_report_diagrams.py"))


def test_report_diagrams_are_reproducible_and_referenced():
    diagrams = GENERATOR["diagrams"]()
    assert len(diagrams) == 10
    report = (ROOT / "docs/technical-report.md").read_text()
    for diagram in diagrams:
        path = ROOT / f"docs/diagrams/{diagram.name}.svg"
        assert path.read_text() == diagram.svg()
        assert f"(diagrams/{diagram.name}.svg)" in report
        svg = ET.fromstring(path.read_text())
        assert svg.find(f"{SVG}title").text
        assert svg.find(f"{SVG}desc").text
        assert svg.attrib["role"] == "img"


def test_generated_html_embeds_all_diagrams_with_unique_ids():
    html = (ROOT / "docs/technical-report.html").read_text()
    assert html.count('<figure class="report-diagram">') == 10
    assert html.count("<svg ") == 10
    assert "<img " not in html
    assert "<script" not in html
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids))
    for diagram in GENERATOR["diagrams"]():
        assert f'id="{diagram.name}-title"' in html
        assert f'id="{diagram.name}-desc"' in html


@pytest.mark.parametrize(
    "unsafe",
    [
        "<script>alert(1)</script>",
        '<rect onclick="alert(1)"/>',
        '<rect fill="url(https://example.com/asset)"/>',
        '<use href="https://example.com/asset"/>',
    ],
)
def test_inline_svg_rejects_active_or_external_assets(tmp_path, unsafe):
    source = tmp_path / "report.md"
    source.write_text("report")
    (tmp_path / "image.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg">{unsafe}</svg>')
    with pytest.raises(ValueError):
        RENDERER["embed_diagrams"]('<p><img alt="Flow" src="image.svg" /></p>', source)


def test_inline_svg_rejects_path_outside_report(tmp_path):
    directory = tmp_path / "docs"
    directory.mkdir()
    source = directory / "report.md"
    source.write_text("report")
    (tmp_path / "external.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    with pytest.raises(ValueError):
        RENDERER["embed_diagrams"]('<p><img alt="Flow" src="../external.svg" /></p>', source)


def test_inline_svg_preserves_accessibility_and_escapes_alt(tmp_path):
    source = tmp_path / "report.md"
    source.write_text("report")
    diagram = GENERATOR["diagrams"]()[0]
    (tmp_path / "image.svg").write_text(diagram.svg())
    html = RENDERER["embed_diagrams"](
        '<p><img alt="Client &amp; admin" src="image.svg" /></p>', source
    )
    assert 'aria-label="Client &amp; admin"' in html
    assert "<img" not in html
    assert "<svg " in html
    assert f'aria-labelledby="{diagram.name}-title {diagram.name}-desc"' in html
