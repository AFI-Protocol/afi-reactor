/**
 * State Management Integration Tests
 *
 * Tests for state lifecycle, serialization, and integration between
 * StateManager, StateValidator, and StateSerializer.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { StateManager } from '../../src/state/StateManager.js';
import { StateValidator } from '../../src/state/StateValidator.js';
import { StateSerializer } from '../../src/state/StateSerializer.js';
import type { PipelineState, ExecutionTraceEntry } from '../../src/types/pipeline.js';
import { promises as fs } from 'fs';
import { join } from 'path';

// Helper function to create a test state
function createTestState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    signalId: 'test-signal-123',
    rawSignal: { type: 'test', data: 'test-data' },
    enrichmentResults: new Map<string, unknown>(),
    analystConfig: {
      analystId: 'test-analyst',
      enrichmentNodes: [
        { id: 'node1', type: 'enrichment', plugin: 'plugin1', enabled: true },
        { id: 'node2', type: 'ingress', plugin: 'plugin2', enabled: true },
      ],
    },
    currentNode: undefined,
    metadata: {
      startTime: new Date().toISOString(),
      currentNodeStartTime: undefined,
      trace: [],
    },
    ...overrides,
  };
}

// Helper function to create a test trace entry
function createTestTraceEntry(overrides?: Partial<ExecutionTraceEntry>): ExecutionTraceEntry {
  return {
    nodeId: 'test-node',
    nodeType: 'enrichment',
    startTime: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('State Lifecycle Integration', () => {
  let stateManager: StateManager;
  let validator: StateValidator;
  let serializer: StateSerializer;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    const initialState = createTestState();
    stateManager = new StateManager(initialState);
    validator = new StateValidator();
    serializer = new StateSerializer();

    // Create temporary directory for file tests
    testDir = join(process.cwd(), 'test-temp-integration');
    testFile = join(testDir, 'state.json');
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFile);
      await fs.rmdir(testDir);
    } catch {
      // Cleanup may fail if directory doesn't exist
    }
  });

  describe('State Creation and Validation', () => {
    it('should create valid initial state', () => {
      const state = stateManager.getState();
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate state after updates', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const state = stateManager.getState();
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
    });

    it('should detect invalid state after corrupt update', async () => {
      await stateManager.updateState(state => {
        (state as any).signalId = '';
        return state;
      });

      const state = stateManager.getState();
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('State Update and History', () => {
    it('should maintain valid state through multiple updates', async () => {
      // Perform multiple updates
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => {
        state.enrichmentResults.set('node1', { result: 'success' });
        return state;
      });

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      // Validate final state
      const state = stateManager.getState();
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(state.currentNode).toBe('node2');
      expect(state.enrichmentResults.get('node1')).toEqual({ result: 'success' });
    });

    it('should maintain valid history through updates', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const history = stateManager.getStateHistory();

      expect(history.length).toBe(3);
      history.forEach(state => {
        const result = validator.validate(state);
        expect(result.valid).toBe(true);
      });
    });

    it('should rollback to valid previous state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => {
        (state as any).signalId = ''; // Corrupt state
        return state;
      });

      // Rollback to previous valid state
      const rolledBack = stateManager.rollbackState();
      const state = stateManager.getState();
      const result = validator.validate(state);

      expect(rolledBack).toBe(true);
      expect(result.valid).toBe(true);
      expect(state.currentNode).toBe('node1');
    });
  });

  describe('Trace Entry Lifecycle', () => {
    it('should maintain valid state through trace entry lifecycle', async () => {
      // Add pending entry
      const pendingEntry = createTestTraceEntry({
        nodeId: 'node1',
        status: 'pending',
      });
      stateManager.addTraceEntry(pendingEntry);

      let state = stateManager.getState();
      let result = validator.validate(state);
      expect(result.valid).toBe(true);

      // Update to running
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node1');
        if (entry) {
          entry.status = 'running';
        }
        return state;
      });

      state = stateManager.getState();
      result = validator.validate(state);
      expect(result.valid).toBe(true);

      // Update to completed
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node1');
        if (entry) {
          entry.status = 'completed';
          entry.endTime = new Date().toISOString();
          entry.duration = 100;
        }
        return state;
      });

      state = stateManager.getState();
      result = validator.validate(state);
      expect(result.valid).toBe(true);
    });

    it('should calculate correct metrics from trace', async () => {
      const entry1 = createTestTraceEntry({
        nodeId: 'node1',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 100,
      });
      const entry2 = createTestTraceEntry({
        nodeId: 'node2',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 200,
      });
      const entry3 = createTestTraceEntry({
        nodeId: 'node3',
        status: 'failed',
        endTime: new Date().toISOString(),
        duration: 50,
      });

      stateManager.addTraceEntry(entry1);
      stateManager.addTraceEntry(entry2);
      stateManager.addTraceEntry(entry3);

      const metrics = stateManager.getExecutionMetrics();

      expect(metrics.totalTime).toBe(350);
      expect(metrics.nodesExecuted).toBe(2);
      expect(metrics.nodesFailed).toBe(1);
    });
  });

  describe('Serialization and Deserialization', () => {
    it('should serialize and deserialize valid state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      stateManager.addTraceEntry(createTestTraceEntry({
        nodeId: 'node1',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 100,
      }));

      const originalState = stateManager.getState();
      const json = serializer.serialize(originalState);
      const deserializedState = serializer.deserialize(json);

      // Validate deserialized state
      const result = validator.validate(deserializedState);
      expect(result.valid).toBe(true);

      // Verify content
      expect(deserializedState.signalId).toBe(originalState.signalId);
      expect(deserializedState.currentNode).toBe(originalState.currentNode);
      expect(deserializedState.metadata.trace.length).toBe(1);
    });

    it('should serialize and deserialize state with Map', async () => {
      await stateManager.updateState(state => {
        state.enrichmentResults.set('node1', { result: 'success' });
        state.enrichmentResults.set('node2', { result: 'failure' });
        return state;
      });

      const originalState = stateManager.getState();
      const json = serializer.serialize(originalState);
      const deserializedState = serializer.deserialize(json);

      // Verify Map is properly deserialized
      expect(deserializedState.enrichmentResults).toBeInstanceOf(Map);
      expect(deserializedState.enrichmentResults.get('node1')).toEqual({ result: 'success' });
      expect(deserializedState.enrichmentResults.get('node2')).toEqual({ result: 'failure' });
    });

    it('should serialize and deserialize state history', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const history = stateManager.getStateHistory();
      const json = serializer.serializeMany(history);
      const deserializedHistory = serializer.deserializeMany(json);

      expect(deserializedHistory.length).toBe(3);
      deserializedHistory.forEach(state => {
        const result = validator.validate(state);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('File I/O Integration', () => {
    it('should serialize state to file and deserialize back', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      stateManager.addTraceEntry(createTestTraceEntry({
        nodeId: 'node1',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 100,
      }));

      const originalState = stateManager.getState();

      // Serialize to file
      await serializer.serializeToFile(originalState, testFile);

      // Deserialize from file
      const deserializedState = await serializer.deserializeFromFile(testFile);

      // Validate
      const result = validator.validate(deserializedState);
      expect(result.valid).toBe(true);
      expect(deserializedState.signalId).toBe(originalState.signalId);
    });

    it('should serialize state history to file and deserialize back', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const history = stateManager.getStateHistory();

      // Serialize to file
      await serializer.serializeManyToFile(history, testFile);

      // Deserialize from file
      const deserializedHistory = await serializer.deserializeManyFromFile(testFile);

      expect(deserializedHistory.length).toBe(3);
      deserializedHistory.forEach(state => {
        const result = validator.validate(state);
        expect(result.valid).toBe(true);
      });
    });

    it('should handle file errors gracefully', async () => {
      const invalidPath = '/invalid/path/state.json';

      await expect(
        serializer.serializeToFile(stateManager.getState(), invalidPath)
      ).rejects.toThrow();

      await expect(
        serializer.deserializeFromFile(invalidPath)
      ).rejects.toThrow('File not found');
    });
  });

  describe('Checkpoint and Rollback Integration', () => {
    it('should create checkpoint and rollback to it', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const checkpointIndex = stateManager.createCheckpoint();

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node3',
      }));

      // Rollback to checkpoint
      const rolledBack = stateManager.rollbackToCheckpoint(checkpointIndex);
      const state = stateManager.getState();

      expect(rolledBack).toBe(true);
      expect(state.currentNode).toBe('node1');
      expect(stateManager.getHistorySize()).toBe(checkpointIndex + 1);
    });

    it('should serialize checkpoint state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const checkpointIndex = stateManager.createCheckpoint();
      const history = stateManager.getStateHistory();
      const checkpointState = history[checkpointIndex];

      // Serialize checkpoint state
      const json = serializer.serialize(checkpointState);
      const deserializedState = serializer.deserialize(json);

      const result = validator.validate(deserializedState);
      expect(result.valid).toBe(true);
      expect(deserializedState.currentNode).toBe('node1');
    });
  });

  describe('Complex State Lifecycle', () => {
    it('should handle complete DAG execution lifecycle', async () => {
      // Initial state
      let state = stateManager.getState();
      expect(validator.validate(state).valid).toBe(true);

      // Node 1: pending
      const node1Entry = createTestTraceEntry({
        nodeId: 'node1',
        nodeType: 'enrichment',
        status: 'pending',
      });
      stateManager.addTraceEntry(node1Entry);

      // Node 1: running
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node1');
        if (entry) {
          entry.status = 'running';
        }
        state.currentNode = 'node1';
        return state;
      });

      // Node 1: completed
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node1');
        if (entry) {
          entry.status = 'completed';
          entry.endTime = new Date().toISOString();
          entry.duration = 100;
        }
        state.enrichmentResults.set('node1', { result: 'success' });
        state.currentNode = undefined;
        return state;
      });

      // Node 2: pending
      const node2Entry = createTestTraceEntry({
        nodeId: 'node2',
        nodeType: 'enrichment',
        status: 'pending',
      });
      stateManager.addTraceEntry(node2Entry);

      // Node 2: running
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node2');
        if (entry) {
          entry.status = 'running';
        }
        state.currentNode = 'node2';
        return state;
      });

      // Node 2: failed
      await stateManager.updateState(state => {
        const trace = state.metadata.trace;
        const entry = trace.find(e => e.nodeId === 'node2');
        if (entry) {
          entry.status = 'failed';
          entry.endTime = new Date().toISOString();
          entry.duration = 50;
          entry.error = 'Test error';
        }
        state.currentNode = undefined;
        return state;
      });

      // Validate final state
      state = stateManager.getState();
      const result = validator.validate(state);
      expect(result.valid).toBe(true);

      // Check metrics
      const metrics = stateManager.getExecutionMetrics();
      expect(metrics.totalTime).toBe(150);
      expect(metrics.nodesExecuted).toBe(1);
      expect(metrics.nodesFailed).toBe(1);

      // Verify enrichment results
      expect(state.enrichmentResults.get('node1')).toEqual({ result: 'success' });
      expect(state.enrichmentResults.has('node2')).toBe(false);
    });

    it('should handle state recovery after failure', async () => {
      // Create a valid state
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      // Serialize to file
      await serializer.serializeToFile(stateManager.getState(), testFile);

      // Simulate failure by creating new state manager
      const recoveredState = await serializer.deserializeFromFile(testFile);
      const recoveredManager = new StateManager(recoveredState);

      // Verify recovered state is valid
      const state = recoveredManager.getState();
      const result = validator.validate(state);
      expect(result.valid).toBe(true);
      expect(state.currentNode).toBe('node1');

      // Continue execution
      await recoveredManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const finalState = recoveredManager.getState();
      const finalResult = validator.validate(finalState);
      expect(finalResult.valid).toBe(true);
      expect(finalState.currentNode).toBe('node2');
    });
  });

  describe('State Cloning', () => {
    it('should clone state using serializer', async () => {
      await stateManager.updateState(state => {
        state.enrichmentResults.set('node1', { result: 'success' });
        return state;
      });

      const originalState = stateManager.getState();
      const clonedState = serializer.clone(originalState);

      // Verify clone is valid
      const result = validator.validate(clonedState);
      expect(result.valid).toBe(true);

      // Verify clone is independent
      clonedState.enrichmentResults.set('node2', { result: 'failure' });
      expect(originalState.enrichmentResults.has('node2')).toBe(false);
      expect(clonedState.enrichmentResults.has('node2')).toBe(true);
    });

    it('should clone state history', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const originalHistory = stateManager.getStateHistory();
      const clonedHistory = originalHistory.map(state => serializer.clone(state));

      expect(clonedHistory.length).toBe(3);
      clonedHistory.forEach(state => {
        const result = validator.validate(state);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('History Management', () => {
    it('should respect max history size', async () => {
      stateManager.setMaxHistorySize(5);

      // Create more than 5 history entries
      for (let i = 0; i < 10; i++) {
        await stateManager.updateState(state => ({
          ...state,
          currentNode: `node${i}`,
        }));
      }

      expect(stateManager.getHistorySize()).toBe(5);
    });

    it('should clear history while maintaining current state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      stateManager.clearHistory();

      expect(stateManager.getHistorySize()).toBe(1);
      const state = stateManager.getState();
      expect(state.currentNode).toBe('node2');
    });

    it('should reset state to initial state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      stateManager.resetState();

      const state = stateManager.getState();
      expect(state.currentNode).toBeUndefined();
      expect(stateManager.getHistorySize()).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      expect(() => serializer.deserialize('invalid json')).toThrow('Invalid JSON');
    });

    it('should handle missing required fields in JSON', () => {
      const invalidJson = JSON.stringify({ signalId: 'test' });
      expect(() => serializer.deserialize(invalidJson)).toThrow('Missing required field');
    });

    it('should handle file not found error', async () => {
      await expect(
        serializer.deserializeFromFile('/nonexistent/file.json')
      ).rejects.toThrow('File not found');
    });

    it('should handle updater function errors', async () => {
      await expect(
        stateManager.updateState(() => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });
});
