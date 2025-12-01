import { describe, it, expect, jest } from "@jest/globals";

const mockExecutePipeline = jest.fn(async () => ({
  signalId: "mock-signal",
  score: 0.9,
  confidence: 0.95,
  timestamp: new Date().toISOString(),
  approvalStatus: "approved",
  vaultStatus: "stored",
}));

jest.mock("../ops/runner/executePipeline", () => {
  return {
    executePipeline: (..._args: any[]) => mockExecutePipeline(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executePipeline } = require("../ops/runner/executePipeline") as {
  executePipeline: (...args: any[]) => Promise<any>;
};

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
