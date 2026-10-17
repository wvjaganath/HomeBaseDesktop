"""HomeBase: headless stand-in for the rpi-rgb-led-matrix Python bindings.

On the server there is no LED panel. The tracker's display loop still runs
unchanged, because it is also what schedules the flight, weather and alert
updates; it just draws into this no-op canvas. The real panel is the LED Pi,
which runs the tracker as a slave of this server.
"""

from . import graphics  # noqa: F401  (re-exported like the real package)

__all__ = ["RGBMatrix", "RGBMatrixOptions", "FrameCanvas", "graphics"]


class RGBMatrixOptions:
    """Accepts any option the tracker sets (rows, cols, gpio_slowdown, …)."""

    def __init__(self) -> None:
        self.rows = 32
        self.cols = 64
        self.chain_length = 1
        self.parallel = 1
        self.brightness = 100


class FrameCanvas:
    def __init__(self, width: int = 64, height: int = 32) -> None:
        self.width = width
        self.height = height
        self.brightness = 100

    def Clear(self) -> None:  # noqa: N802 (mirrors the C++ API names)
        pass

    def Fill(self, r: int, g: int, b: int) -> None:  # noqa: N802
        pass

    def SetPixel(self, x: int, y: int, r: int, g: int, b: int) -> None:  # noqa: N802
        pass

    def SetImage(self, image, offset_x: int = 0, offset_y: int = 0, unsafe: bool = True) -> None:  # noqa: N802
        pass


class RGBMatrix(FrameCanvas):
    def __init__(self, rows: int = 32, chains: int = 1, parallel: int = 1, options: RGBMatrixOptions | None = None) -> None:
        opts = options or RGBMatrixOptions()
        cols = getattr(opts, "cols", 64) * getattr(opts, "chain_length", chains)
        super().__init__(cols, getattr(opts, "rows", rows) * getattr(opts, "parallel", parallel))
        self.brightness = getattr(opts, "brightness", 100)
        self.luminanceCorrect = True

    def CreateFrameCanvas(self) -> FrameCanvas:  # noqa: N802
        return FrameCanvas(self.width, self.height)

    def SwapOnVSync(self, canvas: FrameCanvas, framerate_fraction: int = 1) -> FrameCanvas:  # noqa: N802
        return canvas
