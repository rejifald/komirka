import { describe, expect, it } from "vitest";

import { TESSERA_BRAND } from "./index.js";

describe("TESSERA_BRAND", () => {
  it("is the structural brand string used to detect tessera descriptors", () => {
    expect(TESSERA_BRAND).toBe("$tessera");
  });
});
