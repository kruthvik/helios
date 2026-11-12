import { expect, test } from "bun:test";
import { measuredLyricHeight } from "./lyric-height";

test("spacer heights recover subpixel precision lost by CSSOM serialization", () => {
  expect(measuredLyricHeight("207.312px")).toBe("207.3125px");
  expect(measuredLyricHeight("126.969px")).toBe("126.96875px");
  expect(measuredLyricHeight("0px")).toBe("0px");
  expect(measuredLyricHeight("auto")).toBe("auto");
  for (let unit = 1; unit < 20000; unit++) {
    const height = unit / 64;
    expect(measuredLyricHeight(`${Number(height.toPrecision(6))}px`)).toBe(`${height}px`);
  }
});

