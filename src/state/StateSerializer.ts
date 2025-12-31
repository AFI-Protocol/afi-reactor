/**
 * AFI Reactor - State Serializer
 *
 * Serializes and deserializes Pipeline state to/from JSON.
 * Handles Map serialization and file I/O operations.
 *
 * @module afi-reactor/src/state/StateSerializer
 */

import type {
  PipelineState,
  ExecutionTraceEntry,
} from '../types/pipeline';
import { promises as fs } from 'fs';

/**
 * Serialized state format
 *
 * Internal format used for JSON serialization.
 * Maps are converted to arrays of key-value pairs.
 */
interface SerializedState {
  signalId: string;
  rawSignal: unknown;
  enrichmentResults: Array<[string, unknown]>;
  analystConfig: {
    analystId: string;
    enrichmentNodes: Array<{
      id: string;
      type: 'enrichment' | 'ingress';
      plugin: string;
      enabled: boolean;
    }>;
  };
  currentNode?: string;
  metadata: {
    startTime: string;
    currentNodeStartTime?: string;
    trace: ExecutionTraceEntry[];
  };
}

/**
 * State Serializer
 *
 * Serializes and deserializes Pipeline state to/from JSON.
 * Handles Map serialization and file I/O operations.
 */
export class StateSerializer {
  /**
   * Serializes a Pipeline state to JSON string.
   * Handles Map serialization by converting to arrays.
   *
   * @param state - State to serialize
   * @returns JSON string representation of the state
   * @throws Error if serialization fails
   */
  serialize(state: PipelineState): string {
    try {
      const serialized: SerializedState = {
        signalId: state.signalId,
        rawSignal: state.rawSignal,
        enrichmentResults: Array.from(state.enrichmentResults.entries()),
        analystConfig: {
          analystId: state.analystConfig.analystId,
          enrichmentNodes: state.analystConfig.enrichmentNodes,
        },
        currentNode: state.currentNode,
        metadata: {
          startTime: state.metadata.startTime,
          currentNodeStartTime: state.metadata.currentNodeStartTime,
          trace: state.metadata.trace,
        },
      };

      return JSON.stringify(serialized, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to serialize state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deserializes a JSON string to a Pipeline state.
   * Handles Map deserialization by converting from arrays.
   *
   * @param json - JSON string to deserialize
   * @returns Deserialized Pipeline state
   * @throws Error if deserialization fails
   */
  deserialize(json: string): PipelineState {
    try {
      const serialized: SerializedState = JSON.parse(json);

      // Validate required fields
      if (!serialized.signalId) {
        throw new Error('Missing required field: signalId');
      }
      if (!serialized.enrichmentResults) {
        throw new Error('Missing required field: enrichmentResults');
      }
      if (!serialized.analystConfig) {
        throw new Error('Missing required field: analystConfig');
      }
      if (!serialized.metadata) {
        throw new Error('Missing required field: metadata');
      }

      // Convert enrichmentResults array back to Map
      const enrichmentResults = new Map<string, unknown>(serialized.enrichmentResults);

      return {
        signalId: serialized.signalId,
        rawSignal: serialized.rawSignal,
        enrichmentResults,
        analystConfig: {
          analystId: serialized.analystConfig.analystId,
          enrichmentNodes: serialized.analystConfig.enrichmentNodes,
        },
        currentNode: serialized.currentNode,
        metadata: {
          startTime: serialized.metadata.startTime,
          currentNodeStartTime: serialized.metadata.currentNodeStartTime,
          trace: serialized.metadata.trace,
        },
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw new Error(
        `Failed to deserialize state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Serializes a Pipeline state to a file.
   *
   * @param state - State to serialize
   * @param filePath - Path to the output file
   * @throws Error if file write fails
   */
  async serializeToFile(state: PipelineState, filePath: string): Promise<void> {
    try {
      const json = this.serialize(state);
      await fs.writeFile(filePath, json, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to serialize state to file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deserializes a Pipeline state from a file.
   *
   * @param filePath - Path to the input file
   * @returns Deserialized Pipeline state
   * @throws Error if file read fails
   */
  async deserializeFromFile(filePath: string): Promise<PipelineState> {
    try {
      const json = await fs.readFile(filePath, 'utf-8');
      return this.deserialize(json);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(
        `Failed to deserialize state from file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Serializes a Pipeline state to a file synchronously.
   *
   * @param state - State to serialize
   * @param filePath - Path to the output file
   * @throws Error if file write fails
   */
  serializeToFileSync(state: PipelineState, filePath: string): void {
    try {
      const json = this.serialize(state);
      // Use fs.writeFileSync from 'fs' module
      const fsSync = require('fs');
      fsSync.writeFileSync(filePath, json, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to serialize state to file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deserializes a Pipeline state from a file synchronously.
   *
   * @param filePath - Path to the input file
   * @returns Deserialized Pipeline state
   * @throws Error if file read fails
   */
  deserializeFromFileSync(filePath: string): PipelineState {
    try {
      const fsSync = require('fs');
      const json = fsSync.readFileSync(filePath, 'utf-8');
      return this.deserialize(json);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(
        `Failed to deserialize state from file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validates a serialized state object.
   *
   * @param serialized - Serialized state to validate
   * @returns True if valid, false otherwise
   */
  validateSerialized(serialized: unknown): serialized is SerializedState {
    if (typeof serialized !== 'object' || serialized === null) {
      return false;
    }

    const obj = serialized as Record<string, unknown>;

    return (
      typeof obj.signalId === 'string' &&
      Array.isArray(obj.enrichmentResults) &&
      typeof obj.analystConfig === 'object' &&
      obj.analystConfig !== null &&
      typeof obj.metadata === 'object' &&
      obj.metadata !== null
    );
  }

  /**
   * Creates a deep clone of a state using serialization.
   * This is a convenient way to clone a state without manual deep cloning.
   *
   * @param state - State to clone
   * @returns Cloned state
   * @throws Error if cloning fails
   */
  clone(state: PipelineState): PipelineState {
    const json = this.serialize(state);
    return this.deserialize(json);
  }

  /**
   * Serializes multiple states to a JSON array string.
   *
   * @param states - Array of states to serialize
   * @returns JSON array string
   * @throws Error if serialization fails
   */
  serializeMany(states: PipelineState[]): string {
    try {
      const serialized = states.map(state => {
        const s: SerializedState = {
          signalId: state.signalId,
          rawSignal: state.rawSignal,
          enrichmentResults: Array.from(state.enrichmentResults.entries()),
          analystConfig: {
            analystId: state.analystConfig.analystId,
            enrichmentNodes: state.analystConfig.enrichmentNodes,
          },
          currentNode: state.currentNode,
          metadata: {
            startTime: state.metadata.startTime,
            currentNodeStartTime: state.metadata.currentNodeStartTime,
            trace: state.metadata.trace,
          },
        };
        return s;
      });

      return JSON.stringify(serialized, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to serialize states: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deserializes a JSON array string to multiple states.
   *
   * @param json - JSON array string to deserialize
   * @returns Array of deserialized states
   * @throws Error if deserialization fails
   */
  deserializeMany(json: string): PipelineState[] {
    try {
      const serialized: SerializedState[] = JSON.parse(json);

      if (!Array.isArray(serialized)) {
        throw new Error('Expected JSON array');
      }

      return serialized.map(s => {
        const enrichmentResults = new Map<string, unknown>(s.enrichmentResults);

        return {
          signalId: s.signalId,
          rawSignal: s.rawSignal,
          enrichmentResults,
          analystConfig: {
            analystId: s.analystConfig.analystId,
            enrichmentNodes: s.analystConfig.enrichmentNodes,
          },
          currentNode: s.currentNode,
          metadata: {
            startTime: s.metadata.startTime,
            currentNodeStartTime: s.metadata.currentNodeStartTime,
            trace: s.metadata.trace,
          },
        };
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw new Error(
        `Failed to deserialize states: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Serializes multiple states to a file.
   *
   * @param states - Array of states to serialize
   * @param filePath - Path to the output file
   * @throws Error if file write fails
   */
  async serializeManyToFile(states: PipelineState[], filePath: string): Promise<void> {
    try {
      const json = this.serializeMany(states);
      await fs.writeFile(filePath, json, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to serialize states to file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deserializes multiple states from a file.
   *
   * @param filePath - Path to the input file
   * @returns Array of deserialized states
   * @throws Error if file read fails
   */
  async deserializeManyFromFile(filePath: string): Promise<PipelineState[]> {
    try {
      const json = await fs.readFile(filePath, 'utf-8');
      return this.deserializeMany(json);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw new Error(
        `Failed to deserialize states from file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
