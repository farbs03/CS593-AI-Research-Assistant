"""Startup and configuration: what README.md / .env.example document about settings and storage.

Some tests re-execute app/config.py or app/db.py into a throwaway module object (never registered
in sys.modules), so their import-time behaviour can be observed without touching the live app
modules or the developer's real backend/data directory.
"""

import importlib.util
import os
from pathlib import Path
from types import ModuleType

import dotenv
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

import app
import app.config
import app.db
import app.routes.papers
from app.main import app as fastapi_app

BACKEND = Path(app.__file__).resolve().parent.parent
APP_DIR = Path(app.__file__).resolve().parent


def fresh_module(name: str) -> ModuleType:
    """Execute app/<name>.py again as a separate module inside the `app` package."""
    spec = importlib.util.spec_from_file_location(f"app._fresh_{name}", APP_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unset_env(monkeypatch, *names: str) -> None:
    for name in names:
        monkeypatch.setenv(name, "placeholder")  # records the original value for restoring
        monkeypatch.delenv(name)


def test_settings_in_backend_env_file_are_applied(monkeypatch):
    # README: settings live in backend/.env. Stand in for the file so the developer's real one is
    # never read, and check that config loads exactly that file and uses what it provides.
    loaded = []

    def fake_load_dotenv(path, *args, **kwargs):
        loaded.append(Path(path))
        os.environ.setdefault("LLM_MODEL", "model-from-dotenv")
        return True

    unset_env(monkeypatch, "LLM_MODEL")
    monkeypatch.setattr(dotenv, "load_dotenv", fake_load_dotenv)
    config = fresh_module("config")
    assert loaded == [BACKEND / ".env"]
    assert config.LLM_MODEL == "model-from-dotenv"


def test_documented_defaults_apply_when_nothing_is_configured(monkeypatch):
    unset_env(monkeypatch, "LLM_MODEL", "LLM_BASE_URL", "MAX_CONTEXT_CHARS", "S2_API_KEY")
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: False)
    config = fresh_module("config")
    # README "backend/.env settings" table and .env.example.
    assert config.LLM_MODEL == "muse-spark-1.3"
    assert config.LLM_BASE_URL == "https://api.meta.ai/v1"
    assert config.MAX_CONTEXT_CHARS == 200_000
    assert config.S2_API_KEY == ""


def test_library_is_stored_under_backend_data():
    # README: the database is backend/data/papers.db, PDFs go to data/uploads/, and backend/data/
    # is the git-ignored directory to delete to reset the library.
    assert app.config.DB_PATH == BACKEND / "data" / "papers.db"
    assert app.config.UPLOAD_DIR == BACKEND / "data" / "uploads"
    assert app.routes.papers.UPLOAD_DIR == BACKEND / "data" / "uploads"
    assert Path(app.db.engine.url.database) == BACKEND / "data" / "papers.db"


def test_startup_creates_missing_tables_and_keeps_existing_data(tmp_path, monkeypatch):
    # The engine is built by app/db.py itself (same connection settings as production), but pointed
    # at an empty database file instead of backend/data/papers.db.
    monkeypatch.setattr(app.config, "DB_PATH", tmp_path / "papers.db")
    db = fresh_module("db")
    monkeypatch.setattr(app.db, "engine", db.engine)
    monkeypatch.setattr(app.routes.papers, "UPLOAD_DIR", tmp_path)
    try:
        assert inspect(db.engine).get_table_names() == []
        with TestClient(fastapi_app, raise_server_exceptions=False) as c:
            assert set(inspect(db.engine).get_table_names()) == {"paper", "chatmessage"}
            # Requests are served from several threads (event loop + worker pool); all must work.
            saved = c.post("/api/papers", json={"source": "arxiv", "external_id": "arxiv:1", "title": "Kept"})
            assert saved.status_code == 201
            assert c.post(f"/api/papers/{saved.json()['id']}/chat", json={"question": " "}).status_code == 400
            assert c.get(f"/api/papers/{saved.json()['id']}/chat").json() == []

        # A restart must not recreate (and so wipe) tables that already exist.
        with TestClient(fastapi_app, raise_server_exceptions=False) as c:
            assert [p["title"] for p in c.get("/api/papers").json()] == ["Kept"]
    finally:
        db.engine.dispose()


@pytest.fixture(autouse=True)
def _never_touch_real_backend_data(monkeypatch):
    """No test here may open the developer's real database."""
    real = app.db.engine

    def refuse(*args, **kwargs):
        raise AssertionError("test tried to connect to backend/data/papers.db")

    monkeypatch.setattr(real, "connect", refuse)
