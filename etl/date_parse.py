# -*- coding: utf-8 -*-
"""Единый разбор дат в ISO YYYY-MM-DD (в т.ч. ДД.ММ.ГГГГ из Excel/CSV)."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

_DDMMYYYY = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_to_iso(value: Any) -> str:
    """
    Возвращает YYYY-MM-DD или пустую строку если дату распознать нельзя.
    Поддержка: datetime, Excel serial, ISO-строка, ДД.ММ.ГГГГ.
    """
    if value is None:
        return ""
    if hasattr(value, "strftime") and not isinstance(value, str):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        fv = float(value)
        if 20000 < fv < 60000:
            from excel_dates import excel_serial_to_iso

            return excel_serial_to_iso(fv)
    s = str(value).strip().strip('"')
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    m = _DDMMYYYY.match(s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, d).strftime("%Y-%m-%d")
        except ValueError:
            return ""
    from excel_dates import cell_to_iso

    out = cell_to_iso(value)
    if len(out) >= 10 and out[4] == "-" and out[7] == "-":
        return out[:10]
    return ""
