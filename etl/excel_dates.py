# -*- coding: utf-8 -*-
"""Серийные даты Excel → ISO YYYY-MM-DD."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Union


def excel_serial_to_iso(value: Union[int, float]) -> str:
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=float(value))).strftime("%Y-%m-%d")


def cell_to_iso(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 20000 < float(value) < 60000:
            return excel_serial_to_iso(float(value))
    s = str(value).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s[:10]
