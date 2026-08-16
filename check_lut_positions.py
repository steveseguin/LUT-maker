import unittest


def neutral_lut_value(step: int) -> int:
    if not 0 <= step <= 63:
        raise ValueError("step must be between 0 and 63")
    return round(step * 255 / 63)


def neutral_lut_rgb_at(x: int, y: int) -> tuple[int, int, int]:
    if not (0 <= x < 512 and 0 <= y < 512):
        raise ValueError("coordinates must be inside the 512x512 LUT")

    block_index = (y // 64) * 8 + (x // 64)
    return (
        neutral_lut_value(x % 64),
        neutral_lut_value(y % 64),
        neutral_lut_value(block_index),
    )


class NeutralLutPositionTests(unittest.TestCase):
    def test_key_positions_match_the_obs_neutral_lut(self):
        self.assertEqual(neutral_lut_rgb_at(0, 0), (0, 0, 0))
        self.assertEqual(neutral_lut_rgb_at(1, 0), (4, 0, 0))
        self.assertEqual(neutral_lut_rgb_at(63, 0), (255, 0, 0))
        self.assertEqual(neutral_lut_rgb_at(64, 0), (0, 0, 4))
        self.assertEqual(neutral_lut_rgb_at(0, 63), (0, 255, 0))
        self.assertEqual(neutral_lut_rgb_at(511, 511), (255, 255, 255))

    def test_all_channels_reach_both_endpoints(self):
        values = [neutral_lut_value(step) for step in range(64)]
        self.assertEqual(values[0], 0)
        self.assertEqual(values[-1], 255)
        self.assertEqual(len(set(values)), 64)


if __name__ == "__main__":
    unittest.main()
