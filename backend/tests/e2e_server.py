"""Run the real FastAPI app for Playwright E2E tests, with only external services stubbed.

- SQLite DB and uploaded PDFs live in a throwaway temp directory (never backend/data).
- The LLM (`app.llm._chat`) returns deterministic canned replies.
- Paper search returns a fixed result set; PDF downloads return a generated PDF.

Usage (from backend/):  python -m tests.e2e_server [--port 8000]
"""

import argparse
import json
import tempfile
from pathlib import Path

from tests import _safety  # noqa: F401  (must run before any `app` import)

import pymupdf
import uvicorn
from sqlmodel import create_engine

import app.db
import app.routes.papers
import app.routes.search
from app import llm, pdf
from app.main import app as fastapi_app
from app.models import SearchResult

FAKE_SUMMARY = (
    "## TL;DR\nE2E fake summary of the paper.\n\n## Problem\nTesting.\n\n## Approach\nStubs.\n\n"
    "## Datasets & Experiments\nNone.\n\n## Key Results\nIt works.\n\n## Limitations\nFake."
)

FAKE_RESULTS = [
    SearchResult(
        source="semantic_scholar",
        external_id="arxiv:1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
        year=2017,
        abstract="The dominant sequence transduction models are based on complex recurrent networks.",
        url="https://arxiv.org/abs/1706.03762",
        pdf_url="https://arxiv.org/pdf/1706.03762",
    ),
    SearchResult(
        source="semantic_scholar",
        external_id="s2:abc123",
        title="A Paper Without A PDF",
        authors=["Jane Doe"],
        year=2020,
        abstract="An abstract-only paper used by the E2E tests.",
        url="https://example.org/paper",
        pdf_url=None,
    ),
]


def make_pdf(title: str, body: str) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), title, fontsize=20)
    page.insert_text((72, 120), body, fontsize=11)
    doc.set_metadata({"title": title, "author": "E2E Author"})
    data = doc.tobytes()
    doc.close()
    return data


async def fake_chat(messages: list[dict], temperature: float = 0.2) -> str:
    first = messages[0]["content"]
    if first.startswith("Extract bibliographic metadata"):
        return json.dumps({"title": None, "authors": [], "year": None, "abstract": None})
    if first.startswith("You are a research assistant. Summarize"):
        return FAKE_SUMMARY
    return f"E2E fake answer to: {messages[-1]['content']}"


async def fake_search(query: str, limit: int = 10):
    return [r.model_copy() for r in FAKE_RESULTS[:limit]], "semantic_scholar"


async def fake_download(url: str) -> bytes:
    return make_pdf("Downloaded Paper", "Full text of the downloaded paper for E2E tests.")


def install_fakes(data_dir: Path) -> None:
    uploads = data_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    app.db.engine = create_engine(
        f"sqlite:///{data_dir / 'e2e.db'}", connect_args={"check_same_thread": False}
    )
    app.routes.papers.UPLOAD_DIR = uploads
    llm._chat = fake_chat
    pdf.download_pdf = fake_download
    app.routes.search.search_papers = fake_search


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    install_fakes(Path(tempfile.mkdtemp(prefix="ra-e2e-")))
    uvicorn.run(fastapi_app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
