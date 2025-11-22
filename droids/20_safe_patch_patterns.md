# AFI Reactor - Safe Patch Patterns

How to make safe, reviewable changes to the DAG orchestrator.

---

## Pattern 1: Stateless DAG Nodes

**Good** ✅:
```typescript
// Node is stateless - no instance variables
export class ProcessingNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    const processed = this.process(input);
    return processed;
  }
  
  private process(input: Signal): Signal {
    // Pure function - no side effects
    return { ...input, processed: true };
  }
}
```

**Bad** ❌:
```typescript
// Node has state - violates Doctrine
export class ProcessingNode implements DAGNode {
  private cache = new Map();  // State!
  
  async execute(input: Signal): Promise<Signal> {
    this.cache.set(input.id, input);  // Side effect!
    return input;
  }
}
```

**Why**: Stateless nodes are composable and testable (Doctrine Commandment #3).

---

## Pattern 2: Single Responsibility Nodes

**Good** ✅:
```typescript
// Node does ONE thing
export class SentimentAnalysisNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    const sentiment = analyzeSentiment(input.text);
    return { ...input, sentiment };
  }
}
```

**Bad** ❌:
```typescript
// Node does MANY things
export class ProcessingNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    const sentiment = analyzeSentiment(input.text);
    const entities = extractEntities(input.text);
    const summary = summarize(input.text);
    const keywords = extractKeywords(input.text);
    // Too much! Split into separate nodes
    return { ...input, sentiment, entities, summary, keywords };
  }
}
```

**Why**: Single responsibility makes nodes reusable (Doctrine Commandment #4).

---

## Pattern 3: Preserve DAG Determinism

**Good** ✅:
```typescript
// Deterministic - same input = same output
export class ScoreNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    const score = calculateScore(input.confidence, input.sentiment);
    return { ...input, score };
  }
}
```

**Bad** ❌:
```typescript
// Non-deterministic - uses random/time
export class ScoreNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    const randomBoost = Math.random();  // Non-deterministic!
    const score = input.confidence + randomBoost;
    return { ...input, score };
  }
}
```

**Why**: Determinism enables Codex replay (Doctrine Commandment #6).

---

## Pattern 4: Additive DAG Changes

**Good** ✅:
```typescript
// Add new node without changing existing ones
export const dagConfig = {
  nodes: [
    ...existingNodes,
    { name: 'new-node', class: NewNode },  // Additive
  ],
};
```

**Bad** ❌:
```typescript
// Removing or reordering nodes breaks replay
export const dagConfig = {
  nodes: [
    { name: 'node-2', class: Node2 },  // Removed node-1!
    { name: 'node-1', class: Node1 },  // Reordered!
  ],
};
```

**Why**: Additive changes preserve backward compatibility.

---

## Pattern 5: Test DAG Nodes in Isolation

**Good** ✅:
```typescript
// Test node independently
describe('SentimentNode', () => {
  it('should analyze sentiment', async () => {
    const node = new SentimentNode();
    const input = { text: 'Great news!' };
    const output = await node.execute(input);
    expect(output.sentiment).toBe('positive');
  });
});
```

**Why**: Isolated tests are fast and reliable.

---

## Pattern 6: Document DAG Changes

**Good** ✅:
```markdown
## DAG Change: Added SentimentAnalysisNode

### Position
Inserted between TextExtractionNode and ScoringNode

### Purpose
Analyze sentiment of signal text for improved scoring

### Impact
- Adds `sentiment` field to Signal
- Increases pipeline latency by ~50ms
- No breaking changes (field is optional)

### Diagram
[Before] -> [After] (include visual)
```

**Why**: DAG changes affect entire pipeline—documentation is critical.

---

## Pattern 7: Fail Fast in Nodes

**Good** ✅:
```typescript
export class ValidationNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    if (!input.text) {
      throw new Error('Signal missing required field: text');
    }
    if (input.confidence < 0 || input.confidence > 1) {
      throw new Error(`Invalid confidence: ${input.confidence}`);
    }
    return input;
  }
}
```

**Why**: Early failures prevent bad data from propagating.

---

## Pattern 8: Use Codex for Replay Testing

**Good** ✅:
```bash
# Test DAG changes with historical signals
npm run codex:replay --from 2024-01-01 --to 2024-01-31

# Verify outputs match expected
npm run codex:verify
```

**Why**: Codex replay ensures changes don't break existing behavior.

---

## Pattern 9: Respect Orchestrator Doctrine

**Good** ✅:
```typescript
// afi-reactor is the ONLY orchestrator
// Agents are nodes, not orchestrators
export class AgentNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    // Agent processes signal, doesn't orchestrate
    return processSignal(input);
  }
}
```

**Bad** ❌:
```typescript
// Making agent an orchestrator violates Doctrine
export class AgentNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    // Agent orchestrates other agents - WRONG!
    const result1 = await agent1.process(input);
    const result2 = await agent2.process(result1);
    return result2;
  }
}
```

**Why**: Violating Doctrine breaks the entire architecture.

---

## Pattern 10: Version DAG Configs

**Good** ✅:
```typescript
// config/dag.v2.config.ts
export const dagConfigV2 = {
  version: '2.0.0',
  nodes: [
    // ... nodes
  ],
};
```

**Why**: Versioning enables rollback and A/B testing.

---

## Checklist Before Submitting

- [ ] Read AFI_ORCHESTRATOR_DOCTRINE.md
- [ ] DAG nodes are stateless
- [ ] Single responsibility per node
- [ ] Tests added for new nodes
- [ ] Tests pass locally (`npm test`)
- [ ] Codex replay tested
- [ ] DAG diagram updated (if structure changed)
- [ ] No breaking changes (or documented)
- [ ] Follows existing patterns

---

**Last Updated**: 2025-11-22

