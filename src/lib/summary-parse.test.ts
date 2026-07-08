import { describe, it, expect } from "vitest";
import { parseSummary } from "./summary-parse";

describe("parseSummary", () => {
  it("splits summary from follow-ups on the --- delimiter", () => {
    const raw = [
      "Baltimore led the NFL with 3,009 rushing yards in 2023.",
      "---",
      "Who were Baltimore's top rushers?",
      "Which team had the most rushing touchdowns?",
    ].join("\n");
    const { summary, followups } = parseSummary(raw);
    expect(summary).toBe("Baltimore led the NFL with 3,009 rushing yards in 2023.");
    expect(followups).toEqual([
      "Who were Baltimore's top rushers?",
      "Which team had the most rushing touchdowns?",
    ]);
  });

  it("treats the whole text as the summary when there is no delimiter", () => {
    const { summary, followups } = parseSummary("No rows matched that filter.");
    expect(summary).toBe("No rows matched that filter.");
    expect(followups).toEqual([]);
  });

  it("strips bullets and numbering from follow-ups", () => {
    const raw = "Summary line.\n---\n- First question?\n2. Second question?\n* Third question?";
    const { followups } = parseSummary(raw);
    expect(followups).toEqual([
      "First question?",
      "Second question?",
      "Third question?",
    ]);
  });

  it("caps at three follow-ups and drops blank lines", () => {
    const raw = "S.\n---\nOne?\n\nTwo?\n\nThree?\nFour?";
    expect(parseSummary(raw).followups).toEqual(["One?", "Two?", "Three?"]);
  });

  it("drops overly long follow-up lines", () => {
    const raw = `S.\n---\n${"x".repeat(200)}\nShort one?`;
    expect(parseSummary(raw).followups).toEqual(["Short one?"]);
  });
});
