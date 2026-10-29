"""Vercel Serverless Function entry point for Data Rewind FastAPI application.

Provides single-origin serverless hosting for the Data Rewind API.
Enforces hosted_demo profile defaults and ephemeral workspace storage.
Conforms to SPEC-MOD-07 and SPEC-MOD-09.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Path Resolution: Ensure project root and src/ are importable
# ---------------------------------------------------------------------------
_CURRENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _CURRENT_DIR.parent
_SRC_DIR = _PROJECT_ROOT / "src"

if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Profile & Storage Defaults for Serverless Execution
# ---------------------------------------------------------------------------
os.environ.setdefault("DATA_REWIND_PROFILE", "hosted_demo")

# Default ephemeral storage to /tmp/data_rewind on Unix/Linux, system temp on Windows
if sys.platform != "win32":
    os.environ.setdefault("DATA_REWIND_DATA_DIR", "/tmp/data_rewind")
else:
    os.environ.setdefault("DATA_REWIND_DATA_DIR", str(Path(tempfile.gettempdir()) / "data_rewind"))

from data_rewind import __version__  # noqa: E402
from data_rewind.api.main import app  # noqa: E402


@app.get("/api", tags=["Health & System"])
@app.get("/api/", tags=["Health & System"])
def get_api_root() -> dict[str, str]:
    """Top-level API metadata and operational profile status."""
    return {
        "status": "ok",
        "service": "Data Rewind API",
        "version": __version__,
        "profile": os.environ.get("DATA_REWIND_PROFILE", "hosted_demo"),
        "docs_url": "/api/docs",
    }
