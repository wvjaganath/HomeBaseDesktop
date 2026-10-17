"""HomeBase: headless stand-in for rgbmatrix.graphics (fonts, colours, drawing)."""

import os
import re


class Color:
    def __init__(self, red: int = 0, green: int = 0, blue: int = 0) -> None:
        self.red = red
        self.green = green
        self.blue = blue

    def SetColor(self, red: int, green: int, blue: int) -> None:  # noqa: N802
        self.red, self.green, self.blue = red, green, blue


class Font:
    """Takes its cell size from the BDF file name (e.g. 6x13.bdf), so text
    widths come out as they would on the panel; the file needn't exist."""

    def __init__(self) -> None:
        self.width = 5
        self.height = 8
        self.baseline = 7

    def LoadFont(self, path: str) -> None:  # noqa: N802
        m = re.match(r"(\d+)x(\d+)", os.path.basename(path))
        if m:
            self.width, self.height = int(m.group(1)), int(m.group(2))
            self.baseline = self.height - 2

    def CharacterWidth(self, char: int) -> int:  # noqa: N802
        return self.width


def DrawText(canvas, font: Font, x: int, y: int, color: Color, text: str) -> int:  # noqa: N802
    return len(text or "") * font.width


def DrawLine(canvas, x1: int, y1: int, x2: int, y2: int, color: Color) -> None:  # noqa: N802
    pass


def DrawCircle(canvas, x: int, y: int, r: int, color: Color) -> None:  # noqa: N802
    pass
