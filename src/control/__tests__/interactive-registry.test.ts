// src/control/__tests__/interactive-registry.test.ts
import { describe, it, expect } from "vitest";
import { getInteractiveAdapter } from "../interactive/registry.js";

describe("interactive registry", () => {
  it("claude is strong tier", () => {
    expect(getInteractiveAdapter("claude").tier).toBe("strong");
  });
  it("codex is best-effort tier", () => {
    expect(getInteractiveAdapter("codex").tier).toBe("best-effort");
  });
  it("unknown provider throws", () => {
    expect(() => getInteractiveAdapter("gemini")).toThrow(/no interactive adapter/i);
  });
});
