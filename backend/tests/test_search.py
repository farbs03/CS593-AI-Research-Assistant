"""Unit tests for app/search.py with Semantic Scholar and arXiv mocked by respx."""

from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from app import search

pytestmark = pytest.mark.anyio


def s2_item(**kw):
    item = {
        "paperId": "abc123",
        "title": "A Paper",
        "authors": [{"authorId": "1", "name": "Ada Lovelace"}],
        "year": 2020,
        "abstract": "An abstract.",
        "url": "https://www.semanticscholar.org/paper/abc123",
        "openAccessPdf": None,
        "externalIds": {},
    }
    item.update(kw)
    return item


def atom_entry(arxiv_id="1706.03762v5", title="Attention Is All You Need", published="2017-06-12T17:57:34Z",
               authors=("Ashish Vaswani", "Noam Shazeer"), summary="The dominant models..."):
    names = "".join(f"<author><name>{a}</name></author>" for a in authors)
    return (
        f"<entry><id>http://arxiv.org/abs/{arxiv_id}</id><published>{published}</published>"
        f"<title>{title}</title><summary>{summary}</summary>{names}</entry>"
    )


def atom_feed(*entries):
    return f'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">{"".join(entries)}</feed>'


@pytest.fixture
def no_sleep(monkeypatch):
    """Records app.search's back-off sleeps without sleeping. Only app.search's view of asyncio
    is replaced; the global asyncio.sleep (used by the event loop / anyio) is untouched."""
    slept = []

    async def fake_sleep(seconds, *a, **k):
        slept.append(seconds)

    monkeypatch.setattr(search, "asyncio", SimpleNamespace(sleep=fake_sleep))
    return slept


# ---------------------------------------------------------------- Semantic Scholar


async def test_s2_maps_fields_and_sends_query_params():
    with respx.mock(assert_all_called=True) as mock:
        route = mock.get(search.S2_URL).respond(
            200,
            json={"data": [s2_item(openAccessPdf={"url": "https://oa.example/p.pdf"})]},
        )
        results = await search.search_semantic_scholar("graph neural nets", 7)

    params = parse_qs(urlparse(str(route.calls.last.request.url)).query)
    assert params["query"] == ["graph neural nets"]
    assert params["limit"] == ["7"]
    assert params["fields"] == [search.S2_FIELDS]
    assert "x-api-key" not in route.calls.last.request.headers

    (r,) = results
    assert r.source == "semantic_scholar"
    assert r.external_id == "s2:abc123"
    assert r.title == "A Paper"
    assert r.authors == ["Ada Lovelace"]
    assert r.year == 2020
    assert r.abstract == "An abstract."
    assert r.url == "https://www.semanticscholar.org/paper/abc123"
    assert r.pdf_url == "https://oa.example/p.pdf"
    assert r.saved_id is None


async def test_s2_prefers_arxiv_id_and_derives_pdf_url():
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(200, json={"data": [s2_item(externalIds={"ArXiv": "2101.00001", "DOI": "x"})]})
        (r,) = await search.search_semantic_scholar("q", 10)
    assert r.external_id == "arxiv:2101.00001"
    assert r.pdf_url == "https://arxiv.org/pdf/2101.00001"


async def test_s2_open_access_pdf_wins_over_arxiv_pdf():
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(
            200,
            json={"data": [s2_item(externalIds={"ArXiv": "2101.00001"}, openAccessPdf={"url": "https://oa/x.pdf"})]},
        )
        (r,) = await search.search_semantic_scholar("q", 10)
    assert r.pdf_url == "https://oa/x.pdf"
    assert r.external_id == "arxiv:2101.00001"


async def test_s2_handles_missing_optional_fields():
    item = s2_item(title=None, authors=[{"name": "Kept"}, {"authorId": "2"}, {"name": ""}], year=None,
                   abstract=None, url=None, openAccessPdf={"url": ""}, externalIds=None)
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(200, json={"data": [item]})
        (r,) = await search.search_semantic_scholar("q", 10)
    assert r.title == "(untitled)"
    assert r.authors == ["Kept"]
    assert r.year is None and r.abstract is None and r.url is None
    assert r.pdf_url is None


@pytest.mark.parametrize("body", [{"data": []}, {"data": None}, {"total": 0}])
async def test_s2_empty_results(body):
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(200, json=body)
        assert await search.search_semantic_scholar("q", 10) == []


async def test_s2_sends_api_key_when_configured(monkeypatch):
    monkeypatch.setattr(search, "S2_API_KEY", "secret-key")
    with respx.mock() as mock:
        route = mock.get(search.S2_URL).respond(200, json={"data": []})
        await search.search_semantic_scholar("q", 10)
    assert route.calls.last.request.headers["x-api-key"] == "secret-key"


async def test_s2_retries_once_after_429(no_sleep):
    with respx.mock() as mock:
        route = mock.get(search.S2_URL).mock(
            side_effect=[httpx.Response(429), httpx.Response(200, json={"data": [s2_item()]})]
        )
        results = await search.search_semantic_scholar("q", 10)
    assert route.call_count == 2
    assert no_sleep == [1.5]
    assert [r.title for r in results] == ["A Paper"]


async def test_s2_gives_up_after_second_429(no_sleep):
    with respx.mock() as mock:
        route = mock.get(search.S2_URL).respond(429)
        with pytest.raises(httpx.HTTPStatusError):
            await search.search_semantic_scholar("q", 10)
    assert route.call_count == 2


async def test_s2_server_error_is_not_retried(no_sleep):
    with respx.mock() as mock:
        route = mock.get(search.S2_URL).respond(500)
        with pytest.raises(httpx.HTTPStatusError):
            await search.search_semantic_scholar("q", 10)
    assert route.call_count == 1
    assert no_sleep == []


# ---------------------------------------------------------------- arXiv


def test_parse_arxiv_maps_entries():
    xml = atom_feed(
        atom_entry(title="  Attention Is\n   All You Need ", summary="\n  The dominant\n models  are... \n"),
        atom_entry(arxiv_id="cs/0112017v1", title="Old Style", published="2001-12-01T00:00:00Z", authors=("Solo",)),
    )
    first, second = search._parse_arxiv(xml)
    assert first.source == "arxiv"
    assert first.external_id == "arxiv:1706.03762"  # version suffix stripped
    assert first.title == "Attention Is All You Need"
    assert first.abstract == "The dominant models are..."
    assert first.authors == ["Ashish Vaswani", "Noam Shazeer"]
    assert first.year == 2017
    assert first.url == "https://arxiv.org/abs/1706.03762"
    assert first.pdf_url == "https://arxiv.org/pdf/1706.03762"
    assert second.external_id == "arxiv:cs/0112017"
    assert second.year == 2001


def test_parse_arxiv_missing_published_gives_no_year():
    xml = atom_feed(atom_entry(published=""))
    (r,) = search._parse_arxiv(xml)
    assert r.year is None


def test_parse_arxiv_empty_feed():
    assert search._parse_arxiv(atom_feed()) == []


@pytest.mark.parametrize(
    ("query", "conj", "expected"),
    [
        ("graph neural networks", "AND", "all:graph AND all:neural AND all:networks"),
        ("the attention of a transformer", "AND", "all:attention AND all:transformer"),
        ("diffusion models for video", "OR", "all:diffusion OR all:models OR all:video"),
        ("self-supervised learning", "AND", "all:self-supervised AND all:learning"),
        ("The Of And", "AND", "all:The AND all:Of AND all:And"),  # only stopwords: keep them all
        ("???", "AND", "all:???"),
    ],
)
def test_arxiv_query_builder(query, conj, expected):
    assert search._arxiv_query(query, conj) == expected


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: _arxiv_query tokenizes with [\\w-]+ (app/search.py:114-115), which strips the "
    "symbols from language/technology names, so 'C++' becomes all:C and 'C#' becomes all:C "
    "(a search for the single letter C).",
)
@pytest.mark.parametrize(("query", "term"), [("C++ !!", "C++"), ("C# compilers", "C#")])
def test_arxiv_query_keeps_symbols_that_are_part_of_a_term(query, term):
    built = search._arxiv_query(query, "AND")
    assert term in built
    assert "!" not in built


async def test_arxiv_search_uses_and_query_first():
    with respx.mock() as mock:
        route = mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        results = await search.search_arxiv("neural networks", 5)
    assert route.call_count == 1
    params = parse_qs(urlparse(str(route.calls.last.request.url)).query)
    assert params["search_query"] == ["all:neural AND all:networks"]
    assert params["max_results"] == ["5"]
    assert params["sortBy"] == ["relevance"]
    assert [r.external_id for r in results] == ["arxiv:1706.03762"]


async def test_arxiv_search_falls_back_to_or_when_and_finds_nothing():
    with respx.mock() as mock:
        route = mock.get(search.ARXIV_URL).mock(
            side_effect=[httpx.Response(200, text=atom_feed()), httpx.Response(200, text=atom_feed(atom_entry()))]
        )
        results = await search.search_arxiv("rare words", 5)
    assert route.call_count == 2
    queries = [parse_qs(urlparse(str(c.request.url)).query)["search_query"][0] for c in route.calls]
    assert queries == ["all:rare AND all:words", "all:rare OR all:words"]
    assert len(results) == 1


async def test_arxiv_search_returns_empty_when_nothing_matches():
    with respx.mock() as mock:
        route = mock.get(search.ARXIV_URL).respond(200, text=atom_feed())
        assert await search.search_arxiv("zzz qqq", 5) == []
    assert route.call_count == 2


async def test_arxiv_search_http_error_raises():
    with respx.mock() as mock:
        mock.get(search.ARXIV_URL).respond(503)
        with pytest.raises(httpx.HTTPStatusError):
            await search.search_arxiv("q", 5)


# ---------------------------------------------------------------- search_papers (fallback)


async def test_search_papers_uses_semantic_scholar_when_available():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(search.S2_URL).respond(200, json={"data": [s2_item()]})
        arxiv = mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        results, provider = await search.search_papers("q", 3)
    assert provider == "semantic_scholar"
    assert [r.title for r in results] == ["A Paper"]
    assert not arxiv.called


async def test_search_papers_falls_back_to_arxiv_on_s2_failure(no_sleep):
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(429)
        mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        results, provider = await search.search_papers("q", 3)
    assert provider == "arxiv"
    assert results[0].source == "arxiv"


async def test_search_papers_falls_back_on_s2_timeout():
    with respx.mock() as mock:
        mock.get(search.S2_URL).mock(side_effect=httpx.ReadTimeout("slow"))
        mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        _, provider = await search.search_papers("q", 3)
    assert provider == "arxiv"


async def test_search_papers_falls_back_when_s2_returns_non_json():
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(200, text="<html>Service temporarily unavailable</html>")
        mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        results, provider = await search.search_papers("q", 3)
    assert provider == "arxiv"
    assert [r.external_id for r in results] == ["arxiv:1706.03762"]


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: search_semantic_scholar indexes item['paperId'] (app/search.py:57), so ONE "
    "S2 item without a paperId raises KeyError and search_papers throws away every valid S2 "
    "result, silently switching the whole search to arXiv.",
)
async def test_one_malformed_s2_item_does_not_discard_the_other_results():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(search.S2_URL).respond(
            200, json={"data": [s2_item(paperId="good1", title="Good Paper"), {"title": "no paperId"}]}
        )
        arxiv = mock.get(search.ARXIV_URL).respond(200, text=atom_feed(atom_entry()))
        results, provider = await search.search_papers("q", 3)
    assert provider == "semantic_scholar"
    assert not arxiv.called
    assert results[0].title == "Good Paper"
    assert results[0].external_id == "s2:good1"


async def test_search_papers_raises_search_error_when_all_fail(no_sleep):
    with respx.mock() as mock:
        mock.get(search.S2_URL).respond(500)
        mock.get(search.ARXIV_URL).respond(200, text="this is not xml <")
        with pytest.raises(search.SearchError, match="All search providers failed"):
            await search.search_papers("q", 3)


async def test_search_papers_passes_limit_to_providers():
    with respx.mock() as mock:
        route = mock.get(search.S2_URL).respond(200, json={"data": []})
        await search.search_papers("q", 42)
    assert parse_qs(urlparse(str(route.calls.last.request.url)).query)["limit"] == ["42"]
