import { describe, expect, it } from "vitest";
import { extractionBuildingFor, extractionPerDay } from "@/lib/extraction";

describe("extractionPerDay", () => {
  // The numbers the game shows for Katoa, which is what these rates were
  // checked against.
  it.each([
    ["LIQUID", 0.21, 15], // H2O
    ["GASEOUS", 0.28, 17], // O
    ["GASEOUS", 0.11, 7], // AMM
    ["MINERAL", 0.23, 16], // GAL
  ])("gives %s at factor %s as %i units a day", (type, factor, expected) => {
    expect(extractionPerDay(type, factor)).toBe(expected);
  });

  it("pulls gases more slowly than liquids and minerals at the same concentration", () => {
    expect(extractionPerDay("GASEOUS", 0.5)).toBe(30);
    expect(extractionPerDay("LIQUID", 0.5)).toBe(35);
    expect(extractionPerDay("MINERAL", 0.5)).toBe(35);
  });

  it("has no answer for a resource type it does not know", () => {
    expect(extractionPerDay("PLASMA", 0.5)).toBeNull();
  });

  it("has no answer without a concentration", () => {
    expect(extractionPerDay("MINERAL", null)).toBeNull();
    expect(extractionPerDay("MINERAL", 0)).toBeNull();
  });
});

describe("extractionBuildingFor", () => {
  it("maps each resource type to the building that extracts it", () => {
    expect(extractionBuildingFor("MINERAL")).toBe("EXT");
    expect(extractionBuildingFor("ORE")).toBe("EXT");
    expect(extractionBuildingFor("LIQUID")).toBe("RIG");
    expect(extractionBuildingFor("GASEOUS")).toBe("COL");
    expect(extractionBuildingFor("GAS")).toBe("COL");
  });

  it("ignores casing and padding", () => {
    expect(extractionBuildingFor("  mineral ")).toBe("EXT");
  });

  it("returns nothing for an unknown type", () => {
    expect(extractionBuildingFor("PLASMA")).toBeNull();
    expect(extractionBuildingFor(null)).toBeNull();
  });
});
