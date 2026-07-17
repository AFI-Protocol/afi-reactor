/**
 * Predicate-tree evaluator for conditional edges (W3 spec section 0/2;
 * afi.pipeline.v1 #/definitions/predicate).
 *
 * Conditions are pure DATA — a bounded tree of the eleven governed operators
 * (all / any / not / exists / eq / ne / gt / gte / lt / lte / in) over
 * JSON-pointer-style paths into VALIDATED node outputs
 * (/nodes/<nodeId>/output/...) or pipeline context (/context/...). Code
 * strings, expression languages, and unknown operators are structurally
 * rejected by the vendored schema; this evaluator additionally fails closed
 * (throws) on any shape it does not recognize, so a schema bypass can never
 * silently evaluate.
 *
 * Determinism: evaluation is a pure function of (predicate, environment).
 * Missing paths resolve to `undefined`: exists → false, eq → false
 * (undefined never equals a scalar), ne → true, ordering comparisons →
 * false (undefined is not a number), in → false.
 */

/** The environment predicates evaluate over. */
export interface ConditionEnv {
  /** Settled node outputs keyed by nodeId: /nodes/<id>/output/... */
  nodes: Record<string, { output: unknown }>;
  /** Pipeline context: /context/... */
  context: Record<string, unknown>;
}

export class ConditionEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionEvaluationError";
  }
}

type Scalar = string | number | boolean | null;

const PATH_PATTERN = /^(\/[A-Za-z0-9_.-]+)+$/;

/** Resolves a JSON-pointer-style path against the environment root. */
export function resolvePath(env: ConditionEnv, path: string): unknown {
  if (typeof path !== "string" || !PATH_PATTERN.test(path)) {
    throw new ConditionEvaluationError(`invalid predicate path: ${JSON.stringify(path)}`);
  }
  const segments = path.slice(1).split("/");
  let current: unknown = { nodes: env.nodes, context: env.context };
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isScalar(v: unknown): v is Scalar {
  return (
    v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function scalarEquals(a: unknown, b: Scalar): boolean {
  if (!isScalar(a)) return false;
  return a === b;
}

/**
 * Evaluates a governed predicate tree. Throws ConditionEvaluationError on any
 * unknown operator or malformed node (fail-closed — never a silent true).
 */
export function evaluatePredicate(predicate: unknown, env: ConditionEnv): boolean {
  if (predicate === null || typeof predicate !== "object" || Array.isArray(predicate)) {
    throw new ConditionEvaluationError("predicate must be an object with exactly one operator");
  }
  const keys = Object.keys(predicate);
  if (keys.length !== 1) {
    throw new ConditionEvaluationError(
      `predicate must carry exactly one operator, got [${keys.join(", ")}]`
    );
  }
  const op = keys[0];
  const arg = (predicate as Record<string, unknown>)[op];

  switch (op) {
    case "all": {
      if (!Array.isArray(arg) || arg.length < 1) {
        throw new ConditionEvaluationError("'all' requires a non-empty predicate array");
      }
      return arg.every((p) => evaluatePredicate(p, env));
    }
    case "any": {
      if (!Array.isArray(arg) || arg.length < 1) {
        throw new ConditionEvaluationError("'any' requires a non-empty predicate array");
      }
      return arg.some((p) => evaluatePredicate(p, env));
    }
    case "not":
      return !evaluatePredicate(arg, env);
    case "exists": {
      if (typeof arg !== "string") {
        throw new ConditionEvaluationError("'exists' requires a path string");
      }
      return resolvePath(env, arg) !== undefined;
    }
    case "eq":
    case "ne": {
      const { path, value } = requireComparison(op, arg);
      if (!isScalar(value)) {
        throw new ConditionEvaluationError(`'${op}' operand must be a scalar`);
      }
      const resolved = resolvePath(env, path);
      const equal = scalarEquals(resolved, value);
      return op === "eq" ? equal : !equal;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const { path, value } = requireComparison(op, arg);
      if (typeof value !== "number") {
        throw new ConditionEvaluationError(`'${op}' operand must be a number`);
      }
      const resolved = resolvePath(env, path);
      if (typeof resolved !== "number" || Number.isNaN(resolved)) return false;
      switch (op) {
        case "gt":
          return resolved > value;
        case "gte":
          return resolved >= value;
        case "lt":
          return resolved < value;
        default:
          return resolved <= value;
      }
    }
    case "in": {
      if (
        arg === null ||
        typeof arg !== "object" ||
        typeof (arg as Record<string, unknown>).path !== "string" ||
        !Array.isArray((arg as Record<string, unknown>).values)
      ) {
        throw new ConditionEvaluationError("'in' requires { path, values[] }");
      }
      const { path, values } = arg as { path: string; values: unknown[] };
      if (values.length < 1 || !values.every(isScalar)) {
        throw new ConditionEvaluationError("'in' values must be a non-empty scalar array");
      }
      const resolved = resolvePath(env, path);
      return values.some((v) => scalarEquals(resolved, v as Scalar));
    }
    default:
      throw new ConditionEvaluationError(`unknown predicate operator '${op}'`);
  }
}

function requireComparison(op: string, arg: unknown): { path: string; value: unknown } {
  if (
    arg === null ||
    typeof arg !== "object" ||
    typeof (arg as Record<string, unknown>).path !== "string" ||
    !("value" in (arg as Record<string, unknown>))
  ) {
    throw new ConditionEvaluationError(`'${op}' requires { path, value }`);
  }
  return arg as { path: string; value: unknown };
}
