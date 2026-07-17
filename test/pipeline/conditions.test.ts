/**
 * Predicate-tree evaluator unit tests: all eleven governed operators,
 * missing-path semantics, fail-closed unknown shapes.
 */
import {
  ConditionEvaluationError,
  evaluatePredicate,
  resolvePath,
  type ConditionEnv,
} from "../../src/pipeline/conditions.js";

const env: ConditionEnv = {
  nodes: {
    technical: {
      output: { atrPct: 2.5, trendBias: "bullish", flags: { hot: true }, nullField: null },
    },
  },
  context: { market: "perp", depth: 3 },
};

describe("resolvePath", () => {
  it("resolves node outputs and context", () => {
    expect(resolvePath(env, "/nodes/technical/output/atrPct")).toBe(2.5);
    expect(resolvePath(env, "/nodes/technical/output/flags/hot")).toBe(true);
    expect(resolvePath(env, "/context/market")).toBe("perp");
  });

  it("missing paths resolve to undefined", () => {
    expect(resolvePath(env, "/nodes/absent/output/x")).toBeUndefined();
    expect(resolvePath(env, "/nodes/technical/output/absent")).toBeUndefined();
  });

  it("rejects malformed paths", () => {
    expect(() => resolvePath(env, "nodes/technical")).toThrow(ConditionEvaluationError);
    expect(() => resolvePath(env, "")).toThrow(ConditionEvaluationError);
  });
});

describe("evaluatePredicate operators", () => {
  it("exists", () => {
    expect(evaluatePredicate({ exists: "/nodes/technical/output/atrPct" }, env)).toBe(true);
    expect(evaluatePredicate({ exists: "/nodes/technical/output/absent" }, env)).toBe(false);
    // null is a present value
    expect(evaluatePredicate({ exists: "/nodes/technical/output/nullField" }, env)).toBe(true);
  });

  it("eq / ne (scalar equality; missing path never equals)", () => {
    expect(
      evaluatePredicate({ eq: { path: "/nodes/technical/output/trendBias", value: "bullish" } }, env)
    ).toBe(true);
    expect(
      evaluatePredicate({ eq: { path: "/nodes/technical/output/absent", value: "x" } }, env)
    ).toBe(false);
    expect(
      evaluatePredicate({ ne: { path: "/nodes/technical/output/trendBias", value: "bearish" } }, env)
    ).toBe(true);
    expect(
      evaluatePredicate({ eq: { path: "/nodes/technical/output/nullField", value: null } }, env)
    ).toBe(true);
  });

  it("gt / gte / lt / lte (numeric only; non-numeric resolution is false)", () => {
    expect(evaluatePredicate({ gte: { path: "/nodes/technical/output/atrPct", value: 2 } }, env)).toBe(true);
    expect(evaluatePredicate({ gt: { path: "/nodes/technical/output/atrPct", value: 2.5 } }, env)).toBe(false);
    expect(evaluatePredicate({ lt: { path: "/context/depth", value: 4 } }, env)).toBe(true);
    expect(evaluatePredicate({ lte: { path: "/context/depth", value: 2 } }, env)).toBe(false);
    // string / missing resolutions are not ordered
    expect(evaluatePredicate({ gte: { path: "/nodes/technical/output/trendBias", value: 0 } }, env)).toBe(false);
    expect(evaluatePredicate({ gte: { path: "/nodes/technical/output/absent", value: 0 } }, env)).toBe(false);
  });

  it("in", () => {
    expect(
      evaluatePredicate(
        { in: { path: "/context/market", values: ["spot", "perp"] } },
        env
      )
    ).toBe(true);
    expect(
      evaluatePredicate({ in: { path: "/context/market", values: ["spot"] } }, env)
    ).toBe(false);
  });

  it("all / any / not compose", () => {
    const p = {
      all: [
        { exists: "/nodes/technical/output/atrPct" },
        {
          any: [
            { eq: { path: "/context/market", value: "spot" } },
            { gte: { path: "/nodes/technical/output/atrPct", value: 2 } },
          ],
        },
        { not: { eq: { path: "/context/market", value: "gateway" } } },
      ],
    };
    expect(evaluatePredicate(p, env)).toBe(true);
  });

  it("fails closed on unknown operators and malformed shapes", () => {
    expect(() => evaluatePredicate({ matches: { path: "/x", value: 1 } }, env)).toThrow(
      ConditionEvaluationError
    );
    expect(() => evaluatePredicate({}, env)).toThrow(ConditionEvaluationError);
    expect(() =>
      evaluatePredicate({ eq: { path: "/x", value: 1 }, ne: { path: "/x", value: 1 } }, env)
    ).toThrow(ConditionEvaluationError);
    expect(() => evaluatePredicate({ all: [] }, env)).toThrow(ConditionEvaluationError);
    expect(() => evaluatePredicate({ eq: { path: "/x", value: { o: 1 } } }, env)).toThrow(
      ConditionEvaluationError
    );
    expect(() => evaluatePredicate("true", env)).toThrow(ConditionEvaluationError);
  });
});
