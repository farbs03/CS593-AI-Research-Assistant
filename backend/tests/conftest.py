from tests import _safety  # noqa: F401  (must run before any `app` import)

import ipaddress
import socket
from collections.abc import Callable, Iterator
from types import SimpleNamespace

import pymupdf
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.db
import app.routes.papers
from app import llm
from app.main import app as fastapi_app
from app.models import Paper

# --------------------------------------------------------------------------------------
# Safety net: no test may open a socket to anything but loopback (real LLM / search / PDF
# hosts are unreachable even if a stub is forgotten).
# --------------------------------------------------------------------------------------
_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex


def _is_loopback(address) -> bool:
    if isinstance(address, tuple) and address:
        host = address[0]
        if host in ("localhost",):
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False
    return True  # AF_UNIX etc.


def _guarded_connect(self, address):
    if not _is_loopback(address):
        raise RuntimeError(f"Tests must not make real network connections (tried {address!r})")
    return _real_connect(self, address)


def _guarded_connect_ex(self, address):
    if not _is_loopback(address):
        raise RuntimeError(f"Tests must not make real network connections (tried {address!r})")
    return _real_connect_ex(self, address)


@pytest.fixture(autouse=True)
def _block_network(monkeypatch):
    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", _guarded_connect_ex)


@pytest.fixture(autouse=True)
def _reset_llm_client():
    """llm caches its AsyncOpenAI client in a module global; never leak it between tests."""
    llm._client = None
    yield
    llm._client = None


@pytest.fixture
def anyio_backend():
    return "asyncio"


# --------------------------------------------------------------------------------------
# Database / storage isolation
# --------------------------------------------------------------------------------------
@pytest.fixture
def engine(monkeypatch):
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    monkeypatch.setattr(app.db, "engine", eng)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    d = tmp_path / "uploads"
    d.mkdir()
    monkeypatch.setattr(app.routes.papers, "UPLOAD_DIR", d)
    return d


@pytest.fixture
def session(engine) -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def client(engine, upload_dir) -> Iterator[TestClient]:
    # raise_server_exceptions=False so an unhandled server error shows up as a 500 response
    # that a test can assert on, as a browser would see it.
    with TestClient(fastapi_app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def add_paper(session) -> Callable[..., Paper]:
    def _add(**kw) -> Paper:
        fields = {"source": "arxiv", "title": "A Paper", "authors": ["A. Author"]} | kw
        p = Paper(**fields)
        session.add(p)
        session.commit()
        session.refresh(p)
        return p

    return _add


# --------------------------------------------------------------------------------------
# LLM fakes
# --------------------------------------------------------------------------------------
class FakeLLM:
    """Records every `_chat` call and replies with queued (or default) responses."""

    def __init__(self):
        self.calls: list[dict] = []
        self.replies: list = []
        self.default = "fake reply"

    async def __call__(self, messages, temperature=0.2):
        self.calls.append({"messages": messages, "temperature": temperature})
        reply = self.replies.pop(0) if self.replies else self.default
        if isinstance(reply, BaseException):
            raise reply
        return reply


@pytest.fixture
def fake_llm(monkeypatch) -> FakeLLM:
    fake = FakeLLM()
    monkeypatch.setattr(llm, "_chat", fake)
    return fake


class FakeCompletions:
    def __init__(self):
        self.calls: list[dict] = []
        self.content: str | None = "reply"
        self.error: BaseException | None = None

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )


@pytest.fixture
def fake_openai(monkeypatch) -> FakeCompletions:
    """Replaces the OpenAI client so llm._chat runs for real without HTTP."""
    completions = FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(llm, "_get_client", lambda: client)
    return completions


# --------------------------------------------------------------------------------------
# PDF builders
# --------------------------------------------------------------------------------------
def build_pdf(
    pages: list[list[tuple[str, float]]] | None = None,
    *,
    metadata: dict | None = None,
) -> bytes:
    """Build a PDF. Each page is a list of (text, fontsize) lines, laid out top to bottom."""
    doc = pymupdf.open()
    for lines in pages or [[("Hello world", 11)]]:
        page = doc.new_page()
        y = 72
        for text, size in lines:
            for line in text.split("\n"):
                page.insert_text((72, y), line, fontsize=size)
                y += size * 1.6
    if metadata is not None:
        doc.set_metadata(metadata)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def make_pdf():
    return build_pdf
