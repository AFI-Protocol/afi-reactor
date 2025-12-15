import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const dagConfig = JSON.parse(
  readFileSync(join(process.cwd(), "config/dag.codex.json"), "utf-8")
);

describe("dag.codex.json shape", () => {
  it("loads without throwing", () => {
    expect(dagConfig).toBeDefined();
  });

  it("contains a list of nodes with required fields", () => {
    const nodes = Array.isArray(dagConfig)
      ? dagConfig
      : Array.isArray((dagConfig as any).nodes)
        ? (dagConfig as any).nodes
        : [];

    expect(nodes.length).toBeGreaterThan(0);

    nodes.forEach((node: any) => {
      expect(typeof node.id).toBe("string");
      expect(node.id.length).toBeGreaterThan(0);
      expect(typeof node.type).toBe("string");
      if ("agentReady" in node) {
        expect(typeof node.agentReady).toBe("boolean");
      }
    });
  });
});
