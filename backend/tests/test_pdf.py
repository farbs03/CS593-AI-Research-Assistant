"""Unit tests for app/pdf.py: download (respx-mocked), text extraction and heuristic metadata."""

import httpx
import pytest
import respx

from app import pdf

PDF_URL = "https://papers.example.org/paper.pdf"


# ---------------------------------------------------------------- download_pdf


@pytest.mark.anyio
async def test_download_pdf_returns_bytes(make_pdf):
    data = make_pdf()
    with respx.mock(assert_all_called=True) as mock:
        route = mock.get(PDF_URL).respond(200, content=data)
        assert await pdf.download_pdf(PDF_URL) == data
    assert route.calls.last.request.headers["user-agent"] == "research-assistant/1.0"


@pytest.mark.anyio
async def test_download_pdf_follows_redirects(make_pdf):
    data = make_pdf()
    with respx.mock(assert_all_called=True) as mock:
        mock.get("https://arxiv.org/pdf/1234.5678").respond(301, headers={"Location": PDF_URL})
        mock.get(PDF_URL).respond(200, content=data)
        assert await pdf.download_pdf("https://arxiv.org/pdf/1234.5678") == data


@pytest.mark.anyio
async def test_download_pdf_rejects_non_pdf_content():
    with respx.mock() as mock:
        mock.get(PDF_URL).respond(200, html="<html>Paywall</html>")
        with pytest.raises(pdf.PDFError, match="did not return a PDF"):
            await pdf.download_pdf(PDF_URL)


@pytest.mark.anyio
async def test_download_pdf_raises_on_http_error():
    with respx.mock() as mock:
        mock.get(PDF_URL).respond(404)
        with pytest.raises(httpx.HTTPStatusError):
            await pdf.download_pdf(PDF_URL)


@pytest.mark.anyio
async def test_download_pdf_propagates_network_errors():
    with respx.mock() as mock:
        mock.get(PDF_URL).mock(side_effect=httpx.ConnectTimeout("timed out"))
        with pytest.raises(httpx.TimeoutException):
            await pdf.download_pdf(PDF_URL)


# ---------------------------------------------------------------- extract_text / _clean


def test_extract_text_reads_all_pages_in_order(make_pdf):
    data = make_pdf([[("Page one text", 11)], [("Page two text", 11)], [("Page three text", 11)]])
    text = pdf.extract_text(data)
    assert text.index("Page one") < text.index("Page two") < text.index("Page three")


def test_extract_text_max_pages_limits_output(make_pdf):
    data = make_pdf([[("First", 11)], [("Second", 11)], [("Third", 11)]])
    text = pdf.extract_text(data, max_pages=2)
    assert "First" in text and "Second" in text
    assert "Third" not in text


def test_extract_text_max_pages_larger_than_document(make_pdf):
    data = make_pdf([[("Only page", 11)]])
    assert pdf.extract_text(data, max_pages=10) == "Only page"


def test_extract_text_rejoins_hyphenated_line_breaks(make_pdf):
    data = make_pdf([[("trans-\nformer models are good", 11)]])
    assert "transformer models" in pdf.extract_text(data)


@pytest.mark.parametrize("garbage", [b"not a pdf at all", b"%PDF-1.4 corrupted", b""])
def test_extract_text_invalid_pdf_raises_pdf_error(garbage):
    with pytest.raises(pdf.PDFError, match="Could not read PDF"):
        pdf.extract_text(garbage)


def test_clean_removes_nul_bytes():
    assert pdf._clean("a\x00b") == "ab"


def test_clean_rejoins_hyphen_only_before_lowercase():
    assert pdf._clean("trans-\nformer") == "transformer"
    # A hyphen before an uppercase continuation is a real hyphen (e.g. "GPT-\n4" / names).
    assert pdf._clean("Self-\nAttention") == "Self-\nAttention"
    assert pdf._clean("GPT-\n4") == "GPT-\n4"


def test_clean_collapses_three_or_more_newlines_and_strips():
    assert pdf._clean("\n\n a\n\n\n\n\nb\n\nc \n\n") == "a\n\nb\n\nc"


# ---------------------------------------------------------------- heuristic_metadata


def test_heuristic_metadata_prefers_embedded_metadata(make_pdf):
    data = make_pdf(
        [[("Big Layout Title", 24), ("body", 11)]],
        metadata={"title": "  Embedded Title  ", "author": "Ada Lovelace; Alan Turing, Grace Hopper and Edsger Dijkstra"},
    )
    meta = pdf.heuristic_metadata(data)
    assert meta["title"] == "Embedded Title"
    assert meta["authors"] == ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra"]


def test_heuristic_metadata_falls_back_to_largest_font_title(make_pdf):
    data = make_pdf([[("Small header 11pt", 9), ("The Real Title", 22), ("Body text", 11)]])
    meta = pdf.heuristic_metadata(data)
    assert meta["title"] == "The Real Title"
    assert meta["authors"] == []


def test_heuristic_metadata_joins_multiple_largest_spans(make_pdf):
    data = make_pdf([[("Learning to", 20), ("Learn Fast", 20), ("Body", 11)]])
    assert pdf.heuristic_metadata(data)["title"] == "Learning to Learn Fast"


def test_heuristic_metadata_ignores_arxiv_stamp_for_title(make_pdf):
    data = make_pdf([[("arXiv:2101.00001v1 [cs.LG] 1 Jan 2021", 30), ("Actual Title", 20)]])
    assert pdf.heuristic_metadata(data)["title"] == "Actual Title"


def test_heuristic_metadata_ignores_rotated_text_for_title():
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((30, 700), "HUGE SIDEBAR STAMP", fontsize=40, rotate=90)
    page.insert_text((72, 100), "Horizontal Title", fontsize=18)
    data = doc.tobytes()
    doc.close()
    assert pdf.heuristic_metadata(data)["title"] == "Horizontal Title"


def test_heuristic_metadata_year_from_arxiv_id(make_pdf):
    data = make_pdf([[("Title", 20), ("arXiv:1706.03762v5 Published at a 2023 venue", 11)]])
    assert pdf.heuristic_metadata(data)["year"] == 2017


def test_heuristic_metadata_year_is_earliest_plausible_near_top(make_pdf):
    data = make_pdf([[("Title", 20), ("Revised 2022. Originally submitted 2019. Cites 1950 work.", 11)]])
    assert pdf.heuristic_metadata(data)["year"] == 2019


def test_heuristic_metadata_ignores_years_outside_plausible_range(make_pdf):
    data = make_pdf([[("Title", 20), ("Theory from 1905 and 1975; to appear 2077.", 11)]])
    assert pdf.heuristic_metadata(data)["year"] is None


def test_heuristic_metadata_year_falls_back_to_creation_date(make_pdf):
    data = make_pdf([[("Title", 20), ("No year here", 11)]], metadata={"creationDate": "2018-03-05"})
    assert pdf.heuristic_metadata(data)["year"] == 2018


def test_heuristic_metadata_text_year_beats_creation_date(make_pdf):
    data = make_pdf([[("Title", 20), ("Presented 2015", 11)]], metadata={"creationDate": "2018-03-05"})
    assert pdf.heuristic_metadata(data)["year"] == 2015


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: YEAR_RE needs word boundaries, so the standard PDF date format "
    "'D:YYYYMMDDHHmmSS' (what real PDFs store) never matches; the creationDate fallback is dead.",
)
def test_heuristic_metadata_year_from_standard_pdf_creation_date(make_pdf):
    data = make_pdf([[("Title", 20), ("No year here", 11)]], metadata={"creationDate": "D:20180305120000Z"})
    assert pdf.heuristic_metadata(data)["year"] == 2018


def test_heuristic_metadata_extracts_abstract_until_introduction(make_pdf):
    data = make_pdf(
        [[
            ("Title", 20),
            ("Abstract", 11),
            ("We propose a new   method.\nIt works well.", 11),
            ("1 Introduction", 11),
            ("Intro body should not appear.", 11),
        ]]
    )
    meta = pdf.heuristic_metadata(data)
    assert meta["abstract"] == "We propose a new method. It works well."


def test_heuristic_metadata_abstract_stops_at_keywords(make_pdf):
    data = make_pdf([[("Title", 20), ("Abstract: Short summary here.", 11), ("Keywords: a, b", 11)]])
    assert pdf.heuristic_metadata(data)["abstract"] == "Short summary here."


def test_heuristic_metadata_abstract_capped_at_3000_chars(make_pdf):
    long_line = "word " * 20
    lines = [("Title", 20), ("Abstract", 11)] + [(long_line, 6)] * 40 + [("Introduction", 11)]
    data = make_pdf([lines])
    abstract = pdf.heuristic_metadata(data)["abstract"]
    assert abstract is not None and len(abstract) <= 3000
    assert abstract.startswith("word word")


def test_heuristic_metadata_no_abstract_section(make_pdf):
    data = make_pdf([[("Title", 20), ("Just some text with no sections.", 11)]])
    assert pdf.heuristic_metadata(data)["abstract"] is None


def test_heuristic_metadata_blank_page_gives_empty_result(make_pdf):
    data = make_pdf([[]])
    assert pdf.heuristic_metadata(data) == {"title": None, "authors": [], "year": None, "abstract": None}
