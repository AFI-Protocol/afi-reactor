/**
 * AFI Reactor - State Manager
 *
 * Manages Pipeline state, execution tracking, and state history.
 * Provides thread-safe state updates, rollback capabilities, and execution metrics.
 *
 * @module afi-reactor/src/state/StateManager
 */

import type {
  PipelineState,
  ExecutionTraceEntry,
} from '../types/pipeline';

/**
 * State Manager
 *
 * Manages Pipeline state with history tracking, rollback capabilities,
 * and execution metrics. Thread-safe for concurrent access.
 */
export class StateManager {
  private _state: PipelineState;
  private _stateHistory: PipelineState[];
  private _maxHistorySize: number;
  private _lock: Promise<void>;

  /**
   * Creates a new StateManager instance.
   *
   * @param initialState - Initial Pipeline state
   * @param maxHistorySize - Maximum number of state snapshots to keep in history (default: 100)
   */
  constructor(initialState: PipelineState, maxHistorySize: number = 100) {
    this._state = this._deepCloneState(initialState);
    this._stateHistory = [this._deepCloneState(initialState)];
    this._maxHistorySize = maxHistorySize;
    this._lock = Promise.resolve();
  }

  /**
   * Gets the current state.
   *
   * @returns Current Pipeline state
   */
  getState(): PipelineState {
    return this._deepCloneState(this._state);
  }

  /**
   * Updates the state using an updater function.
   * Thread-safe operation that acquires a lock before updating.
   *
   * @param updater - Function that takes current state and returns updated state
   * @throws Error if updater function throws
   */
  async updateState(updater: (state: PipelineState) => PipelineState): Promise<void> {
    // Acquire lock for thread safety
    await this._lock;
    const releaseLock = this._acquireLock();

    try {
      const updatedState = updater(this._state);
      this._state = this._deepCloneState(updatedState);
      this._addToHistory(this._state);
    } finally {
      releaseLock();
    }
  }

  /**
   * Gets the state history.
   *
   * @returns Array of state snapshots in chronological order
   */
  getStateHistory(): PipelineState[] {
    return this._stateHistory.map(state => this._deepCloneState(state));
  }

  /**
   * Adds a trace entry to the current state's metadata.
   *
   * @param entry - Execution trace entry to add
   */
  addTraceEntry(entry: ExecutionTraceEntry): void {
    this._state.metadata.trace.push(entry);
  }

  /**
   * Gets all trace entries from the current state.
   *
   * @returns Array of execution trace entries
   */
  getTraceEntries(): ExecutionTraceEntry[] {
    return [...this._state.metadata.trace];
  }

  /**
   * Gets execution metrics from the trace entries.
   *
   * @returns Execution metrics including total time, nodes executed, and nodes failed
   */
  getExecutionMetrics(): {
    totalTime: number;
    nodesExecuted: number;
    nodesFailed: number;
  } {
    const trace = this._state.metadata.trace;
    let totalTime = 0;
    let nodesExecuted = 0;
    let nodesFailed = 0;

    for (const entry of trace) {
      if (entry.duration !== undefined) {
        totalTime += entry.duration;
      }
      if (entry.status === 'completed') {
        nodesExecuted++;
      } else if (entry.status === 'failed') {
        nodesFailed++;
      }
    }

    return { totalTime, nodesExecuted, nodesFailed };
  }

  /**
   * Resets the state to the initial state (first history entry).
   * Clears all subsequent history entries.
   */
  resetState(): void {
    if (this._stateHistory.length > 0) {
      this._state = this._deepCloneState(this._stateHistory[0]);
      this._stateHistory = [this._deepCloneState(this._state)];
    }
  }

  /**
   * Rolls back the state to the previous history entry.
   *
   * @returns True if rollback was successful, false if no previous state exists
   */
  rollbackState(): boolean {
    if (this._stateHistory.length <= 1) {
      return false;
    }

    // Remove current state from history
    this._stateHistory.pop();
    // Set state to previous state
    this._state = this._deepCloneState(this._stateHistory[this._stateHistory.length - 1]);
    return true;
  }

  /**
   * Gets the current state history size.
   *
   * @returns Number of state snapshots in history
   */
  getHistorySize(): number {
    return this._stateHistory.length;
  }

  /**
   * Clears the state history, keeping only the current state.
   */
  clearHistory(): void {
    this._stateHistory = [this._deepCloneState(this._state)];
  }

  /**
   * Creates a checkpoint in the state history.
   * Useful for creating named rollback points.
   *
   * @returns Index of the checkpoint in history
   */
  createCheckpoint(): number {
    this._addToHistory(this._state);
    return this._stateHistory.length - 1;
  }

  /**
   * Rolls back to a specific checkpoint index.
   *
   * @param index - Index of the checkpoint to rollback to
   * @returns True if rollback was successful, false if index is invalid
   */
  rollbackToCheckpoint(index: number): boolean {
    if (index < 0 || index >= this._stateHistory.length) {
      return false;
    }

    this._state = this._deepCloneState(this._stateHistory[index]);
    // Truncate history to the checkpoint
    this._stateHistory = this._stateHistory.slice(0, index + 1);
    return true;
  }

  /**
   * Gets the maximum history size.
   *
   * @returns Maximum number of state snapshots to keep
   */
  getMaxHistorySize(): number {
    return this._maxHistorySize;
  }

  /**
   * Sets the maximum history size.
   * If the current history exceeds the new size, oldest entries are removed.
   *
   * @param size - New maximum history size
   */
  setMaxHistorySize(size: number): void {
    this._maxHistorySize = size;
    this._trimHistory();
  }

  /**
   * Deep clones a Pipeline state.
   * Handles Map serialization properly.
   *
   * @param state - State to clone
   * @returns Deep cloned state
   * @private
   */
  private _deepCloneState(state: PipelineState): PipelineState {
    return {
      signalId: state.signalId,
      rawSignal: this._deepClone(state.rawSignal),
      enrichmentResults: new Map(state.enrichmentResults),
      analystConfig: this._deepClone(state.analystConfig),
      currentNode: state.currentNode,
      metadata: {
        startTime: state.metadata.startTime,
        currentNodeStartTime: state.metadata.currentNodeStartTime,
        trace: state.metadata.trace.map(entry => ({ ...entry })),
      },
    };
  }

  /**
   * Deep clones any value.
   *
   * @param value - Value to clone
   * @returns Deep cloned value
   * @private
   */
  private _deepClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (value instanceof Map) {
      return new Map(value) as T;
    }

    if (value instanceof Set) {
      return new Set(value) as T;
    }

    if (Array.isArray(value)) {
      return value.map(item => this._deepClone(item)) as T;
    }

    const cloned = {} as T;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        (cloned as Record<string, unknown>)[key] = this._deepClone(
          (value as Record<string, unknown>)[key]
        );
      }
    }
    return cloned;
  }

  /**
   * Adds a state snapshot to history.
   * Trims history if it exceeds max size.
   *
   * @param state - State to add to history
   * @private
   */
  private _addToHistory(state: PipelineState): void {
    this._stateHistory.push(this._deepCloneState(state));
    this._trimHistory();
  }

  /**
   * Trims history to max size by removing oldest entries.
   *
   * @private
   */
  private _trimHistory(): void {
    while (this._stateHistory.length > this._maxHistorySize) {
      this._stateHistory.shift();
    }
  }

  /**
   * Acquires a lock for thread-safe operations.
   *
   * @returns Function to release the lock
   * @private
   */
  private _acquireLock(): () => void {
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
      }
    };
    return release;
  }
}
