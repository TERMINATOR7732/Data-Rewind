"""Deterministic serialization for tabular comparison results.

Conforms to Section 1 of SPEC-MOD-04.
"""

from __future__ import annotations

import json

from data_rewind.comparator.models import TabularDiffResult


def serialize_diff_result(result: TabularDiffResult) -> str:
    """Serialize TabularDiffResult to deterministic canonical JSON."""
    raw_dict = result.model_dump(mode="json")
    return json.dumps(raw_dict, sort_keys=True, indent=2)


def deserialize_diff_result(json_str: str) -> TabularDiffResult:
    """Deserialize TabularDiffResult from JSON string."""
    data = json.loads(json_str)
    return TabularDiffResult.model_validate(data)


# Aliases
diff_result_to_json = serialize_diff_result
diff_result_from_json = deserialize_diff_result
