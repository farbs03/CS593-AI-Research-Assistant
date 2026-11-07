"""API tests for /api/search and /api/health."""

import pytest

import app.main
import app.routes.search
from app.models import SearchResult
from app.search import SearchError


def result(ext_id, title="T"):
    return SearchResult(source="arxiv", external_id=ext_id, title=title, authors=["A"], year=2020,
                        abstract="abs", url="https://u", pdf_url=None)


@pytest.fixture
def fake_search(monkeypatch):
    calls = []
    state = {"results": [], "provider": "semantic_scholar", "error": None}

    async def _fake(query, limit=10):
        calls.append((query, limit))
        if state["error"]:
            raise state["error"]
        return [r.model_copy() for r in state["results"]], state["provider"]

    monkeypatch.setattr(app.routes.search, "search_papers", _fake)
    state["calls"] = calls
    return state


def test_search_returns_provider_and_results(client, fake_search):
    fake_search["results"] = [result("arxiv:1", "First"), result("s2:2", "Second")]
    fake_search["provider"] = "arxiv"
    r = client.get("/api/search", params={"q": "transformers"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "arxiv"
    assert [x["title"] for x in body["results"]] == ["First", "Second"]
    assert all(x["saved_id"] is None for x in body["results"])
    assert fake_search["calls"] == [("transformers", 10)]


def test_search_marks_results_already_in_library(client, fake_search, add_paper):
    saved = add_paper(external_id="arxiv:1", title="First")
    add_paper(external_id="arxiv:unrelated")
    fake_search["results"] = [result("arxiv:1"), result("s2:2"), result(None, "No id")]
    body = client.get("/api/search", params={"q": "x"}).json()
    assert [x["saved_id"] for x in body["results"]] == [saved.id, None, None]


def test_search_passes_limit(client, fake_search):
    client.get("/api/search", params={"q": "x", "limit": 50})
    assert fake_search["calls"] == [("x", 50)]


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "x", "limit": 0}, {"q": "x", "limit": 51},
                                    {"q": "x", "limit": "ten"}])
def test_search_validates_parameters(client, fake_search, params):
    assert client.get("/api/search", params=params).status_code == 422
    assert fake_search["calls"] == []


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: q is only checked with min_length=1 (app/routes/search.py:19), so a whitespace-only "
    "query is accepted (200) and sent to the search providers instead of being rejected.",
)
@pytest.mark.parametrize("q", [" ", "\t\n  "], ids=["spaces", "tab-newline"])
def test_search_rejects_whitespace_only_query(client, fake_search, q):
    r = client.get("/api/search", params={"q": q})
    assert 400 <= r.status_code < 500
    assert fake_search["calls"] == []


def test_search_all_providers_failing_is_502(client, fake_search):
    fake_search["error"] = SearchError("All search providers failed: 503")
    r = client.get("/api/search", params={"q": "x"})
    assert r.status_code == 502
    assert r.json()["detail"] == "All search providers failed: 503"


def test_search_empty_results(client, fake_search):
    body = client.get("/api/search", params={"q": "nothing"}).json()
    assert body == {"provider": "semantic_scholar", "results": []}


@pytest.mark.parametrize(("key", "configured"), [("sk-something", True), ("", False)])
def test_health_reports_configured_model_and_whether_a_key_is_set(client, monkeypatch, key, configured):
    monkeypatch.setattr(app.main, "LLM_MODEL", "configured-model-x")
    monkeypatch.setattr(app.main, "LLM_API_KEY", key)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "llm_model": "configured-model-x", "llm_configured": configured}


def test_cors_allows_vite_dev_origin(client):
    r = client.options(
        "/api/papers",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_rejects_other_origins(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers

