/**
 * TEMPORARY placeholder so the toolchain (build, typecheck, lint, test, size) has a
 * real entry to operate on. This is NOT the public API — it will be replaced when the
 * first real descriptor primitive lands. See principles.md (P1) for the design.
 */

/** Structural brand marking a value as an inert knob descriptor (principles.md P1). */
export const KNOB_BRAND = "$knob" as const;

/** The literal type of {@link KNOB_BRAND}. */
export type KnobBrand = typeof KNOB_BRAND;
