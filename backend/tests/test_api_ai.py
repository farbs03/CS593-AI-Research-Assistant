"""API tests for summaries and per-paper Q&A (/api/papers/{id}/summary and /chat). LLM is faked."""

from types import SimpleNamespace

import pytest
from sqlmodel import select

from app import llm
from app.llm import LLMError
from app.models import ChatMessage, Paper


def summarize(client, pid, regenerate=None):
    url = f"/api/papers/{pid}/summary"
    if regenerate is not None:
        url += f"?regenerate={str(regenerate).lower()}"
    return client.post(url)


def ask(client, pid, question):
    return client.post(f"/api/papers/{pid}/chat", json={"question": question})


# ---------------------------------------------------------------- summary


def test_summary_generated_from_full_text_and_persisted(client, session, add_paper, fake_llm):
    p = add_paper(title="Paper T", full_text="FULL BODY TEXT", abstract="short abstract", text_status="full")
    fake_llm.replies = ["## TL;DR\nGreat paper."]
    r = summarize(client, p.id)
    assert r.status_code == 200
    assert r.json() == {"summary": "## TL;DR\nGreat paper."}

    (call,) = fake_llm.calls
    user_content = call["messages"][1]["content"]
    assert "Title: Paper T" in user_content
    assert "FULL BODY TEXT" in user_content
    assert "short abstract" not in user_content  # full text takes priority
    assert call["messages"][0]["content"].startswith("You are a research assistant. Summarize")

    session.expire_all()
    assert session.get(Paper, p.id).summary == "## TL;DR\nGreat paper."
    assert client.get(f"/api/papers/{p.id}").json()["summary"] == "## TL;DR\nGreat paper."


def test_summary_is_cached(client, add_paper, fake_llm):
    p = add_paper(full_text="body")
    fake_llm.replies = ["first summary", "second summary"]
    assert summarize(client, p.id).json()["summary"] == "first summary"
    assert summarize(client, p.id).json()["summary"] == "first summary"
    assert summarize(client, p.id, regenerate=False).json()["summary"] == "first summary"
    assert len(fake_llm.calls) == 1


def test_summary_regenerate_overwrites_cache(client, add_paper, fake_llm):
    p = add_paper(full_text="body", summary="old summary")
    fake_llm.replies = ["new summary"]
    r = summarize(client, p.id, regenerate=True)
    assert r.json()["summary"] == "new summary"
    assert len(fake_llm.calls) == 1
    assert client.get(f"/api/papers/{p.id}").json()["summary"] == "new summary"


def test_summary_from_abstract_only_is_flagged(client, add_paper, fake_llm):
    p = add_paper(abstract="We study X.", full_text=None)
    fake_llm.replies = ["abstract summary"]
    assert summarize(client, p.id).status_code == 200
    content = fake_llm.calls[0]["messages"][1]["content"]
    assert "[Only the abstract is available for this paper.]" in content
    assert "Abstract: We study X." in content


def test_summary_without_any_text_is_400(client, add_paper, fake_llm):
    p = add_paper(abstract=None, full_text=None)
    r = summarize(client, p.id)
    assert r.status_code == 400
    assert "Upload its PDF" in r.json()["detail"]
    assert fake_llm.calls == []


def test_summary_empty_strings_count_as_no_text(client, add_paper, fake_llm):
    p = add_paper(abstract="", full_text="")
    assert summarize(client, p.id).status_code == 400


def test_summary_llm_failure_is_502_and_not_cached(client, session, add_paper, fake_llm):
    p = add_paper(full_text="body")
    fake_llm.replies = [LLMError("LLM request failed: boom")]
    r = summarize(client, p.id)
    assert r.status_code == 502
    assert r.json()["detail"] == "LLM request failed: boom"
    session.expire_all()
    assert session.get(Paper, p.id).summary is None

    fake_llm.replies = ["works now"]
    assert summarize(client, p.id).json()["summary"] == "works now"


def test_summary_regenerate_failure_keeps_old_summary(client, session, add_paper, fake_llm):
    p = add_paper(full_text="body", summary="old")
    fake_llm.replies = [LLMError("down")]
    assert summarize(client, p.id, regenerate=True).status_code == 502
    assert client.get(f"/api/papers/{p.id}").json()["summary"] == "old"


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: llm._chat turns an empty/None completion into '' (app/llm.py:34) and summarize "
    "(app/routes/ai.py:32-37) stores and returns it: 200 {'summary': ''} instead of a 502.",
)
@pytest.mark.parametrize("content", [None, "  \n "], ids=["null", "whitespace"])
def test_blank_llm_summary_is_502_and_not_cached(client, session, add_paper, fake_openai, content):
    p = add_paper(full_text="body")
    fake_openai.content = content
    r = summarize(client, p.id)
    assert r.status_code == 502
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]
    session.expire_all()
    assert session.get(Paper, p.id).summary is None


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: llm._chat indexes resp.choices[0] (app/llm.py:34) unguarded; an OpenAI-compatible "
    "provider answering with no choices (e.g. a content filter) raises IndexError -> 500, not 502.",
)
def test_llm_reply_without_choices_is_502(client, add_paper, monkeypatch):
    class NoChoices:
        async def create(self, **kwargs):
            return SimpleNamespace(choices=[])

    monkeypatch.setattr(llm, "_get_client", lambda: SimpleNamespace(chat=SimpleNamespace(completions=NoChoices())))
    p = add_paper(full_text="body")
    r = summarize(client, p.id)
    assert r.status_code == 502
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]


def test_summary_missing_api_key_is_502(client, add_paper, monkeypatch):
    from app import llm

    monkeypatch.setattr(llm, "LLM_API_KEY", "")
    p = add_paper(full_text="body")
    r = summarize(client, p.id)
    assert r.status_code == 502
    assert "LLM_API_KEY" in r.json()["detail"]


# ---------------------------------------------------------------- chat


def test_chat_history_initially_empty(client, add_paper):
    p = add_paper(full_text="body")
    r = client.get(f"/api/papers/{p.id}/chat")
    assert r.status_code == 200
    assert r.json() == []


def test_ask_returns_and_persists_message_pair(client, add_paper, fake_llm):
    p = add_paper(title="Paper T", full_text="It uses ImageNet.")
    fake_llm.replies = ["ImageNet."]
    r = ask(client, p.id, "  Which dataset?  ")
    assert r.status_code == 200
    user, assistant = r.json()
    assert user["role"] == "user" and user["content"] == "Which dataset?"
    assert assistant["role"] == "assistant" and assistant["content"] == "ImageNet."
    assert user["paper_id"] == assistant["paper_id"] == p.id
    assert isinstance(user["id"], int) and assistant["id"] > user["id"]
    assert "created_at" in user

    msgs = fake_llm.calls[0]["messages"]
    assert "It uses ImageNet." in msgs[0]["content"]
    assert msgs[-1] == {"role": "user", "content": "Which dataset?"}
    assert len(msgs) == 2  # no history yet

    history = client.get(f"/api/papers/{p.id}/chat").json()
    assert [(m["role"], m["content"]) for m in history] == [("user", "Which dataset?"), ("assistant", "ImageNet.")]


def test_follow_up_questions_include_prior_turns(client, add_paper, fake_llm):
    p = add_paper(full_text="body")
    fake_llm.replies = ["a1", "a2", "a3"]
    ask(client, p.id, "q1")
    ask(client, p.id, "q2")
    ask(client, p.id, "q3")
    third = fake_llm.calls[2]["messages"]
    assert third[1:] == [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
        {"role": "user", "content": "q3"},
    ]
    history = client.get(f"/api/papers/{p.id}/chat").json()
    assert [m["content"] for m in history] == ["q1", "a1", "q2", "a2", "q3", "a3"]


def test_chat_histories_are_per_paper(client, add_paper, fake_llm):
    a = add_paper(title="A", full_text="a body")
    b = add_paper(title="B", full_text="b body")
    fake_llm.replies = ["about A", "about B"]
    ask(client, a.id, "question A")
    ask(client, b.id, "question B")
    assert len(fake_llm.calls[1]["messages"]) == 2  # paper A's turns are not leaked into B
    assert [m["content"] for m in client.get(f"/api/papers/{b.id}/chat").json()] == ["question B", "about B"]


def test_ask_abstract_only_paper_uses_flagged_abstract(client, add_paper, fake_llm):
    p = add_paper(abstract="Only this.")
    ask(client, p.id, "q")
    assert "[Only the abstract is available for this paper.]" in fake_llm.calls[0]["messages"][0]["content"]


def test_ask_paper_without_text_is_400(client, add_paper, fake_llm, session):
    p = add_paper(abstract=None, full_text=None)
    r = ask(client, p.id, "q")
    assert r.status_code == 400
    assert fake_llm.calls == []
    assert session.exec(select(ChatMessage)).all() == []


def test_ask_empty_question_is_400(client, add_paper, fake_llm):
    p = add_paper(full_text="body")
    for q in ["", "   ", "\n\t"]:
        r = ask(client, p.id, q)
        assert r.status_code == 400
        assert r.json()["detail"] == "Question is empty"
    assert fake_llm.calls == []


def test_ask_requires_question_field(client, add_paper):
    p = add_paper(full_text="body")
    assert client.post(f"/api/papers/{p.id}/chat", json={}).status_code == 422
    assert client.post(f"/api/papers/{p.id}/chat", json={"question": None}).status_code == 422


def test_ask_llm_failure_is_502_and_nothing_saved(client, add_paper, fake_llm):
    p = add_paper(full_text="body")
    fake_llm.replies = [LLMError("LLM request failed: 429")]
    r = ask(client, p.id, "q")
    assert r.status_code == 502
    assert r.json()["detail"] == "LLM request failed: 429"
    assert client.get(f"/api/papers/{p.id}/chat").json() == []


@pytest.mark.xfail(
    strict=True,
    reason="APP BUG: ask (app/routes/ai.py:56-66) treats a blank LLM answer ('' from llm._chat) as a "
    "success: it returns 200 and saves the question with an empty assistant message.",
)
def test_blank_llm_answer_is_502_and_nothing_saved(client, session, add_paper, fake_openai):
    p = add_paper(full_text="body")
    fake_openai.content = "   "
    r = ask(client, p.id, "What is it about?")
    assert r.status_code == 502
    assert isinstance(r.json()["detail"], str) and r.json()["detail"]
    assert session.exec(select(ChatMessage)).all() == []


def test_clear_chat_only_affects_that_paper(client, add_paper, fake_llm):
    a = add_paper(title="A", full_text="a")
    b = add_paper(title="B", full_text="b")
    ask(client, a.id, "qa")
    ask(client, b.id, "qb")
    r = client.delete(f"/api/papers/{a.id}/chat")
    assert r.status_code == 204
    assert client.get(f"/api/papers/{a.id}/chat").json() == []
    assert len(client.get(f"/api/papers/{b.id}/chat").json()) == 2
    # The paper itself is untouched.
    assert client.get(f"/api/papers/{a.id}").status_code == 200


def test_after_clear_new_questions_start_fresh(client, add_paper, fake_llm):
    p = add_paper(full_text="body")
    ask(client, p.id, "old q")
    client.delete(f"/api/papers/{p.id}/chat")
    ask(client, p.id, "new q")
    assert len(fake_llm.calls[1]["messages"]) == 2


def test_clear_empty_chat_is_204(client, add_paper):
    p = add_paper()
    assert client.delete(f"/api/papers/{p.id}/chat").status_code == 204
