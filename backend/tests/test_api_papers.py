"""API tests for /api/papers: list, get, save (with mocked PDF download), upload, PDF, delete."""

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx
from sqlmodel import select

import app.pdf
import app.routes.papers
from app.models import ChatMessage, Paper

PDF_URL = "https://arxiv.org/pdf/1706.03762"


def search_result(**kw):
    body = {
        "source": "semantic_scholar",
        "external_id": "arxiv:1706.03762",
        "title": "Attention Is All You Need",
        "authors": ["Ashish Vaswani", "Noam Shazeer"],
        "year": 2017,
        "abstract": "The dominant sequence transduction models...",
        "url": "https://arxiv.org/abs/1706.03762",
        "pdf_url": None,
    }
    body.update(kw)
    return body


def upload(client, data: bytes, filename="paper.pdf", content_type="application/pdf"):
    return client.post("/api/papers/upload", files={"file": (filename, data, content_type)})


# ---------------------------------------------------------------- list / get


def test_list_empty_library(client):
    r = client.get("/api/papers")
    assert r.status_code == 200
    assert r.json() == []


def test_list_newest_first_and_hides_internal_fields(client, add_paper):
    now = datetime.now(timezone.utc)
    add_paper(title="Old", created_at=now - timedelta(days=2), full_text="secret text", pdf_path="x.pdf")
    add_paper(title="New", created_at=now)
    add_paper(title="Middle", created_at=now - timedelta(days=1))
    body = client.get("/api/papers").json()
    assert [p["title"] for p in body] == ["New", "Middle", "Old"]
    old = body[2]
    assert "full_text" not in old and "pdf_path" not in old
    assert old["has_pdf"] is True
    assert body[0]["has_pdf"] is False


def test_get_paper_returns_read_model(client, add_paper):
    p = add_paper(title="T", authors=["A", "B"], year=1999, abstract="abs", text_status="full",
                  full_text="body", summary="sum", url="https://u", pdf_url="https://p")
    r = client.get(f"/api/papers/{p.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == p.id
    assert body["title"] == "T"
    assert body["authors"] == ["A", "B"]
    assert body["year"] == 1999
    assert body["abstract"] == "abs"
    assert body["text_status"] == "full"
    assert body["summary"] == "sum"
    assert body["has_pdf"] is False
    assert body["url"] == "https://u" and body["pdf_url"] == "https://p"
    assert "created_at" in body
    assert "full_text" not in body


def test_get_missing_paper_404(client):
    r = client.get("/api/papers/9999")
    assert r.status_code == 404
    assert r.json()["detail"] == "Paper not found"


def test_get_paper_non_integer_id_422(client):
    r = client.get("/api/papers/abc")
    assert r.status_code == 422
    (err,) = r.json()["detail"]
    assert err["loc"] == ["path", "paper_id"]


# ---------------------------------------------------------------- save


def test_save_without_pdf_url_is_abstract_only(client, session):
    r = client.post("/api/papers", json=search_result())
    assert r.status_code == 201
    body = r.json()
    assert body["title"] == "Attention Is All You Need"
    assert body["external_id"] == "arxiv:1706.03762"
    assert body["authors"] == ["Ashish Vaswani", "Noam Shazeer"]
    assert body["text_status"] == "abstract_only"
    assert body["has_pdf"] is False
    assert body["summary"] is None
    stored = session.get(Paper, body["id"])
    assert stored is not None and stored.full_text is None


def test_save_downloads_pdf_and_extracts_full_text(client, session, upload_dir, make_pdf):
    data = make_pdf([[("Attention body text about transformers", 11)]])
    with respx.mock() as mock:
        route = mock.get(PDF_URL).respond(200, content=data)
        r = client.post("/api/papers", json=search_result(pdf_url=PDF_URL))
    assert route.called
    assert r.status_code == 201
    body = r.json()
    assert body["text_status"] == "full"
    assert body["has_pdf"] is True
    stored = session.get(Paper, body["id"])
    assert "transformers" in stored.full_text
    assert (upload_dir / stored.pdf_path).read_bytes() == data
    assert stored.pdf_path.endswith(".pdf")


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404),
        httpx.Response(200, html="<html>paywall</html>"),
        httpx.ConnectError("unreachable"),
    ],
    ids=["http-404", "not-a-pdf", "network-error"],
)
def test_save_falls_back_to_abstract_when_pdf_unavailable(client, upload_dir, response):
    with respx.mock() as mock:
        mock.get(PDF_URL).mock(side_effect=[response])
        r = client.post("/api/papers", json=search_result(pdf_url=PDF_URL))
    assert r.status_code == 201
    assert r.json()["text_status"] == "abstract_only"
    assert r.json()["has_pdf"] is False
    assert list(upload_dir.iterdir()) == []


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: _store_pdf writes the file and sets pdf_path before extract_text runs; if the "
    "downloaded 'PDF' is corrupt the save falls back to abstract-only but keeps has_pdf=True, "
    "pointing at a broken file that is left on disk.",
)
def test_save_with_corrupt_downloaded_pdf_does_not_attach_it(client, upload_dir):
    with respx.mock() as mock:
        mock.get(PDF_URL).respond(200, content=b"%PDF-1.4 truncated garbage")
        r = client.post("/api/papers", json=search_result(pdf_url=PDF_URL))
    assert r.status_code == 201
    assert r.json()["text_status"] == "abstract_only"
    assert r.json()["has_pdf"] is False
    assert list(upload_dir.iterdir()) == []


def test_save_is_idempotent_by_external_id(client, session):
    first = client.post("/api/papers", json=search_result()).json()
    with respx.mock(assert_all_called=False) as mock:  # an existing paper must not trigger another download
        route = mock.get(PDF_URL).respond(200, content=b"%PDF")
        second = client.post("/api/papers", json=search_result(title="Different title", pdf_url=PDF_URL))
    assert not route.called
    assert second.json()["id"] == first["id"]
    assert second.json()["title"] == "Attention Is All You Need"
    assert len(session.exec(select(Paper)).all()) == 1


def test_save_without_external_id_never_dedupes(client, session):
    a = client.post("/api/papers", json=search_result(external_id=None)).json()
    b = client.post("/api/papers", json=search_result(external_id=None)).json()
    assert a["id"] != b["id"]
    assert len(session.exec(select(Paper)).all()) == 2


def test_save_ignores_client_supplied_server_fields(client, session):
    r = client.post(
        "/api/papers",
        json=search_result(saved_id=5, summary="injected", full_text="injected", text_status="full", id=77),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["summary"] is None
    assert body["text_status"] == "abstract_only"
    stored = session.get(Paper, body["id"])
    assert stored.full_text is None


@pytest.mark.parametrize("missing", ["title", "source"])
def test_save_requires_title_and_source(client, session, missing):
    body = search_result()
    del body[missing]
    r = client.post("/api/papers", json=body)
    assert r.status_code == 422
    assert [e["loc"] for e in r.json()["detail"]] == [["body", missing]]
    assert session.exec(select(Paper)).all() == []


def test_save_minimal_body_defaults(client):
    r = client.post("/api/papers", json={"source": "arxiv", "title": "Only a title"})
    assert r.status_code == 201
    body = r.json()
    assert body["authors"] == [] and body["year"] is None and body["abstract"] is None


# ---------------------------------------------------------------- upload


def test_upload_uses_llm_metadata(client, session, upload_dir, fake_llm, make_pdf):
    data = make_pdf([[("Layout Title", 22), ("Some paper body", 11)]], metadata={"author": "Meta Author"})
    fake_llm.replies = [json.dumps({"title": "LLM Title", "authors": ["Ada", "Alan"], "year": 2020,
                                    "abstract": "LLM abstract."})]
    r = upload(client, data)
    assert r.status_code == 201
    body = r.json()
    assert body["source"] == "upload"
    assert body["external_id"] is None
    assert body["title"] == "LLM Title"
    assert body["authors"] == ["Ada", "Alan"]
    assert body["year"] == 2020
    assert body["abstract"] == "LLM abstract."
    assert body["text_status"] == "full"
    assert body["has_pdf"] is True
    stored = session.get(Paper, body["id"])
    assert "Some paper body" in stored.full_text
    assert (upload_dir / stored.pdf_path).read_bytes() == data
    # The LLM saw the first pages of the paper.
    assert "Some paper body" in fake_llm.calls[0]["messages"][0]["content"]


def test_upload_llm_only_sees_first_two_pages(client, fake_llm, make_pdf):
    data = make_pdf([[("Page one", 11)], [("Page two", 11)], [("Page three secret", 11)]])
    fake_llm.replies = ['{"title": "T"}']
    upload(client, data)
    prompt = fake_llm.calls[0]["messages"][0]["content"]
    assert "Page two" in prompt
    assert "Page three secret" not in prompt


def test_upload_merges_llm_and_heuristic_metadata(client, fake_llm, make_pdf):
    data = make_pdf(
        [[("Heuristic Title", 22), ("arXiv:1912.01234", 9), ("Abstract", 11), ("Heuristic abstract.", 11),
          ("Introduction", 11)]],
        metadata={"author": "Heuristic Author"},
    )
    fake_llm.replies = ['{"title": "LLM Title", "authors": [], "year": null, "abstract": null}']
    body = upload(client, data).json()
    assert body["title"] == "LLM Title"          # LLM wins when it has a value
    assert body["authors"] == ["Heuristic Author"]  # heuristics fill the gaps
    assert body["year"] == 2019
    assert body["abstract"] == "Heuristic abstract."


def test_upload_falls_back_to_heuristics_when_llm_fails(client, fake_llm, make_pdf):
    from app.llm import LLMError

    fake_llm.replies = [LLMError("LLM down")]
    data = make_pdf([[("Heuristic Title", 22), ("Published 2016", 11)]])
    r = upload(client, data)
    assert r.status_code == 201
    assert r.json()["title"] == "Heuristic Title"
    assert r.json()["year"] == 2016


def test_upload_falls_back_when_llm_returns_garbage(client, fake_llm, make_pdf):
    fake_llm.replies = ["no json here"]
    r = upload(client, make_pdf([[("Heuristic Title", 22)]]))
    assert r.status_code == 201
    assert r.json()["title"] == "Heuristic Title"


def test_upload_title_falls_back_to_filename(client, fake_llm, make_pdf):
    fake_llm.replies = ['{"title": null}']
    r = upload(client, make_pdf([[]]), filename="my-great-paper.pdf")
    assert r.status_code == 201
    body = r.json()
    assert body["title"] == "my-great-paper"
    assert body["authors"] == []
    # A PDF with no extractable text is stored but flagged abstract-only.
    assert body["text_status"] == "abstract_only"
    assert body["has_pdf"] is True


@pytest.mark.parametrize("data", [b"hello, not a pdf", b"", b"PDF%-1.4"])
def test_upload_rejects_non_pdf(client, upload_dir, fake_llm, data):
    r = upload(client, data, filename="notes.txt", content_type="text/plain")
    assert r.status_code == 400
    assert r.json()["detail"] == "File is not a PDF"
    assert list(upload_dir.iterdir()) == []
    assert fake_llm.calls == []


def test_upload_rejects_pdf_over_50_mb(client, session, upload_dir, fake_llm):
    # The real limit (no patching): one byte over 50 MiB is refused before any parsing.
    header = b"%PDF-1.4\n"
    data = header + b"\0" * (50 * 1024 * 1024 + 1 - len(header))
    r = upload(client, data, filename="huge.pdf")
    assert r.status_code == 413
    assert r.json() == {"detail": "PDF is larger than 50 MB"}
    assert list(upload_dir.iterdir()) == []
    assert session.exec(select(Paper)).all() == []
    assert fake_llm.calls == []


@pytest.mark.parametrize(("slack", "status"), [(0, 201), (-1, 413)], ids=["at-limit", "one-byte-over"])
def test_upload_size_limit_boundary(client, monkeypatch, upload_dir, fake_llm, make_pdf, slack, status):
    # Shrink the limit around a real PDF to check the comparison is "> limit", not ">= limit".
    data = make_pdf()
    monkeypatch.setattr(app.routes.papers, "MAX_UPLOAD_BYTES", len(data) + slack)
    assert upload(client, data).status_code == status
    assert len(list(upload_dir.iterdir())) == (1 if status == 201 else 0)


def test_upload_requires_file_field(client, session):
    r = client.post("/api/papers/upload")
    assert r.status_code == 422
    assert [e["loc"] for e in r.json()["detail"]] == [["body", "file"]]
    assert session.exec(select(Paper)).all() == []


def test_upload_unreadable_pdf_error_is_400(client, session, monkeypatch, upload_dir, fake_llm, make_pdf):
    # Contract of upload_paper: a PDFError from parsing becomes a 400 carrying its message, and
    # nothing is stored. (With real input this branch is only reached once the APP BUGs below
    # are fixed, because pymupdf errors escape heuristic_metadata unwrapped.)
    def unreadable(data):
        raise app.pdf.PDFError("Could not read PDF: broken xref")

    monkeypatch.setattr(app.pdf, "heuristic_metadata", unreadable)
    r = upload(client, make_pdf())
    assert r.status_code == 400
    assert r.json() == {"detail": "Could not read PDF: broken xref"}
    assert list(upload_dir.iterdir()) == []
    assert session.exec(select(Paper)).all() == []
    assert fake_llm.calls == []


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: heuristic_metadata opens the PDF with pymupdf outside the PDFError wrapper, "
    "so a corrupt file that starts with %PDF raises pymupdf.FileDataError, which upload_paper "
    "does not catch -> 500 Internal Server Error instead of a 400.",
)
def test_upload_corrupt_pdf_returns_400(client, session, fake_llm, upload_dir):
    r = upload(client, b"%PDF-1.7\nthis is not really a pdf")
    assert r.status_code == 400
    assert list(upload_dir.iterdir()) == []
    assert session.exec(select(Paper)).all() == []


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: a password-protected PDF makes heuristic_metadata (app/pdf.py:44-48) raise a "
    "bare ValueError('document closed or encrypted') from pymupdf; upload_paper only catches "
    "PDFError (app/routes/papers.py:77), so the user gets a 500 instead of a 400.",
)
def test_upload_password_protected_pdf_returns_400(client, session, fake_llm, upload_dir):
    import pymupdf

    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Secret Title", fontsize=20)
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="user", owner_pw="owner")
    doc.close()
    r = upload(client, data)
    assert r.status_code == 400
    assert list(upload_dir.iterdir()) == []
    assert session.exec(select(Paper)).all() == []


# ---------------------------------------------------------------- stored PDF


def test_get_pdf_serves_uploaded_file(client, fake_llm, make_pdf):
    data = make_pdf([[("Servable", 11)]])
    pid = upload(client, data).json()["id"]
    r = client.get(f"/api/papers/{pid}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content == data


def test_get_pdf_without_stored_pdf_404(client, add_paper):
    p = add_paper()
    r = client.get(f"/api/papers/{p.id}/pdf")
    assert r.status_code == 404
    assert r.json()["detail"] == "No PDF stored for this paper"


def test_get_pdf_unknown_paper_404(client):
    r = client.get("/api/papers/424242/pdf")
    assert r.status_code == 404
    # The paper itself is missing, which is a different error from "paper has no PDF".
    assert r.json() == {"detail": "Paper not found"}


# ---------------------------------------------------------------- delete


def test_delete_removes_paper_chat_and_file(client, session, upload_dir, fake_llm, make_pdf, add_paper):
    pid = upload(client, make_pdf()).json()["id"]
    other = add_paper(title="Keep me")
    session.add_all([
        ChatMessage(paper_id=pid, role="user", content="q"),
        ChatMessage(paper_id=pid, role="assistant", content="a"),
        ChatMessage(paper_id=other.id, role="user", content="other q"),
    ])
    session.commit()
    assert len(list(upload_dir.iterdir())) == 1

    r = client.delete(f"/api/papers/{pid}")
    assert r.status_code == 204
    assert r.content == b""
    assert client.get(f"/api/papers/{pid}").status_code == 404
    assert list(upload_dir.iterdir()) == []
    session.expire_all()
    remaining = session.exec(select(ChatMessage)).all()
    assert [m.content for m in remaining] == ["other q"]
    assert [p["title"] for p in client.get("/api/papers").json()] == ["Keep me"]


def test_delete_tolerates_missing_pdf_file(client, session, add_paper):
    pid = add_paper(pdf_path="already-gone.pdf").id
    assert client.delete(f"/api/papers/{pid}").status_code == 204
    session.expire_all()
    assert session.get(Paper, pid) is None


def test_delete_unknown_paper_404_changes_nothing(client, session, add_paper, upload_dir):
    keep = add_paper(title="Keep me", pdf_path="keep.pdf")
    (upload_dir / "keep.pdf").write_bytes(b"%PDF")
    session.add(ChatMessage(paper_id=keep.id, role="user", content="q"))
    session.commit()

    r = client.delete("/api/papers/31337")
    assert r.status_code == 404
    assert r.json() == {"detail": "Paper not found"}
    session.expire_all()
    assert [p.title for p in session.exec(select(Paper)).all()] == ["Keep me"]
    assert len(session.exec(select(ChatMessage)).all()) == 1
    assert (upload_dir / "keep.pdf").exists()


def test_delete_twice_second_is_404(client, add_paper):
    p = add_paper()
    assert client.delete(f"/api/papers/{p.id}").status_code == 204
    r = client.delete(f"/api/papers/{p.id}")
    assert r.status_code == 404
    assert r.json() == {"detail": "Paper not found"}


def test_deleted_search_result_can_be_saved_again(client):
    first = client.post("/api/papers", json=search_result()).json()
    client.delete(f"/api/papers/{first['id']}")
    again = client.post("/api/papers", json=search_result())
    assert again.status_code == 201
    assert client.get(f"/api/papers/{again.json()['id']}").status_code == 200
