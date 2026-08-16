import unittest


def generate_rolloff_curves() -> tuple[list[int], list[int]]:
    highlight = [255] * 492
    shadow = [0] * 492

    for index in range(267):
        input_value = index + 225
        output_value = (
            225 + 30 * (((input_value - 225) / 30) ** 0.5)
            if input_value <= 255
            else 255
        )
        highlight[index] = round(output_value)

    for index in range(492):
        input_value = index - 461
        if input_value < 0:
            output_value = 0
        elif input_value <= 30:
            output_value = 30 * ((input_value / 30) ** 2)
        else:
            output_value = min(input_value, 255)
        shadow[index] = round(output_value)

    return highlight, shadow


class RolloffEdgeTests(unittest.TestCase):
    def test_highlight_curve_matches_notebook_edges(self):
        highlight, _ = generate_rolloff_curves()
        self.assertEqual(len(highlight), 492)
        self.assertEqual(highlight[0], 225)
        self.assertEqual(highlight[1], 230)
        self.assertEqual(highlight[29], 254)
        self.assertEqual(highlight[30], 255)
        self.assertEqual(highlight[-1], 255)

    def test_shadow_curve_matches_notebook_edges(self):
        _, shadow = generate_rolloff_curves()
        self.assertEqual(len(shadow), 492)
        self.assertEqual(shadow[461], 0)
        self.assertEqual(shadow[466], 1)
        self.assertEqual(shadow[476], 8)
        self.assertEqual(shadow[491], 30)


if __name__ == "__main__":
    unittest.main()
