import { describe, it, expect } from "vitest";
import { PopStateTracker } from "../src/core/state.js";

// ---------------------------------------------------------------------------
// PopStateTracker (mirrors Python test_rename_smoke.py state tracker tests)
// ---------------------------------------------------------------------------
describe("PopStateTracker", () => {
  it("instantiates with in-memory db", () => {
    const tracker = new PopStateTracker(":memory:");
    expect(tracker).toBeDefined();
    expect(tracker.dailySpendTotal).toBe(0);
    tracker.close();
  });

  it("records and retrieves seal", () => {
    const tracker = new PopStateTracker(":memory:");
    tracker.recordSeal("seal-1", 50, "AWS", "Issued", "****-1234", "12/27");
    const masked = tracker.getSealMaskedCard("seal-1");
    expect(masked).toBe("****-1234");
    tracker.close();
  });

  it("canSpend checks daily budget", () => {
    const tracker = new PopStateTracker(":memory:");
    expect(tracker.canSpend(100, 500)).toBe(true);
    tracker.addSpend(400);
    expect(tracker.canSpend(100, 500)).toBe(true);
    expect(tracker.canSpend(101, 500)).toBe(false);
    tracker.close();
  });

  it("markUsed and isUsed", () => {
    const tracker = new PopStateTracker(":memory:");
    tracker.recordSeal("seal-2", 25, "GitHub", "Issued");
    expect(tracker.isUsed("seal-2")).toBe(false);
    tracker.markUsed("seal-2");
    expect(tracker.isUsed("seal-2")).toBe(true);
    tracker.close();
  });

  it("addSpend accumulates daily total", () => {
    const tracker = new PopStateTracker(":memory:");
    tracker.addSpend(100);
    tracker.addSpend(50);
    expect(tracker.dailySpendTotal).toBe(150);
    tracker.close();
  });

  it("getSealMaskedCard returns empty for unknown seal", () => {
    const tracker = new PopStateTracker(":memory:");
    expect(tracker.getSealMaskedCard("nonexistent")).toBe("");
    tracker.close();
  });

  it("isUsed returns false for unknown seal", () => {
    const tracker = new PopStateTracker(":memory:");
    expect(tracker.isUsed("nonexistent")).toBe(false);
    tracker.close();
  });

  it("multiple seals tracked independently", () => {
    const tracker = new PopStateTracker(":memory:");
    tracker.recordSeal("a", 10, "AWS", "Issued", "****-1111");
    tracker.recordSeal("b", 20, "GitHub", "Issued", "****-2222");
    expect(tracker.getSealMaskedCard("a")).toBe("****-1111");
    expect(tracker.getSealMaskedCard("b")).toBe("****-2222");
    tracker.markUsed("a");
    expect(tracker.isUsed("a")).toBe(true);
    expect(tracker.isUsed("b")).toBe(false);
    tracker.close();
  });
});
