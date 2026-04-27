# -*- coding: utf-8 -*-
"""Парсинг сумм в тенге: убираем ₸ ₽ $ «руб» «тг» пробелы NBSP, поддержка 1 234,56 и 1.234,56."""
from __future__ import annotations

import re
from typing import Any

_STRIP = re.compile(
    r"[\s\u00a0\u202f]+|"
    r"₸|₽|\$|€|"
    r"(?:руб|руб\.?|тг|тенге|kzt|usd)\.?",
    re.IGNORECASE,
)


def parse_amount(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    s = _STRIP.sub("", str(value).strip())
    if not s:
        return 0.0
    s = s.replace("\xa0", "").replace(" ", "")
    # последняя запятая как десятичный разделитель
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") > 0 and s.count(".") > 0:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0
