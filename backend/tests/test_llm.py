"""Unit tests for app/llm.py. The OpenAI client is replaced, so no HTTP is ever made."""

import json

import httpx2
import openai
import pytest

from app import llm

pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------- client construction


def test_get_client_requires_api_key(monkeypatch):
    monkeypatch.setattr(llm, "LLM_API_KEY", "")
    with pytest.raises(llm.LLMError, match="LLM_API_KEY is not set"):
        llm._get_client()


def test_get_client_uses_configured_endpoint_and_is_cached():
    c1 = llm._get_client()
    c2 = llm._get_client()
    assert c1 is c2
    assert isinstance(c1, openai.AsyncOpenAI)
    assert str(c1.base_url).startswith("http://llm.invalid/v1")
    assert c1.api_key == "test-key-not-real"


# ---------------------------------------------------------------- _chat


async def test_chat_sends_model_messages_temperature_and_strips_reply(fake_openai):
    fake_openai.content = "  \n The answer. \n"
    msgs = [{"role": "user", "content": "q"}]
    out = await llm._chat(msgs, temperature=0.7)
    assert out == "The answer."
    assert fake_openai.calls == [{"model": llm.LLM_MODEL, "messages": msgs, "temperature": 0.7}]


async def test_chat_default_temperature(fake_openai):
    await llm._chat([{"role": "user", "content": "q"}])
    assert fake_openai.calls[0]["temperature"] == 0.2


async def test_chat_none_content_becomes_empty_string(fake_openai):
    fake_openai.content = None
    assert await llm._chat([{"role": "user", "content": "q"}]) == ""


async def test_chat_wraps_api_error_as_llm_error(fake_openai):
    req = httpx2.Request("POST", "http://llm.invalid/v1/chat/completions")
    fake_openai.error = openai.APIConnectionError(request=req)
    with pytest.raises(llm.LLMError, match="LLM request failed") as exc:
        await llm._chat([{"role": "user", "content": "q"}])
    assert isinstance(exc.value.__cause__, openai.APIError)


async def test_chat_wraps_api_status_error(fake_openai):
    req = httpx2.Request("POST", "http://llm.invalid/v1/chat/completions")
    fake_openai.error = openai.APIError("rate limited", req, body=None)
    with pytest.raises(llm.LLMError, match="rate limited"):
        await llm._chat([{"role": "user", "content": "q"}])


# ---------------------------------------------------------------- _paper_context


def test_paper_context_wraps_text_with_title_and_markers():
    ctx = llm._paper_context("My Title", "body text")
    assert ctx.startswith("Title: My Title\n\n")
    assert "--- PAPER CONTENT START ---\nbody text\n--- PAPER CONTENT END ---" in ctx
    assert "truncated" not in ctx


def test_paper_context_truncates_long_text(monkeypatch):
    monkeypatch.setattr(llm, "MAX_CONTEXT_CHARS", 10)
    ctx = llm._paper_context("T", "0123456789zzzzz")
    assert "0123456789\n\n[...truncated...]" in ctx
    assert "z" not in ctx


def test_paper_context_text_exactly_at_limit_is_not_truncated(monkeypatch):
    monkeypatch.setattr(llm, "MAX_CONTEXT_CHARS", 5)
    ctx = llm._paper_context("T", "abcde")
    assert "abcde\n--- PAPER CONTENT END" in ctx
    assert "truncated" not in ctx


# ---------------------------------------------------------------- extract_metadata


async def test_extract_metadata_parses_clean_json(fake_llm):
    fake_llm.replies = [
        json.dumps(
            {
                "title": " Deep Things ",
                "authors": ["Ada Lovelace", " Alan Turing "],
                "year": 2021,
                "abstract": " We do things. ",
            }
        )
    ]
    meta = await llm.extract_metadata("first pages")
    assert meta == {
        "title": "Deep Things",
        "authors": ["Ada Lovelace", "Alan Turing"],
        "year": 2021,
        "abstract": "We do things.",
    }
    call = fake_llm.calls[0]
    assert call["temperature"] == 0
    assert len(call["messages"]) == 1 and call["messages"][0]["role"] == "user"
    assert call["messages"][0]["content"].startswith("Extract bibliographic metadata")
    assert call["messages"][0]["content"].endswith("first pages")


async def test_extract_metadata_tolerates_code_fences_and_chatter(fake_llm):
    fake_llm.replies = [
        'Sure! Here it is:\n```json\n{"title": "T", "authors": [], "year": null, "abstract": null}\n```\nHope that helps.'
    ]
    meta = await llm.extract_metadata("x")
    assert meta == {"title": "T", "authors": [], "year": None, "abstract": None}


async def test_extract_metadata_year_as_string_is_parsed(fake_llm):
    fake_llm.replies = ['{"title": "T", "authors": [], "year": "2019", "abstract": null}']
    assert (await llm.extract_metadata("x"))["year"] == 2019


@pytest.mark.parametrize("year", ["n/a", "circa 2019", "", None, 0])
async def test_extract_metadata_non_numeric_year_becomes_none(fake_llm, year):
    fake_llm.replies = [json.dumps({"title": "T", "authors": [], "year": year, "abstract": None})]
    assert (await llm.extract_metadata("x"))["year"] is None


async def test_extract_metadata_blank_fields_become_none_and_blank_authors_dropped(fake_llm):
    fake_llm.replies = [
        json.dumps({"title": "   ", "authors": ["", "  ", "Real Name"], "abstract": "  "})
    ]
    meta = await llm.extract_metadata("x")
    assert meta == {"title": None, "authors": ["Real Name"], "year": None, "abstract": None}


async def test_extract_metadata_missing_and_null_keys(fake_llm):
    fake_llm.replies = ['{"authors": null}']
    assert await llm.extract_metadata("x") == {
        "title": None,
        "authors": [],
        "year": None,
        "abstract": None,
    }


async def test_extract_metadata_non_string_authors_are_stringified(fake_llm):
    fake_llm.replies = ['{"title": "T", "authors": [42, "B"]}']
    assert (await llm.extract_metadata("x"))["authors"] == ["42", "B"]


async def test_extract_metadata_no_json_raises(fake_llm):
    fake_llm.replies = ["I could not find any metadata, sorry."]
    with pytest.raises(llm.LLMError, match="did not return JSON"):
        await llm.extract_metadata("x")


async def test_extract_metadata_invalid_json_raises(fake_llm):
    fake_llm.replies = ["{title: 'unquoted', }"]
    with pytest.raises(llm.LLMError, match="invalid JSON"):
        await llm.extract_metadata("x")


async def test_extract_metadata_truncates_input_to_12000_chars(fake_llm):
    fake_llm.replies = ['{"title": "T"}']
    text = "a" * 12000 + "OVERFLOW"
    await llm.extract_metadata(text)
    prompt = fake_llm.calls[0]["messages"][0]["content"]
    # Exactly the first 12000 characters close the prompt: not one character more.
    assert prompt.endswith("\n\n" + "a" * 12000)


async def test_extract_metadata_propagates_llm_error(fake_llm):
    fake_llm.replies = [llm.LLMError("down")]
    with pytest.raises(llm.LLMError, match="down"):
        await llm.extract_metadata("x")


# ---------------------------------------------------------------- summarize / answer


async def test_summarize_sends_system_prompt_and_paper_context(fake_llm):
    fake_llm.replies = ["## TL;DR\nGood."]
    out = await llm.summarize("Paper T", "full text body")
    assert out == "## TL;DR\nGood."
    (call,) = fake_llm.calls
    assert call["temperature"] == 0.2
    system, user = call["messages"]
    assert system["role"] == "system"
    assert system["content"].startswith("You are a research assistant. Summarize the paper")
    # The README promises these summary sections.
    for heading in ["## TL;DR", "## Problem", "## Approach", "## Datasets & Experiments",
                    "## Key Results", "## Limitations"]:
        assert f"\n{heading}" in system["content"]
    assert user == {
        "role": "user",
        "content": "Title: Paper T\n\n--- PAPER CONTENT START ---\nfull text body\n--- PAPER CONTENT END ---",
    }


async def test_answer_orders_system_history_then_question(fake_llm):
    fake_llm.replies = ["It uses ImageNet."]
    history = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
    ]
    out = await llm.answer("Paper T", "the text", history, "Which dataset?")
    assert out == "It uses ImageNet."
    msgs = fake_llm.calls[0]["messages"]
    assert msgs[0]["role"] == "system"
    assert "Paper T" in msgs[0]["content"] and "the text" in msgs[0]["content"]
    assert msgs[0]["content"].startswith("You are a research assistant answering questions")
    assert msgs[1:5] == history
    assert msgs[5] == {"role": "user", "content": "Which dataset?"}
    assert len(msgs) == 6


async def test_answer_does_not_mutate_callers_history(fake_llm):
    history = [{"role": "user", "content": "q1"}]
    await llm.answer("T", "x", history, "q2")
    assert history == [{"role": "user", "content": "q1"}]
