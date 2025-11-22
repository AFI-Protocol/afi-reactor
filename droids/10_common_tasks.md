# AFI Reactor - Common Droid Tasks

Frequent tasks with step-by-step instructions.

---

## Task 1: Add a New DAG Node

**When**: You need to add a new processing step to the signal pipeline.

**⚠️ IMPORTANT**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` first.

**Steps**:

1. **Create node file**:
   ```bash
   touch src/dags/MyNewNode.ts
   ```

2. **Implement DAG node interface**:
   ```typescript
   // src/dags/MyNewNode.ts
   import { DAGNode, Signal } from '../types';
   
   export class MyNewNode implements DAGNode {
     name = 'my-new-node';
     
     async execute(input: Signal): Promise<Signal> {
       // TODO: Implement node logic
       // Node must be stateless and composable
       return input;
     }
   }
   ```

3. **Add test**:
   ```typescript
   // test/my_new_node.test.ts
   import { describe, it, expect } from 'vitest';
   import { MyNewNode } from '../src/dags/MyNewNode';
   
   describe('MyNewNode', () => {
     it('should process signal', async () => {
       const node = new MyNewNode();
       const signal = { id: '123' };
       const result = await node.execute(signal);
       expect(result).toBeDefined();
     });
   });
   ```

4. **Update DAG config**:
   ```typescript
   // config/dag.config.ts
   export const dagConfig = {
     nodes: [
       // ... existing nodes
       { name: 'my-new-node', class: MyNewNode },
     ],
   };
   ```

5. **Run tests**:
   ```bash
   npm test
   ```

**Expected time**: 1-2 hours

---

## Task 2: Update DAG Configuration

**When**: You need to change the DAG structure or node order.

**⚠️ WARNING**: This affects the entire pipeline. Test thoroughly.

**Steps**:

1. **Backup current config**:
   ```bash
   cp config/dag.config.ts config/dag.config.ts.backup
   ```

2. **Update config**:
   ```typescript
   // config/dag.config.ts
   export const dagConfig = {
     nodes: [
       { name: 'node-1', class: Node1 },
       { name: 'my-new-node', class: MyNewNode },  // Add here
       { name: 'node-2', class: Node2 },
     ],
   };
   ```

3. **Test DAG execution**:
   ```bash
   npm run dag:test
   ```

4. **Verify Codex replay**:
   ```bash
   npm run codex:replay
   ```

**Expected time**: 30-60 minutes

---

## Task 3: Add a Plugin

**When**: You need to extend DAG functionality.

**Steps**:

1. **Create plugin file**:
   ```bash
   touch plugins/myPlugin.ts
   ```

2. **Implement plugin interface**:
   ```typescript
   // plugins/myPlugin.ts
   export class MyPlugin {
     name = 'my-plugin';
     
     async initialize(): Promise<void> {
       // TODO: Plugin initialization
     }
     
     async execute(context: any): Promise<void> {
       // TODO: Plugin logic
     }
   }
   ```

3. **Register plugin**:
   ```typescript
   // plugin.config.ts
   import { MyPlugin } from './plugins/myPlugin';
   
   export const plugins = [
     new MyPlugin(),
   ];
   ```

4. **Add test**:
   ```bash
   npm test
   ```

**Expected time**: 1-2 hours

---

## Task 4: Improve DAG Performance

**When**: DAG execution is slow.

**Steps**:

1. **Profile DAG execution**:
   ```bash
   npm run dag:profile
   ```

2. **Identify bottleneck**:
   - Check node execution times
   - Look for blocking operations
   - Check for unnecessary data copies

3. **Optimize node**:
   ```typescript
   // Before (slow)
   async execute(input: Signal): Promise<Signal> {
     const data = await fetchAllData();  // Blocking
     return process(data);
   }
   
   // After (fast)
   async execute(input: Signal): Promise<Signal> {
     const data = await fetchOnlyNeeded();  // Minimal fetch
     return process(data);
   }
   ```

4. **Benchmark**:
   ```bash
   npm run dag:benchmark
   ```

**Expected time**: 2-4 hours

---

## Task 5: Add Integration Test

**When**: You need to test the entire DAG pipeline.

**Steps**:

1. **Create test file**:
   ```bash
   touch test/integration/dag_pipeline.test.ts
   ```

2. **Write integration test**:
   ```typescript
   // test/integration/dag_pipeline.test.ts
   import { describe, it, expect } from 'vitest';
   import { runDAG } from '../../src/cli/run-dag';
   
   describe('DAG Pipeline Integration', () => {
     it('should process signal through entire pipeline', async () => {
       const signal = { id: '123', data: 'test' };
       const result = await runDAG(signal);
       expect(result.processed).toBe(true);
     });
   });
   ```

3. **Run integration tests**:
   ```bash
   npm run test:integration
   ```

**Expected time**: 1-2 hours

---

## Getting Help

If stuck on any task:
1. Check `AFI_ORCHESTRATOR_DOCTRINE.md`
2. Check `AGENTS.md` for constraints
3. Look at existing DAG nodes for patterns
4. Run tests to verify changes
5. Ask human maintainer if unsure

---

**Last Updated**: 2025-11-22

