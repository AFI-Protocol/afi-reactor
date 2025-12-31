/**
 * State Management Unit Tests
 *
 * Tests for StateManager, StateValidator, and StateSerializer.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { StateManager } from '../src/state/StateManager.js';
import { StateValidator } from '../src/state/StateValidator.js';
import { StateSerializer } from '../src/state/StateSerializer.js';
import type { PipelineState, ExecutionTraceEntry } from '../src/types/pipeline.js';
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

describe('StateManager', () => {
  let stateManager: StateManager;
  let initialState: PipelineState;

  beforeEach(() => {
    initialState = createTestState();
    stateManager = new StateManager(initialState);
  });

  describe('constructor', () => {
    it('should create a StateManager with initial state', () => {
      const state = stateManager.getState();
      expect(state.signalId).toBe('test-signal-123');
      expect(state.rawSignal).toEqual({ type: 'test', data: 'test-data' });
    });

    it('should initialize state history with initial state', () => {
      const history = stateManager.getStateHistory();
      expect(history.length).toBe(1);
      expect(history[0].signalId).toBe('test-signal-123');
    });

    it('should use default max history size', () => {
      expect(stateManager.getMaxHistorySize()).toBe(100);
    });

    it('should use custom max history size', () => {
      const customManager = new StateManager(initialState, 50);
      expect(customManager.getMaxHistorySize()).toBe(50);
    });
  });

  describe('getState', () => {
    it('should return a deep clone of the state', () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it('should return state with Map properly cloned', () => {
      const state = stateManager.getState();
      state.enrichmentResults.set('test-key', 'test-value');

      const state2 = stateManager.getState();
      expect(state2.enrichmentResults.has('test-key')).toBe(false);
    });
  });

  describe('updateState', () => {
    it('should update state using updater function', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const state = stateManager.getState();
      expect(state.currentNode).toBe('node1');
    });

    it('should add updated state to history', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const history = stateManager.getStateHistory();
      expect(history.length).toBe(2);
      expect(history[1].currentNode).toBe('node1');
    });

    it('should handle Map updates correctly', async () => {
      await stateManager.updateState(state => {
        state.enrichmentResults.set('node1', { result: 'success' });
        return state;
      });

      const state = stateManager.getState();
      expect(state.enrichmentResults.get('node1')).toEqual({ result: 'success' });
    });

    it('should throw error if updater function throws', async () => {
      await expect(
        stateManager.updateState(() => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('getStateHistory', () => {
    it('should return array of state snapshots', () => {
      const history = stateManager.getStateHistory();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should return deep clones of history states', () => {
      const history = stateManager.getStateHistory();
      history[0].signalId = 'modified';

      const history2 = stateManager.getStateHistory();
      expect(history2[0].signalId).toBe('test-signal-123');
    });
  });

  describe('addTraceEntry', () => {
    it('should add trace entry to state metadata', () => {
      const entry = createTestTraceEntry();
      stateManager.addTraceEntry(entry);

      const trace = stateManager.getTraceEntries();
      expect(trace.length).toBe(1);
      expect(trace[0].nodeId).toBe('test-node');
    });

    it('should add multiple trace entries', () => {
      const entry1 = createTestTraceEntry({ nodeId: 'node1' });
      const entry2 = createTestTraceEntry({ nodeId: 'node2' });

      stateManager.addTraceEntry(entry1);
      stateManager.addTraceEntry(entry2);

      const trace = stateManager.getTraceEntries();
      expect(trace.length).toBe(2);
    });
  });

  describe('getTraceEntries', () => {
    it('should return array of trace entries', () => {
      const entry = createTestTraceEntry();
      stateManager.addTraceEntry(entry);

      const trace = stateManager.getTraceEntries();
      expect(Array.isArray(trace)).toBe(true);
      expect(trace.length).toBe(1);
    });

    it('should return empty array when no entries', () => {
      const trace = stateManager.getTraceEntries();
      expect(trace).toEqual([]);
    });
  });

  describe('getExecutionMetrics', () => {
    it('should return zero metrics for empty trace', () => {
      const metrics = stateManager.getExecutionMetrics();
      expect(metrics.totalTime).toBe(0);
      expect(metrics.nodesExecuted).toBe(0);
      expect(metrics.nodesFailed).toBe(0);
    });

    it('should calculate metrics from trace entries', () => {
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

    it('should ignore entries without duration', () => {
      const entry1 = createTestTraceEntry({
        nodeId: 'node1',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 100,
      });
      const entry2 = createTestTraceEntry({
        nodeId: 'node2',
        status: 'running',
      });

      stateManager.addTraceEntry(entry1);
      stateManager.addTraceEntry(entry2);

      const metrics = stateManager.getExecutionMetrics();
      expect(metrics.totalTime).toBe(100);
    });
  });

  describe('resetState', () => {
    it('should reset state to initial state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      stateManager.resetState();

      const state = stateManager.getState();
      expect(state.currentNode).toBeUndefined();
    });

    it('should clear history except initial state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      stateManager.resetState();

      const history = stateManager.getStateHistory();
      expect(history.length).toBe(1);
    });
  });

  describe('rollbackState', () => {
    it('should rollback to previous state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const rolledBack = stateManager.rollbackState();
      const state = stateManager.getState();

      expect(rolledBack).toBe(true);
      expect(state.currentNode).toBeUndefined();
    });

    it('should return false when no previous state exists', () => {
      const rolledBack = stateManager.rollbackState();
      expect(rolledBack).toBe(false);
    });

    it('should remove current state from history', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      stateManager.rollbackState();

      const history = stateManager.getStateHistory();
      expect(history.length).toBe(1);
    });
  });

  describe('getHistorySize', () => {
    it('should return current history size', () => {
      expect(stateManager.getHistorySize()).toBe(1);
    });

    it('should update after state updates', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      expect(stateManager.getHistorySize()).toBe(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear history keeping only current state', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      stateManager.clearHistory();

      const history = stateManager.getStateHistory();
      expect(history.length).toBe(1);
      expect(history[0].currentNode).toBe('node2');
    });
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint in history', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));

      const index = stateManager.createCheckpoint();

      expect(index).toBe(2);
      expect(stateManager.getHistorySize()).toBe(3);
    });
  });

  describe('rollbackToCheckpoint', () => {
    it('should rollback to specific checkpoint', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));
      const checkpointIndex = stateManager.createCheckpoint();
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      const rolledBack = stateManager.rollbackToCheckpoint(checkpointIndex);
      const state = stateManager.getState();

      expect(rolledBack).toBe(true);
      expect(state.currentNode).toBe('node1');
    });

    it('should return false for invalid index', () => {
      const rolledBack = stateManager.rollbackToCheckpoint(999);
      expect(rolledBack).toBe(false);
    });

    it('should truncate history to checkpoint', async () => {
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node1',
      }));
      const checkpointIndex = stateManager.createCheckpoint();
      await stateManager.updateState(state => ({
        ...state,
        currentNode: 'node2',
      }));

      stateManager.rollbackToCheckpoint(checkpointIndex);

      expect(stateManager.getHistorySize()).toBe(checkpointIndex + 1);
    });
  });

  describe('setMaxHistorySize', () => {
    it('should set max history size', () => {
      stateManager.setMaxHistorySize(50);
      expect(stateManager.getMaxHistorySize()).toBe(50);
    });

    it('should trim history if exceeding new size', async () => {
      // Create more than 10 history entries
      for (let i = 0; i < 15; i++) {
        await stateManager.updateState(state => ({
          ...state,
          currentNode: `node${i}`,
        }));
      }

      stateManager.setMaxHistorySize(10);

      expect(stateManager.getHistorySize()).toBe(10);
    });
  });
});

describe('StateValidator', () => {
  let validator: StateValidator;

  beforeEach(() => {
    validator = new StateValidator();
  });

  describe('validate', () => {
    it('should validate a valid state', () => {
      const state = createTestState();
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('should return errors for null state', () => {
      const result = validator.validate(null as unknown as PipelineState);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('State is null or undefined');
    });

    it('should return errors for undefined state', () => {
      const result = validator.validate(undefined as unknown as PipelineState);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('State is null or undefined');
    });

    it('should return errors for missing signalId', () => {
      const state = createTestState({ signalId: '' as unknown as string });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('signalId'))).toBe(true);
    });

    it('should return errors for empty signalId', () => {
      const state = createTestState({ signalId: '' });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      // Empty string is caught by required fields check
      expect(result.errors.some(e => e.includes('signalId'))).toBe(true);
    });

    it('should return warnings for long signalId', () => {
      const longId = 'a'.repeat(300);
      const state = createTestState({ signalId: longId });
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('exceeds recommended length'))).toBe(true);
    });

    it('should return errors for non-string signalId', () => {
      const state = createTestState({ signalId: 123 as unknown as string });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('signalId must be a string');
    });

    it('should return errors for missing enrichmentResults', () => {
      const state = createTestState();
      delete (state as any).enrichmentResults;
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: enrichmentResults');
    });

    it('should return errors for non-Map enrichmentResults', () => {
      const state = createTestState({
        enrichmentResults: {} as unknown as Map<string, unknown>,
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('enrichmentResults must be a Map');
    });

    it('should return errors for empty enrichmentResults key', () => {
      const state = createTestState();
      state.enrichmentResults.set('', 'value');
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('enrichmentResults contains empty key');
    });

    it('should return warnings for large enrichmentResults', () => {
      const state = createTestState();
      for (let i = 0; i < 1001; i++) {
        state.enrichmentResults.set(`node${i}`, `value${i}`);
      }
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('more than 1000 entries'))).toBe(true);
    });

    it('should return errors for missing analystConfig', () => {
      const state = createTestState();
      delete (state as any).analystConfig;
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: analystConfig');
    });

    it('should return errors for missing analystId', () => {
      const state = createTestState({
        analystConfig: { analystId: '', enrichmentNodes: [] },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('analystConfig missing required field: analystId');
    });

    it('should return errors for invalid node type', () => {
      const state = createTestState({
        analystConfig: {
          analystId: 'test',
          enrichmentNodes: [
            { id: 'node1', type: 'invalid' as any, plugin: 'plugin1', enabled: true },
          ],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be \'enrichment\' or \'ingress\''))).toBe(true);
    });

    it('should return errors for missing metadata', () => {
      const state = createTestState();
      delete (state as any).metadata;
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: metadata');
    });

    it('should return errors for invalid ISO 8601 timestamp', () => {
      const state = createTestState({
        metadata: {
          startTime: 'invalid-timestamp',
          currentNodeStartTime: undefined,
          trace: [],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('metadata.startTime must be a valid ISO 8601 timestamp');
    });

    it('should return errors for invalid trace entry status', () => {
      const state = createTestState({
        metadata: {
          startTime: new Date().toISOString(),
          currentNodeStartTime: undefined,
          trace: [
            {
              nodeId: 'node1',
              nodeType: 'enrichment',
              startTime: new Date().toISOString(),
              status: 'invalid' as any,
            },
          ],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be \'pending\', \'running\', \'completed\', or \'failed\''))).toBe(true);
    });

    it('should return warnings for completed entry without endTime', () => {
      const state = createTestState({
        metadata: {
          startTime: new Date().toISOString(),
          currentNodeStartTime: undefined,
          trace: [
            {
              nodeId: 'node1',
              nodeType: 'enrichment',
              startTime: new Date().toISOString(),
              status: 'completed',
            },
          ],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('missing endTime'))).toBe(true);
    });

    it('should return errors for running entry with endTime', () => {
      const state = createTestState({
        metadata: {
          startTime: new Date().toISOString(),
          currentNodeStartTime: undefined,
          trace: [
            {
              nodeId: 'node1',
              nodeType: 'enrichment',
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              status: 'running',
            },
          ],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('has status \'running\' but has endTime'))).toBe(true);
    });

    it('should return errors for out-of-order trace entries', () => {
      const now = new Date();
      const state = createTestState({
        metadata: {
          startTime: now.toISOString(),
          currentNodeStartTime: undefined,
          trace: [
            {
              nodeId: 'node1',
              nodeType: 'enrichment',
              startTime: now.toISOString(),
              status: 'completed',
            },
            {
              nodeId: 'node2',
              nodeType: 'enrichment',
              startTime: new Date(now.getTime() - 1000).toISOString(),
              status: 'completed',
            },
          ],
        },
      });
      const result = validator.validate(state);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be in chronological order'))).toBe(true);
    });
  });

  describe('checkInvariants', () => {
    it('should return true for valid state with no warnings', () => {
      const state = createTestState();
      const result = validator.checkInvariants(state);

      expect(result).toBe(true);
    });

    it('should return false for state with errors', () => {
      const state = createTestState({ signalId: '' });
      const result = validator.checkInvariants(state);

      expect(result).toBe(false);
    });

    it('should return false for state with warnings', () => {
      const state = createTestState({
        metadata: {
          startTime: new Date().toISOString(),
          currentNodeStartTime: undefined,
          trace: [
            {
              nodeId: 'node1',
              nodeType: 'enrichment',
              startTime: new Date().toISOString(),
              status: 'completed',
            },
          ],
        },
      });
      const result = validator.checkInvariants(state);

      expect(result).toBe(false);
    });
  });
});

describe('StateSerializer', () => {
  let serializer: StateSerializer;
  let testState: PipelineState;

  beforeEach(() => {
    serializer = new StateSerializer();
    testState = createTestState();
  });

  describe('serialize', () => {
    it('should serialize state to JSON string', () => {
      const json = serializer.serialize(testState);

      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all required fields', () => {
      const json = serializer.serialize(testState);
      const parsed = JSON.parse(json);

      expect(parsed.signalId).toBe('test-signal-123');
      expect(parsed.rawSignal).toEqual({ type: 'test', data: 'test-data' });
      expect(Array.isArray(parsed.enrichmentResults)).toBe(true);
      expect(parsed.analystConfig).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });

    it('should convert Map to array', () => {
      testState.enrichmentResults.set('node1', { result: 'success' });
      testState.enrichmentResults.set('node2', { result: 'failure' });

      const json = serializer.serialize(testState);
      const parsed = JSON.parse(json);

      expect(parsed.enrichmentResults).toEqual([
        ['node1', { result: 'success' }],
        ['node2', { result: 'failure' }],
      ]);
    });

    it('should throw error for invalid state', () => {
      expect(() => serializer.serialize(null as unknown as PipelineState)).toThrow();
    });
  });

  describe('deserialize', () => {
    it('should deserialize JSON string to state', () => {
      const json = serializer.serialize(testState);
      const state = serializer.deserialize(json);

      expect(state.signalId).toBe('test-signal-123');
      expect(state.rawSignal).toEqual({ type: 'test', data: 'test-data' });
    });

    it('should convert array back to Map', () => {
      testState.enrichmentResults.set('node1', { result: 'success' });
      const json = serializer.serialize(testState);
      const state = serializer.deserialize(json);

      expect(state.enrichmentResults).toBeInstanceOf(Map);
      expect(state.enrichmentResults.get('node1')).toEqual({ result: 'success' });
    });

    it('should throw error for invalid JSON', () => {
      expect(() => serializer.deserialize('invalid json')).toThrow('Invalid JSON');
    });

    it('should throw error for missing required fields', () => {
      const json = JSON.stringify({ signalId: 'test' });
      expect(() => serializer.deserialize(json)).toThrow('Missing required field');
    });
  });

  describe('serialize/deserialize roundtrip', () => {
    it('should preserve state through roundtrip', () => {
      testState.enrichmentResults.set('node1', { result: 'success' });
      testState.enrichmentResults.set('node2', { result: 'failure' });
      testState.currentNode = 'node1';

      const json = serializer.serialize(testState);
      const deserialized = serializer.deserialize(json);

      expect(deserialized.signalId).toBe(testState.signalId);
      expect(deserialized.rawSignal).toEqual(testState.rawSignal);
      expect(deserialized.currentNode).toBe(testState.currentNode);
      expect(deserialized.enrichmentResults.get('node1')).toEqual({ result: 'success' });
      expect(deserialized.enrichmentResults.get('node2')).toEqual({ result: 'failure' });
    });

    it('should preserve trace entries', () => {
      const entry = createTestTraceEntry({
        nodeId: 'node1',
        status: 'completed',
        endTime: new Date().toISOString(),
        duration: 100,
      });
      testState.metadata.trace.push(entry);

      const json = serializer.serialize(testState);
      const deserialized = serializer.deserialize(json);

      expect(deserialized.metadata.trace.length).toBe(1);
      expect(deserialized.metadata.trace[0].nodeId).toBe('node1');
      expect(deserialized.metadata.trace[0].status).toBe('completed');
    });
  });

  describe('serializeToFile', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const testFile = join(testDir, 'state.json');

    beforeEach(async () => {
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

    it('should serialize state to file', async () => {
      await serializer.serializeToFile(testState, testFile);

      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should write valid JSON to file', async () => {
      await serializer.serializeToFile(testState, testFile);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should throw error for invalid file path', async () => {
      await expect(
        serializer.serializeToFile(testState, '/invalid/path/state.json')
      ).rejects.toThrow();
    });
  });

  describe('deserializeFromFile', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const testFile = join(testDir, 'state.json');

    beforeEach(async () => {
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

    it('should deserialize state from file', async () => {
      await serializer.serializeToFile(testState, testFile);
      const state = await serializer.deserializeFromFile(testFile);

      expect(state.signalId).toBe('test-signal-123');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        serializer.deserializeFromFile('/nonexistent/file.json')
      ).rejects.toThrow('File not found');
    });

    it('should throw error for invalid JSON file', async () => {
      await fs.writeFile(testFile, 'invalid json', 'utf-8');

      await expect(serializer.deserializeFromFile(testFile)).rejects.toThrow('Invalid JSON');
    });
  });

  describe('validateSerialized', () => {
    it('should return true for valid serialized state', () => {
      const json = serializer.serialize(testState);
      const serialized = JSON.parse(json);

      expect(serializer.validateSerialized(serialized)).toBe(true);
    });

    it('should return false for null', () => {
      expect(serializer.validateSerialized(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(serializer.validateSerialized('string')).toBe(false);
      expect(serializer.validateSerialized(123)).toBe(false);
      expect(serializer.validateSerialized([])).toBe(false);
    });

    it('should return false for missing required fields', () => {
      expect(serializer.validateSerialized({})).toBe(false);
      expect(serializer.validateSerialized({ signalId: 'test' })).toBe(false);
    });
  });

  describe('clone', () => {
    it('should create a deep clone of state', () => {
      testState.enrichmentResults.set('node1', { result: 'success' });

      const cloned = serializer.clone(testState);

      expect(cloned).toEqual(testState);
      expect(cloned).not.toBe(testState);
      expect(cloned.enrichmentResults).not.toBe(testState.enrichmentResults);
    });

    it('should create independent clone', () => {
      testState.enrichmentResults.set('node1', { result: 'success' });

      const cloned = serializer.clone(testState);
      cloned.enrichmentResults.set('node2', { result: 'failure' });

      expect(testState.enrichmentResults.has('node2')).toBe(false);
      expect(cloned.enrichmentResults.has('node2')).toBe(true);
    });
  });

  describe('serializeMany', () => {
    it('should serialize multiple states', () => {
      const states = [
        createTestState({ signalId: 'state1' }),
        createTestState({ signalId: 'state2' }),
        createTestState({ signalId: 'state3' }),
      ];

      const json = serializer.serializeMany(states);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0].signalId).toBe('state1');
      expect(parsed[1].signalId).toBe('state2');
      expect(parsed[2].signalId).toBe('state3');
    });

    it('should throw error for invalid states', () => {
      expect(() => serializer.serializeMany([null as unknown as PipelineState])).toThrow();
    });
  });

  describe('deserializeMany', () => {
    it('should deserialize multiple states', () => {
      const states = [
        createTestState({ signalId: 'state1' }),
        createTestState({ signalId: 'state2' }),
      ];

      const json = serializer.serializeMany(states);
      const deserialized = serializer.deserializeMany(json);

      expect(deserialized.length).toBe(2);
      expect(deserialized[0].signalId).toBe('state1');
      expect(deserialized[1].signalId).toBe('state2');
    });

    it('should throw error for invalid JSON', () => {
      expect(() => serializer.deserializeMany('invalid json')).toThrow('Invalid JSON');
    });

    it('should throw error for non-array JSON', () => {
      expect(() => serializer.deserializeMany('{}')).toThrow('Expected JSON array');
    });
  });

  describe('serializeManyToFile', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const testFile = join(testDir, 'states.json');

    beforeEach(async () => {
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

    it('should serialize multiple states to file', async () => {
      const states = [
        createTestState({ signalId: 'state1' }),
        createTestState({ signalId: 'state2' }),
      ];

      await serializer.serializeManyToFile(states, testFile);

      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('deserializeManyFromFile', () => {
    const testDir = join(process.cwd(), 'test-temp');
    const testFile = join(testDir, 'states.json');

    beforeEach(async () => {
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

    it('should deserialize multiple states from file', async () => {
      const states = [
        createTestState({ signalId: 'state1' }),
        createTestState({ signalId: 'state2' }),
      ];

      await serializer.serializeManyToFile(states, testFile);
      const deserialized = await serializer.deserializeManyFromFile(testFile);

      expect(deserialized.length).toBe(2);
      expect(deserialized[0].signalId).toBe('state1');
      expect(deserialized[1].signalId).toBe('state2');
    });
  });
});
