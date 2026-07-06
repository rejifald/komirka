import { describe, expect, it } from "vitest";

import { KNOB_BRAND } from "./index.js";

describe("KNOB_BRAND", () => {
  it("is the structural brand string used to detect knob descriptors", () => {
    expect(KNOB_BRAND).toBe("$knob");
  });
});
