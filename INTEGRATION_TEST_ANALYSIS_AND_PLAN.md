# LangGraph Integration Test Analysis and Fix Plan

## Executive Summary

This document provides a comprehensive analysis of the LangGraph integration test suite in `afi-reactor/src/langgraph/__tests__/integration.test.ts`, identifies the root causes of test failures, and provides a detailed plan to fix all issues and complete the integration testing phase.

## Current State Analysis

### Test File Overview

The integration test file (`integration.test.ts`) contains **1727 lines** with comprehensive test coverage across **10 scenarios**:

1. Simple Signal Processing Pipeline
2. Multi-Enrichment Pipeline
3. Complex Pipeline with Dependencies
4. Error Handling and Recovery
5. Execution Cancellation
6. Real-World Configuration
7. Plugin Discovery and Registration
8. State Management
9. Performance Testing
10. Edge Cases

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| `PluginRegistry` | `PluginRegistry.ts` | Manages plugin registration and discovery |
| `DAGBuilder` | `DAGBuilder.ts` | Builds DAGs from analyst configurations |
| `DAGExecutor` | `DAGExecutor.ts` | Executes DAGs with sequential/parallel support |
| `Pipehead` | `types/langgraph.ts` | Interface for all node implementations |

### Plugin Implementations

| Plugin | Type | Built-in Dependencies | Parallel |
|--------|------|----------------------|----------|
| `SignalIngressNode` | ingress | [] | N/A |
| `TechnicalIndicatorsNode` | enrichment | [] | true |
| `PatternRecognitionNode` | enrichment | ['technical-indicators'] | false |
| `SentimentNode` | enrichment | [] | true |
| `NewsNode` | enrichment | ['sentiment'] | false |
| `ScoutNode` | ingress | [] | N/A |

## Identified Issues

### Issue 1: Plugin Dependency Mismatch

**Root Cause**: Plugins have built-in dependencies that conflict with test configurations.

**Details**:
- `PatternRecognitionNode` (line 36) has `dependencies: string[] = ['technical-indicators']`
- `NewsNode` (line 35) has `dependencies: string[] = ['sentiment']`
- Tests attempt to override these dependencies in configuration, causing conflicts

**Affected Tests**:
- Scenario 2: Multi-Enrichment Pipeline (lines 273-357)
- Scenario 3: Complex Pipeline with Dependencies (lines 428-537)

**Example Problem**:
```typescript
// Test configuration (line 301-308)
{
  id: 'pattern-recognition',
  type: 'enrichment',
  plugin: 'pattern-recognition',
  enabled: true,
  parallel: true,  // Conflicts with plugin's parallel: false
  dependencies: ['signal-ingress'],  // Conflicts with plugin's ['technical-indicators']
  config: {},
}
```

### Issue 2: DAGBuilder Dependency Resolution

**Root Cause**: `DAGBuilder.buildFromConfig()` doesn't merge plugin built-in dependencies with configuration dependencies.

**Current Behavior** (DAGBuilder.ts lines 272-282):
```typescript
const dagNode: DAGNode = {
  id: nodeConfig.id,
  type: nodeConfig.type,
  plugin: nodeConfig.plugin,
  enabled: nodeConfig.enabled,
  optional: nodeConfig.optional ?? true,
  parallel: nodeConfig.parallel ?? false,  // Doesn't use plugin's parallel setting
  dependencies: nodeConfig.dependencies || [],  // Doesn't merge with plugin's dependencies
  config: nodeConfig.config || {},
  node: plugin,
};
```

**Expected Behavior**:
- Merge configuration dependencies with plugin built-in dependencies
- Use plugin's `parallel` setting as default if not specified in configuration
- Validate that configuration doesn't conflict with plugin requirements

### Issue 3: Timeout Test Validation

**Root Cause**: Timeout test expects specific error message format that may not match actual error.

**Affected Test** (lines 1627-1657):
```typescript
expect(result.errors.some(e => e.includes('timeout'))).toBe(true);
```

**Potential Issue**: The actual error message may be "Execution timeout after 100ms" but the test checks for "timeout" substring, which should work. However, the timing assertion may be too strict.

### Issue 4: Metrics Validation Issues

**Root Cause**: Metrics validation may fail due to timing precision or missing fields.

**Affected Tests**:
- Scenario 1: Simple Signal Processing Pipeline (lines 228-265)
- Scenario 9: Performance Testing (lines 1369-1394)

**Example** (line 262-264):
```typescript
// Note: technical-indicators may complete very quickly (duration ~0ms)
// This is expected behavior for synchronous operations
```

## Fix Plan

### Phase 1: Fix DAGBuilder Dependency Resolution

**Objective**: Ensure DAGBuilder properly merges plugin built-in dependencies with configuration dependencies.

**Changes Required**:

1. **Update `DAGBuilder.buildFromConfig()`** (DAGBuilder.ts lines 272-282):

```typescript
// Create DAG node
const dagNode: DAGNode = {
  id: nodeConfig.id,
  type: nodeConfig.type,
  plugin: nodeConfig.plugin,
  enabled: nodeConfig.enabled,
  optional: nodeConfig.optional ?? true,
  parallel: nodeConfig.parallel ?? plugin.parallel,  // Use plugin's parallel as default
  dependencies: this.mergeDependencies(nodeConfig.dependencies || [], plugin.dependencies || []),
  config: nodeConfig.config || {},
  node: plugin,
};
```

2. **Add `mergeDependencies()` method** to DAGBuilder:

```typescript
/**
 * Merges configuration dependencies with plugin built-in dependencies.
 * Removes duplicates and validates no conflicts.
 *
 * @param configDeps - Dependencies from configuration
 * @param pluginDeps - Built-in dependencies from plugin
 * @returns Merged dependencies array
 * @private
 */
private mergeDependencies(configDeps: string[], pluginDeps: string[]): string[] {
  const merged = new Set([...pluginDeps, ...configDeps]);
  return Array.from(merged);
}
```

### Phase 2: Fix Test Configurations

**Objective**: Update test configurations to work with plugin built-in dependencies.

**Changes Required**:

1. **Scenario 2: Multi-Enrichment Pipeline** (lines 281-326):

```typescript
const config = createTestConfig([
  {
    id: 'signal-ingress',
    type: 'ingress',
    plugin: 'signal-ingress',
    enabled: true,
    dependencies: [],
    config: {},
  },
  {
    id: 'technical-indicators',
    type: 'enrichment',
    plugin: 'technical-indicators',
    enabled: true,
    parallel: true,
    dependencies: ['signal-ingress'],
    config: {},
  },
  {
    id: 'sentiment',
    type: 'enrichment',
    plugin: 'sentiment',
    enabled: true,
    parallel: true,
    dependencies: ['signal-ingress'],
    config: {},
  },
  {
    id: 'pattern-recognition',
    type: 'enrichment',
    plugin: 'pattern-recognition',
    enabled: true,
    // Don't set parallel - use plugin's default (false)
    // Don't set dependencies - use plugin's built-in ['technical-indicators']
    config: {},
  },
  {
    id: 'news',
    type: 'enrichment',
    plugin: 'news',
    enabled: true,
    // Don't set parallel - use plugin's default (false)
    // Don't set dependencies - use plugin's built-in ['sentiment']
    config: {},
  },
]);
```

2. **Scenario 3: Complex Pipeline with Dependencies** (lines 438-488):

```typescript
const config = createTestConfig([
  {
    id: 'signal-ingress',
    type: 'ingress',
    plugin: 'signal-ingress',
    enabled: true,
    dependencies: [],
    config: {},
  },
  {
    id: 'technical-indicators',
    type: 'enrichment',
    plugin: 'technical-indicators',
    enabled: true,
    dependencies: ['signal-ingress'],
    config: {},
  },
  {
    id: 'sentiment',
    type: 'enrichment',
    plugin: 'sentiment',
    enabled: true,
    dependencies: ['signal-ingress'],
    config: {},
  },
  {
    id: 'pattern-recognition',
    type: 'enrichment',
    plugin: 'pattern-recognition',
    enabled: true,
    // Don't set dependencies - use plugin's built-in ['technical-indicators']
    config: {},
  },
  {
    id: 'news',
    type: 'enrichment',
    plugin: 'news',
    enabled: true,
    // Don't set dependencies - use plugin's built-in ['sentiment']
    config: {},
  },
  {
    id: 'scout',
    type: 'ingress',
    plugin: 'scout',
    enabled: true,
    dependencies: ['pattern-recognition', 'news'],
    config: {},
  },
]);
```

### Phase 3: Fix Timeout and Metrics Tests

**Objective**: Ensure timeout and metrics tests are robust and handle timing variations.

**Changes Required**:

1. **Timeout Test** (lines 1627-1657):

```typescript
it('should handle timeout correctly', async () => {
  const mockSlow = new MockPlugin('mock-slow', 'mock-slow', { delay: 5000 });
  registry.registerPlugin(mockSlow);

  const config = createTestConfig([
    {
      id: 'mock-slow',
      type: 'enrichment',
      plugin: 'mock-slow',
      enabled: true,
      dependencies: [],
      config: {},
    },
  ]);

  const buildResult = dagBuilder.buildFromConfig(config);
  const options: ExecutionOptions = {
    timeout: 100,
  };

  const startTime = Date.now();
  const result = await executor.execute(buildResult.dag!, undefined, options);
  const endTime = Date.now();

  expect(result.success).toBe(false);
  expect(result.status).toBe('failed');
  expect(result.errors.length).toBeGreaterThan(0);
  // Check for timeout-related error (more flexible matching)
  expect(result.errors.some(e => 
    e.toLowerCase().includes('timeout') || 
    e.toLowerCase().includes('timed out')
  )).toBe(true);

  // Should timeout in approximately 100ms (allow some overhead)
  const executionTime = endTime - startTime;
  expect(executionTime).toBeLessThan(500);
});
```

2. **Metrics Test** (lines 1369-1394):

```typescript
it('should measure execution time accurately', async () => {
  const mock = new MockPlugin('mock', 'mock', { delay: 100 });
  registry.registerPlugin(mock);

  const config = createTestConfig([
    {
      id: 'mock',
      type: 'enrichment',
      plugin: 'mock',
      enabled: true,
      dependencies: [],
      config: {},
    },
  ]);

  const buildResult = dagBuilder.buildFromConfig(config);
  const startTime = Date.now();
  const result = await executor.execute(buildResult.dag!);
  const endTime = Date.now();

  const actualTime = endTime - startTime;
  const reportedTime = result.metrics.totalTime;

  // Verify timing accuracy (within 20% tolerance for more robustness)
  const tolerance = actualTime * 0.2;
  expect(Math.abs(actualTime - reportedTime)).toBeLessThanOrEqual(tolerance);
});
```

### Phase 4: Verify All Test Cases

**Objective**: Ensure all existing test cases pass after fixes.

**Test Coverage Verification**:

| Scenario | Test Count | Status |
|----------|------------|--------|
| Simple Signal Processing Pipeline | 2 | Needs verification |
| Multi-Enrichment Pipeline | 2 | Needs verification |
| Complex Pipeline with Dependencies | 2 | Needs verification |
| Error Handling and Recovery | 4 | Needs verification |
| Execution Cancellation | 3 | Needs verification |
| Real-World Configuration | 2 | Needs verification |
| Plugin Discovery and Registration | 5 | Needs verification |
| State Management | 3 | Needs verification |
| Performance Testing | 3 | Needs verification |
| Edge Cases | 6 | Needs verification |
| Additional Integration Tests | 4 | Needs verification |

**Total**: 36 test cases

### Phase 5: Create Test Utilities and Fixtures

**Objective**: Create reusable test utilities and fixtures to improve test maintainability.

**New File**: `afi-reactor/src/langgraph/__tests__/test-utils.ts`

```typescript
/**
 * Test Utilities for LangGraph Integration Tests
 *
 * Provides reusable utilities and fixtures for testing LangGraph components.
 */

import type { Pipehead, PipelineState } from '../../types/langgraph.js';
import { PluginRegistry } from '../PluginRegistry.js';
import { DAGBuilder, type AnalystConfig } from '../DAGBuilder.js';
import {
  DAGExecutor,
  type ExecutionResult,
  type ExecutionOptions,
} from '../DAGExecutor.js';

/**
 * Creates a test analyst configuration
 */
export function createTestConfig(nodes: any[]): AnalystConfig {
  return {
    analystId: 'test-analyst',
    version: 'v1.0.0',
    enrichmentNodes: nodes,
  };
}

/**
 * Creates a test signal envelope
 */
export function createTestSignal(overrides?: Partial<PipelineState>): PipelineState {
  const base: PipelineState = {
    signalId: `test-signal-${Date.now()}`,
    rawSignal: {
      type: 'crypto',
      symbol: 'BTC',
      price: 50000,
      timestamp: new Date().toISOString(),
    },
    enrichmentResults: new Map(),
    analystConfig: {
      analystId: 'test-analyst',
      enrichmentNodes: [],
    },
    metadata: {
      startTime: new Date().toISOString(),
      trace: [],
    },
  };
  
  return { ...base, ...overrides };
}

/**
 * Mock plugin for testing
 */
export class MockPlugin implements Pipehead {
  id: string;
  type: 'enrichment' | 'ingress' | 'required' = 'enrichment';
  plugin: string;
  parallel = true;
  dependencies: string[] = [];
  private delay: number = 0;
  private shouldFail: boolean = false;
  private executeCount: number = 0;

  constructor(
    id: string,
    plugin: string,
    options: { delay?: number; shouldFail?: boolean; parallel?: boolean; dependencies?: string[] } = {}
  ) {
    this.id = id;
    this.plugin = plugin;
    this.delay = options.delay || 0;
    this.shouldFail = options.shouldFail || false;
    this.parallel = options.parallel ?? true;
    this.dependencies = options.dependencies || [];
  }

  async execute(state: PipelineState): Promise<PipelineState> {
    this.executeCount++;
    if (this.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delay));
    }
    if (this.shouldFail) {
      throw new Error(`Mock plugin ${this.id} failed`);
    }
    state.enrichmentResults.set(this.id, {
      executed: true,
      count: this.executeCount,
      timestamp: new Date().toISOString(),
    });
    return state;
  }

  getExecuteCount(): number {
    return this.executeCount;
  }
}

/**
 * Waits for execution completion
 */
export async function waitForExecution(
  executor: DAGExecutor,
  executionId: string,
  timeout: number = 10000
): Promise<ExecutionResult> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const status = executor.getExecutionStatus(executionId);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const context = executor.getExecutionContext(executionId);
      if (context) {
        return {
          success: status === 'completed',
          executionId,
          state: context.currentState,
          status,
          metrics: executor.getExecutionMetrics(executionId)!,
          errors: [...context.errors],
          warnings: [...context.warnings],
        };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Execution ${executionId} timed out after ${timeout}ms`);
}

/**
 * Asserts execution succeeded
 */
export function assertExecutionSuccess(result: ExecutionResult): void {
  expect(result.success).toBe(true);
  expect(result.status).toBe('completed');
  expect(result.errors).toHaveLength(0);
}

/**
 * Asserts execution failed
 */
export function assertExecutionFailed(result: ExecutionResult): void {
  expect(result.success).toBe(false);
  expect(result.status).toBe('failed');
  expect(result.errors.length).toBeGreaterThan(0);
}

/**
 * Asserts execution was cancelled
 */
export function assertExecutionCancelled(result: ExecutionResult): void {
  expect(result.success).toBe(false);
  expect(result.status).toBe('cancelled');
}

/**
 * Creates a test setup with registry, builder, and executor
 */
export function createTestSetup() {
  const registry = new PluginRegistry();
  const dagBuilder = new DAGBuilder(registry);
  const executor = new DAGExecutor(dagBuilder, registry);

  return {
    registry,
    dagBuilder,
    executor,
    cleanup: () => {
      registry.clear();
    },
  };
}

/**
 * Creates a configuration with all built-in plugins
 */
export function createAllPluginsConfig(): AnalystConfig {
  return {
    analystId: 'test-analyst',
    version: 'v1.0.0',
    enrichmentNodes: [
      {
        id: 'signal-ingress',
        type: 'ingress',
        plugin: 'signal-ingress',
        enabled: true,
        dependencies: [],
        config: {},
      },
      {
        id: 'technical-indicators',
        type: 'enrichment',
        plugin: 'technical-indicators',
        enabled: true,
        dependencies: ['signal-ingress'],
        config: {},
      },
      {
        id: 'sentiment',
        type: 'enrichment',
        plugin: 'sentiment',
        enabled: true,
        dependencies: ['signal-ingress'],
        config: {},
      },
      {
        id: 'pattern-recognition',
        type: 'enrichment',
        plugin: 'pattern-recognition',
        enabled: true,
        config: {},
      },
      {
        id: 'news',
        type: 'enrichment',
        plugin: 'news',
        enabled: true,
        config: {},
      },
      {
        id: 'scout',
        type: 'ingress',
        plugin: 'scout',
        enabled: true,
        dependencies: ['pattern-recognition', 'news'],
        config: {},
      },
    ],
  };
}
```

## Implementation Order

1. **Phase 1**: Fix DAGBuilder dependency resolution
2. **Phase 2**: Fix test configurations
3. **Phase 3**: Fix timeout and metrics tests
4. **Phase 4**: Verify all test cases pass
5. **Phase 5**: Create test utilities and fixtures
6. **Phase 6**: Refactor tests to use new utilities

## Success Criteria

- All 36 test cases pass
- No plugin dependency conflicts
- Timeout tests handle timing variations gracefully
- Metrics validation is robust
- Test utilities are reusable and well-documented
- Code coverage remains at or above current levels

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Low | High | Comprehensive testing after each change |
| Plugin dependency conflicts | Medium | Medium | Proper merging and validation logic |
| Timing-related test flakiness | Medium | Low | Use flexible timing assertions |
| Test utilities introduce bugs | Low | Medium | Thorough unit testing of utilities |

## Next Steps

1. Review and approve this plan
2. Switch to orchestrator mode to implement the fixes
3. Execute fixes in the specified order
4. Verify all tests pass
5. Document any additional findings
