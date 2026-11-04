"""Imported first by conftest.py: makes accidental real LLM / API calls impossible.

app.config calls load_dotenv() at import time, and load_dotenv never overrides
variables that are already set, so pinning them here wins over backend/.env.
"""

import os

os.environ["LLM_API_KEY"] = "test-key-not-real"
os.environ["LLM_BASE_URL"] = "http://llm.invalid/v1"
os.environ["S2_API_KEY"] = ""
