import { describe, it, expect, vi } from "vitest";
import { parseDuplicateResponse } from "../src/duplicate.js";

describe("parseDuplicateResponse", () => {
  it("parses valid response with duplicates", () => {
    const input = JSON.stringify({
      duplicates: [42, 17],
      reasoning: "Both describe the same login crash",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([42, 17]);
    expect(result.reasoning).toBe("Both describe the same login crash");
  });

  it("parses response with no duplicates", () => {
    const input = JSON.stringify({
      duplicates: [],
      reasoning: "No duplicates found among candidates.",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([]);
  });

  it("parses JSON wrapped in code block", () => {
    const json = JSON.stringify({
      duplicates: [5],
      reasoning: "Same bug report",
    });
    const input = "```json\n" + json + "\n```";

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([5]);
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseDuplicateResponse("not json at all");
    expect(result.duplicates).toEqual([]);
    expect(result.reasoning).toBe("Failed to parse duplicate detection response");
  });

  it("filters non-number entries from duplicates", () => {
    const input = JSON.stringify({
      duplicates: [1, "bad", null, 3],
      reasoning: "Test",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([1, 3]);
  });

  it("handles missing reasoning", () => {
    const input = JSON.stringify({ duplicates: [1] });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([1]);
    expect(result.reasoning).toBe("No reasoning provided");
  });

  it("truncates long reasoning", () => {
    const longReasoning = "x".repeat(500);
    const input = JSON.stringify({ duplicates: [], reasoning: longReasoning });

    const result = parseDuplicateResponse(input);
    expect(result.reasoning.length).toBeLessThanOrEqual(300);
  });
});
