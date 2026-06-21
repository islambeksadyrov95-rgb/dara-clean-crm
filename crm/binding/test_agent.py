"""Unit tests for the trip-binding agent's SAFETY-CRITICAL pure logic — junction-ID generation.

The only way an autonomous writer to the live Agbis Firebird can corrupt data is a bad junction ID:
  * wrong DEP prefix (≠103) → the row never replicates branch→center, or lands in another depot;
  * integer +1 across the 9999 boundary → 1039999+1 = 1040000 = DEP-4 collision.
Agbis itself builds the id as the STRING concat depPrefix||counter, so 103||10000 = 10310000 (8-digit),
never 1040000. These tests lock that behaviour. Run: python -m pytest binding/test_agent.py  (or unittest).
"""

import unittest

from agent import parse_counter, build_id, next_id, DEP_PREFIX


class TestJunctionId(unittest.TestCase):
    def test_dep_prefix_is_103(self):
        self.assertEqual(DEP_PREFIX, "103")  # GEN_CUR_DEP_ID for the Dara depot (DEP_SRC_ID=3)

    def test_parse_counter_strips_prefix(self):
        self.assertEqual(parse_counter(1039365), 9365)   # our test junctions
        self.assertEqual(parse_counter(1039295), 9295)   # real-office max
        self.assertEqual(parse_counter(103123), 123)     # short suffix (6-digit id)
        self.assertEqual(parse_counter(10310000), 10000) # 8-digit, post-9999

    def test_parse_counter_rejects_foreign_depot(self):
        with self.assertRaises(ValueError):
            parse_counter(1040000)  # DEP-4 band — must never be treated as ours
        with self.assertRaises(ValueError):
            parse_counter(1062239)  # DEP-6 band

    def test_build_id_is_string_concat(self):
        self.assertEqual(build_id(9366), 1039366)
        self.assertEqual(build_id(10000), 10310000)  # the critical 9999→8-digit transition
        self.assertEqual(build_id(123), 103123)

    def test_next_id_increments_within_band(self):
        self.assertEqual(next_id(1039365), 1039366)
        self.assertEqual(next_id(1039295), 1039296)

    def test_next_id_crosses_9999_without_depot_collision(self):
        # The whole point: 1039999 + 1 must become 10310000 (prefix 103), NEVER 1040000 (prefix 104).
        self.assertEqual(next_id(1039999), 10310000)
        self.assertTrue(str(next_id(1039999)).startswith("103"))

    def test_next_id_margin_clears_center_side_gaps(self):
        # A margin above local max guards against an id free locally but occupied on the center node
        # (replication lag) — the failure that left a junction on phantom order 1062187 last session.
        self.assertEqual(next_id(1039365, margin=5), 1039371)
        self.assertTrue(str(next_id(1039365, margin=50)).startswith("103"))


if __name__ == "__main__":
    unittest.main()
