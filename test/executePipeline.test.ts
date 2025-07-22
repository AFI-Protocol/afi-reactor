import { describe, it, expect } from "vitest";
import { executePipeline } from "../ops/runner/executePipeline.js";

describe("executePipeline", () => {
  it("should run the 'signal-to-vault' pipeline and return a valid signal", async () => {
    const result = await executePipeline("signal-to-vault");

    expect(result).toBeDefined();
    expect(result).toHaveProperty("signalId");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("approvalStatus");
    expect(result).toHaveProperty("vaultStatus");
    expect(typeof result.signalId).toBe("string");
    expect(typeof result.score).toBe("number");
    expect(typeof result.confidence).toBe("number");
    expect(typeof result.timestamp).toBe("string");
    expect(["approved", "rejected"]).toContain(result.approvalStatus);
    expect(result.vaultStatus).toBe("stored");
  });
});
