import { describe, it, expect } from "vitest";
import { buildSearchQuery } from "../src/forgejo/search.js";

describe("buildSearchQuery", () => {
  it("builds query with keyword extraction", () => {
    const query = buildSearchQuery("Login page crashes on Chrome 120", "owner", "repo");

    expect(query).toContain("repo:owner/repo");
    expect(query).toContain("is:issue");
    expect(query).toContain("is:open");
    expect(query).toContain("in:title");
  });

  it("filters short words and stop words", () => {
    const query = buildSearchQuery("a bug in the app", "owner", "repo");

    expect(query).not.toContain(" a ");
    expect(query).not.toContain(" in ");
    expect(query).not.toContain(" the ");
  });

  it("limits to 5 keywords", () => {
    const longTitle = "one two three four five six seven eight nine ten";
    const query = buildSearchQuery(longTitle, "owner", "repo");

    const keywordPart = query.split("in:title ")[1];
    const words = keywordPart.split(" ");
    expect(words.length).toBeLessThanOrEqual(5);
  });

  it("strips special characters", () => {
    const query = buildSearchQuery("Bug: [API] crash!!! @#$", "owner", "repo");

    expect(query).not.toContain("[");
    expect(query).not.toContain("!");
    expect(query).not.toContain("@");
  });
});
