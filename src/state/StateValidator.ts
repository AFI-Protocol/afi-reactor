/**
 * AFI Reactor - State Validator
 *
 * Validates Pipeline state structure and invariants.
 * Provides comprehensive validation with error and warning reporting.
 *
 * @module afi-reactor/src/state/StateValidator
 */

import type {
  PipelineState,
  ExecutionTraceEntry,
} from '../types/pipeline.js';

/**
 * Validation result
 *
 * Contains validation status, errors, and warnings.
 */
export interface ValidationResult {
  /** Whether the state is valid (no errors) */
  valid: boolean;

  /** Validation errors (critical issues) */
  errors: string[];

  /** Validation warnings (non-critical issues) */
  warnings: string[];
}

/**
 * State Validator
 *
 * Validates Pipeline state structure and invariants.
 * Provides comprehensive validation with error and warning reporting.
 */
export class StateValidator {
  /**
   * Validates a Pipeline state.
   *
   * @param state - State to validate
   * @returns Validation result with errors and warnings
   */
  validate(state: PipelineState): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    this._validateRequiredFields(state, errors, warnings);

    // Validate signal ID
    this._validateSignalId(state, errors, warnings);

    // Validate raw signal
    this._validateRawSignal(state, errors, warnings);

    // Validate enrichment results
    this._validateEnrichmentResults(state, errors, warnings);

    // Validate analyst config
    this._validateAnalystConfig(state, errors, warnings);

    // Validate metadata
    this._validateMetadata(state, errors, warnings);

    // Validate trace entries
    this._validateTraceEntries(state, errors, warnings);

    // Validate invariants
    this._validateInvariants(state, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Checks if a state satisfies all invariants.
   *
   * @param state - State to check
   * @returns True if all invariants are satisfied
   */
  checkInvariants(state: PipelineState): boolean {
    const result = this.validate(state);
    return result.valid && result.warnings.length === 0;
  }

  /**
   * Validates required fields in the state.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateRequiredFields(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state) {
      errors.push('State is null or undefined');
      return;
    }

    if (typeof state !== 'object') {
      errors.push('State is not an object');
      return;
    }

    if (!state.signalId) {
      errors.push('Missing required field: signalId');
    }

    if (state.rawSignal === undefined) {
      errors.push('Missing required field: rawSignal');
    }

    if (!state.enrichmentResults) {
      errors.push('Missing required field: enrichmentResults');
    }

    if (!state.analystConfig) {
      errors.push('Missing required field: analystConfig');
    }

    if (!state.metadata) {
      errors.push('Missing required field: metadata');
    }
  }

  /**
   * Validates signal ID.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateSignalId(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || !state.signalId) {
      return;
    }

    if (typeof state.signalId !== 'string') {
      errors.push('signalId must be a string');
      return;
    }

    if (state.signalId.trim() === '') {
      errors.push('signalId cannot be empty');
    }

    if (state.signalId.length > 255) {
      warnings.push('signalId exceeds recommended length of 255 characters');
    }
  }

  /**
   * Validates raw signal.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateRawSignal(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || state.rawSignal === undefined) {
      return;
    }

    if (state.rawSignal === null) {
      warnings.push('rawSignal is null, expected a value');
    }
  }

  /**
   * Validates enrichment results.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateEnrichmentResults(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || !state.enrichmentResults) {
      return;
    }

    if (!(state.enrichmentResults instanceof Map)) {
      errors.push('enrichmentResults must be a Map');
      return;
    }

    // Check for empty keys
    for (const key of state.enrichmentResults.keys()) {
      if (typeof key !== 'string') {
        errors.push(`enrichmentResults key must be a string, got ${typeof key}`);
      } else if (key.trim() === '') {
        errors.push('enrichmentResults contains empty key');
      }
    }

    if (state.enrichmentResults.size > 1000) {
      warnings.push('enrichmentResults contains more than 1000 entries, consider pagination');
    }
  }

  /**
   * Validates analyst config.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateAnalystConfig(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || !state.analystConfig) {
      return;
    }

    if (typeof state.analystConfig !== 'object') {
      errors.push('analystConfig must be an object');
      return;
    }

    const config = state.analystConfig as unknown as Record<string, unknown>;

    if (!config.analystId) {
      errors.push('analystConfig missing required field: analystId');
    } else if (typeof config.analystId !== 'string') {
      errors.push('analystConfig.analystId must be a string');
    } else if (config.analystId.trim() === '') {
      errors.push('analystConfig.analystId cannot be empty');
    }

    if (!config.enrichmentNodes) {
      errors.push('analystConfig missing required field: enrichmentNodes');
    } else if (!Array.isArray(config.enrichmentNodes)) {
      errors.push('analystConfig.enrichmentNodes must be an array');
    } else {
      // Validate enrichment nodes
      for (let i = 0; i < config.enrichmentNodes.length; i++) {
        const node = config.enrichmentNodes[i] as Record<string, unknown>;
        if (!node.id) {
          errors.push(`analystConfig.enrichmentNodes[${i}] missing required field: id`);
        }
        if (!node.type) {
          errors.push(`analystConfig.enrichmentNodes[${i}] missing required field: type`);
        } else if (
          node.type !== 'enrichment' &&
          node.type !== 'ingress'
        ) {
          errors.push(
            `analystConfig.enrichmentNodes[${i}].type must be 'enrichment' or 'ingress', got '${node.type}'`
          );
        }
        if (!node.plugin) {
          errors.push(`analystConfig.enrichmentNodes[${i}] missing required field: plugin`);
        }
        if (node.enabled === undefined) {
          warnings.push(`analystConfig.enrichmentNodes[${i}] missing field: enabled`);
        }
      }
    }
  }

  /**
   * Validates metadata.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateMetadata(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || !state.metadata) {
      return;
    }

    if (typeof state.metadata !== 'object') {
      errors.push('metadata must be an object');
      return;
    }

    const metadata = state.metadata as unknown as Record<string, unknown>;

    if (!metadata.startTime) {
      errors.push('metadata missing required field: startTime');
    } else if (typeof metadata.startTime !== 'string') {
      errors.push('metadata.startTime must be a string');
    } else if (!this._isValidISO8601(metadata.startTime)) {
      errors.push('metadata.startTime must be a valid ISO 8601 timestamp');
    }

    if (metadata.currentNodeStartTime !== undefined) {
      if (typeof metadata.currentNodeStartTime !== 'string') {
        errors.push('metadata.currentNodeStartTime must be a string');
      } else if (!this._isValidISO8601(metadata.currentNodeStartTime)) {
        errors.push('metadata.currentNodeStartTime must be a valid ISO 8601 timestamp');
      }
    }

    if (!metadata.trace) {
      errors.push('metadata missing required field: trace');
    } else if (!Array.isArray(metadata.trace)) {
      errors.push('metadata.trace must be an array');
    }
  }

  /**
   * Validates trace entries.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateTraceEntries(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state || !state.metadata || !state.metadata.trace) {
      return;
    }

    const trace = state.metadata.trace;

    for (let i = 0; i < trace.length; i++) {
      const entry = trace[i] as ExecutionTraceEntry;

      if (!entry.nodeId) {
        errors.push(`metadata.trace[${i}] missing required field: nodeId`);
      } else if (typeof entry.nodeId !== 'string') {
        errors.push(`metadata.trace[${i}].nodeId must be a string`);
      }

      if (!entry.nodeType) {
        errors.push(`metadata.trace[${i}] missing required field: nodeType`);
      } else if (
        entry.nodeType !== 'required' &&
        entry.nodeType !== 'enrichment' &&
        entry.nodeType !== 'ingress'
      ) {
        errors.push(
          `metadata.trace[${i}].nodeType must be 'required', 'enrichment', or 'ingress', got '${entry.nodeType}'`
        );
      }

      if (!entry.startTime) {
        errors.push(`metadata.trace[${i}] missing required field: startTime`);
      } else if (typeof entry.startTime !== 'string') {
        errors.push(`metadata.trace[${i}].startTime must be a string`);
      } else if (!this._isValidISO8601(entry.startTime)) {
        errors.push(`metadata.trace[${i}].startTime must be a valid ISO 8601 timestamp`);
      }

      if (entry.endTime !== undefined) {
        if (typeof entry.endTime !== 'string') {
          errors.push(`metadata.trace[${i}].endTime must be a string`);
        } else if (!this._isValidISO8601(entry.endTime)) {
          errors.push(`metadata.trace[${i}].endTime must be a valid ISO 8601 timestamp`);
        }
      }

      if (entry.duration !== undefined) {
        if (typeof entry.duration !== 'number') {
          errors.push(`metadata.trace[${i}].duration must be a number`);
        } else if (entry.duration < 0) {
          errors.push(`metadata.trace[${i}].duration cannot be negative`);
        }
      }

      if (!entry.status) {
        errors.push(`metadata.trace[${i}] missing required field: status`);
      } else if (
        entry.status !== 'pending' &&
        entry.status !== 'running' &&
        entry.status !== 'completed' &&
        entry.status !== 'failed'
      ) {
        errors.push(
          `metadata.trace[${i}].status must be 'pending', 'running', 'completed', or 'failed', got '${entry.status}'`
        );
      }

      // Check consistency between endTime, duration, and status
      if (entry.status === 'completed' || entry.status === 'failed') {
        if (entry.endTime === undefined) {
          warnings.push(`metadata.trace[${i}] has status '${entry.status}' but missing endTime`);
        }
        if (entry.duration === undefined) {
          warnings.push(`metadata.trace[${i}] has status '${entry.status}' but missing duration`);
        }
      }

      if (entry.status === 'running' && entry.endTime !== undefined) {
        errors.push(`metadata.trace[${i}] has status 'running' but has endTime`);
      }

      if (entry.status === 'pending' && (entry.endTime !== undefined || entry.duration !== undefined)) {
        errors.push(`metadata.trace[${i}] has status 'pending' but has endTime or duration`);
      }
    }

    if (trace.length > 10000) {
      warnings.push('metadata.trace contains more than 10000 entries, consider archiving');
    }
  }

  /**
   * Validates state invariants.
   *
   * @param state - State to validate
   * @param errors - Array to collect errors
   * @param warnings - Array to collect warnings
   * @private
   */
  private _validateInvariants(
    state: PipelineState,
    errors: string[],
    warnings: string[]
  ): void {
    if (!state) {
      return;
    }

    // Check that trace entries are in chronological order
    if (state.metadata && state.metadata.trace && state.metadata.trace.length > 1) {
      const trace = state.metadata.trace;
      for (let i = 1; i < trace.length; i++) {
        const prevEntry = trace[i - 1] as ExecutionTraceEntry;
        const currEntry = trace[i] as ExecutionTraceEntry;

        const prevTime = new Date(prevEntry.startTime).getTime();
        const currTime = new Date(currEntry.startTime).getTime();

        if (currTime < prevTime) {
          errors.push(
            `metadata.trace[${i}] startTime is before previous entry startTime, trace entries must be in chronological order`
          );
        }
      }
    }

    // Check that currentNode is in trace if set
    if (state.currentNode && state.metadata && state.metadata.trace) {
      const currentNodeInTrace = state.metadata.trace.some(
        (entry: ExecutionTraceEntry) => entry.nodeId === state.currentNode
      );
      if (!currentNodeInTrace) {
        warnings.push(
          `currentNode '${state.currentNode}' is not found in metadata.trace`
        );
      }
    }

    // Check that enrichment results match trace entries
    if (state.enrichmentResults && state.metadata && state.metadata.trace) {
      // Only check if enrichmentResults is a Map
      if (!(state.enrichmentResults instanceof Map)) {
        return;
      }

      const traceNodeIds = new Set(
        state.metadata.trace.map((entry: ExecutionTraceEntry) => entry.nodeId)
      );
      for (const nodeId of state.enrichmentResults.keys()) {
        if (!traceNodeIds.has(nodeId)) {
          warnings.push(
            `enrichmentResults contains entry for node '${nodeId}' which is not in metadata.trace`
          );
        }
      }
    }
  }

  /**
   * Checks if a string is a valid ISO 8601 timestamp.
   *
   * @param timestamp - Timestamp to check
   * @returns True if valid ISO 8601 timestamp
   * @private
   */
  private _isValidISO8601(timestamp: string): boolean {
    try {
      const date = new Date(timestamp);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }
}
