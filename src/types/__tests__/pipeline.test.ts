/**
 * Type tests for afi-reactor/src/types/pipeline.ts
 *
 * These tests verify that TypeScript interfaces are correctly defined
 * and that type guards work as expected.
 *
 * This file uses type assertions to verify type compatibility
 * without requiring a test framework.
 */

import type {
  Pipehead,
  PipelineState,
  ExecutionTraceEntry,
  DAGConfig,
  DAGBuildResult,
  DAGExecutionResult,
  NodeExecutionContext,
  ParallelExecutionOptions,
  DAGValidationResult,
} from '../pipeline';
import {
  isPipehead,
  isPipelineState,
  isExecutionTraceEntry,
} from '../pipeline';

// Note: AnalystConfig and EnrichmentNodeConfig are imported from afi-factory/schemas
// For type testing purposes, we define minimal types here to avoid cross-repo import issues
interface AnalystConfig {
  analystId: string;
  enrichmentNodes: EnrichmentNodeConfig[];
}

interface EnrichmentNodeConfig {
  id: string;
  type: 'enrichment' | 'ingress';
  plugin: string;
  enabled: boolean;
}

// ============================================================================
// ExecutionTraceEntry Type Tests
// ============================================================================

const validExecutionTraceEntry: ExecutionTraceEntry = {
  nodeId: 'price-enricher',
  nodeType: 'enrichment',
  startTime: '2024-12-26T10:00:00Z',
  endTime: '2024-12-26T10:00:05Z',
  duration: 5000,
  status: 'completed',
};

const failedExecutionTraceEntry: ExecutionTraceEntry = {
  nodeId: 'sentiment-analyzer',
  nodeType: 'enrichment',
  startTime: '2024-12-26T10:00:10Z',
  endTime: '2024-12-26T10:00:15Z',
  duration: 5000,
  status: 'failed',
  error: 'API timeout',
};

const pendingExecutionTraceEntry: ExecutionTraceEntry = {
  nodeId: 'onchain-tracker',
  nodeType: 'ingress',
  startTime: '2024-12-26T10:00:20Z',
  status: 'pending',
};

// ============================================================================
// PipelineState Type Tests
// ============================================================================

const validPipelineState: PipelineState = {
  signalId: 'signal-123',
  rawSignal: { price: 50000, timestamp: 1703587200000 },
  enrichmentResults: new Map([
    ['price-enricher', { price: 50000, volume: 1000 }],
    ['sentiment-analyzer', { sentiment: 'bullish', confidence: 0.8 }],
  ]),
  analystConfig: {
    analystId: 'crypto-analyst',
    enrichmentNodes: [
      {
        id: 'price-enricher',
        type: 'enrichment',
        plugin: 'afi-price-enricher',
        enabled: true,
      },
    ],
  },
  currentNode: 'sentiment-analyzer',
  metadata: {
    startTime: '2024-12-26T10:00:00Z',
    currentNodeStartTime: '2024-12-26T10:00:10Z',
    trace: [validExecutionTraceEntry, failedExecutionTraceEntry],
  },
};

const minimalPipelineState: PipelineState = {
  signalId: 'signal-456',
  rawSignal: { price: 45000 },
  enrichmentResults: new Map(),
  analystConfig: {
    analystId: 'equity-trader',
    enrichmentNodes: [],
  },
  metadata: {
    startTime: '2024-12-26T11:00:00Z',
    trace: [],
  },
};

// ============================================================================
// Pipehead Type Tests
// ============================================================================

const validPipehead: Pipehead = {
  id: 'price-enricher',
  type: 'enrichment',
  plugin: 'afi-price-enricher',
  execute: async (state: PipelineState) => {
    return state;
  },
  parallel: true,
  dependencies: [],
};

const requiredPipehead: Pipehead = {
  id: 'analyst',
  type: 'required',
  plugin: 'analyst',
  execute: async (state: PipelineState) => {
    return state;
  },
  parallel: false,
  dependencies: [],
};

// ============================================================================
// DAGConfig Type Tests
// ============================================================================

const validDAGConfig: DAGConfig = {
  requiredNodes: ['analyst', 'execution', 'observer'],
  enrichmentNodes: new Map([
    ['price-enricher', {
      id: 'price-enricher',
      type: 'enrichment',
      plugin: 'afi-price-enricher',
      enabled: true,
    }],
    ['sentiment-analyzer', {
      id: 'sentiment-analyzer',
      type: 'enrichment',
      plugin: 'afi-sentiment-plugin',
      enabled: true,
      optional: true,
    }],
  ]),
  edges: new Map([
    ['analyst', ['price-enricher', 'sentiment-analyzer']],
    ['price-enricher', ['sentiment-analyzer']],
    ['sentiment-analyzer', ['execution']],
    ['execution', ['observer']],
  ]),
};

// ============================================================================
// DAGBuildResult Type Tests
// ============================================================================

const successfulDAGBuildResult: DAGBuildResult = {
  success: true,
  config: validDAGConfig,
  errors: [],
  warnings: [],
};

const failedDAGBuildResult: DAGBuildResult = {
  success: false,
  errors: ['Circular dependency detected'],
  warnings: ['Optional node may fail'],
};

// ============================================================================
// DAGExecutionResult Type Tests
// ============================================================================

const successfulDAGExecutionResult: DAGExecutionResult = {
  success: true,
  state: validPipelineState,
  errors: [],
  warnings: [],
  metrics: {
    totalTime: 15000,
    nodesExecuted: 5,
    nodesFailed: 0,
  },
};

const failedDAGExecutionResult: DAGExecutionResult = {
  success: false,
  errors: ['Node execution failed'],
  warnings: ['Optional node skipped'],
  metrics: {
    totalTime: 10000,
    nodesExecuted: 3,
    nodesFailed: 1,
  },
};

// ============================================================================
// NodeExecutionContext Type Tests
// ============================================================================

const validNodeExecutionContext: NodeExecutionContext = {
  nodeId: 'price-enricher',
  nodeType: 'enrichment',
  pluginId: 'afi-price-enricher',
  startTime: 1703587200000,
  optional: false,
  parallel: true,
};

// ============================================================================
// ParallelExecutionOptions Type Tests
// ============================================================================

const validParallelExecutionOptions: ParallelExecutionOptions = {
  maxParallelNodes: 5,
  timeout: 30000,
  failFast: true,
};

const minimalParallelExecutionOptions: ParallelExecutionOptions = {};

// ============================================================================
// DAGValidationResult Type Tests
// ============================================================================

const validDAGValidationResult: DAGValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
};

const invalidDAGValidationResult: DAGValidationResult = {
  valid: false,
  errors: ['Circular dependency detected'],
  warnings: ['Optional node may fail'],
  cycles: [['node1', 'node2', 'node1']],
};

// ============================================================================
// Type Guard Tests
// ============================================================================

// Test isPipehead
const pipeheadTest1 = {
  id: 'price-enricher',
  type: 'enrichment' as const,
  plugin: 'afi-price-enricher',
  execute: async (state: PipelineState) => state,
};

if (isPipehead(pipeheadTest1)) {
  const id: string = pipeheadTest1.id;
  const type: 'required' | 'enrichment' | 'ingress' = pipeheadTest1.type;
  const plugin: string = pipeheadTest1.plugin;
  const execute: (state: PipelineState) => Promise<PipelineState> = pipeheadTest1.execute;
}

// Test isPipelineState
const pipelineStateTest1 = {
  signalId: 'signal-123',
  rawSignal: { price: 50000 },
  enrichmentResults: new Map(),
  analystConfig: {
    analystId: 'crypto-analyst',
    enrichmentNodes: [],
  },
  metadata: {
    startTime: '2024-12-26T10:00:00Z',
    trace: [],
  },
};

if (isPipelineState(pipelineStateTest1)) {
  const signalId: string = pipelineStateTest1.signalId;
  const rawSignal: unknown = pipelineStateTest1.rawSignal;
  const enrichmentResults: Map<string, unknown> = pipelineStateTest1.enrichmentResults;
  const analystConfig: AnalystConfig = pipelineStateTest1.analystConfig;
  const metadata: {
    startTime: string;
    trace: ExecutionTraceEntry[];
  } = pipelineStateTest1.metadata;
}

// Test isExecutionTraceEntry
const executionTraceEntryTest1 = {
  nodeId: 'price-enricher',
  nodeType: 'enrichment' as const,
  startTime: '2024-12-26T10:00:00Z',
  status: 'completed' as const,
};

if (isExecutionTraceEntry(executionTraceEntryTest1)) {
  const nodeId: string = executionTraceEntryTest1.nodeId;
  const nodeType: 'required' | 'enrichment' | 'ingress' = executionTraceEntryTest1.nodeType;
  const startTime: string = executionTraceEntryTest1.startTime;
  const status: 'pending' | 'running' | 'completed' | 'failed' = executionTraceEntryTest1.status;
}

// ============================================================================
// Type Compatibility Tests
// ============================================================================

// Test that ExecutionTraceEntry can be used in PipelineState
const stateWithTrace: PipelineState = {
  signalId: 'signal-123',
  rawSignal: { price: 50000 },
  enrichmentResults: new Map(),
  analystConfig: {
    analystId: 'crypto-analyst',
    enrichmentNodes: [],
  },
  metadata: {
    startTime: '2024-12-26T10:00:00Z',
    trace: [validExecutionTraceEntry, failedExecutionTraceEntry, pendingExecutionTraceEntry],
  },
};

// Test that DAGConfig can be used in DAGBuildResult
const buildResultWithConfig: DAGBuildResult = {
  success: true,
  config: validDAGConfig,
  errors: [],
  warnings: [],
};

// Test that PipelineState can be used in DAGExecutionResult
const executionResultWithState: DAGExecutionResult = {
  success: true,
  state: validPipelineState,
  errors: [],
  warnings: [],
  metrics: {
    totalTime: 15000,
    nodesExecuted: 5,
    nodesFailed: 0,
  },
};

// Test that config can be passed to functions expecting specific types
function processPipehead(pipehead: Pipehead): void {
  console.log(`Processing pipehead: ${pipehead.id}`);
}

function processState(state: PipelineState): void {
  console.log(`Processing signal: ${state.signalId}`);
}

function processTraceEntry(entry: ExecutionTraceEntry): void {
  console.log(`Node ${entry.nodeId} status: ${entry.status}`);
}

processPipehead(validPipehead);
processState(validPipelineState);
processTraceEntry(validExecutionTraceEntry);

// ============================================================================
// Export for type checking
// ============================================================================

export {
  validExecutionTraceEntry,
  failedExecutionTraceEntry,
  pendingExecutionTraceEntry,
  validPipelineState,
  minimalPipelineState,
  validPipehead,
  requiredPipehead,
  validDAGConfig,
  successfulDAGBuildResult,
  failedDAGBuildResult,
  successfulDAGExecutionResult,
  failedDAGExecutionResult,
  validNodeExecutionContext,
  validParallelExecutionOptions,
  minimalParallelExecutionOptions,
  validDAGValidationResult,
  invalidDAGValidationResult,
  stateWithTrace,
  buildResultWithConfig,
  executionResultWithState,
};
