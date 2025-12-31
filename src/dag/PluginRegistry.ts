/**
 * AFI Reactor - Plugin Registry
 *
 * This module provides a centralized registry for managing all pipehead plugins.
 * The PluginRegistry handles:
 * - Plugin registration and discovery
 * - Plugin validation
 * - Plugin retrieval by name or type
 * - Dynamic plugin management
 *
 * @module afi-reactor/src/dag/PluginRegistry
 */

import type { Pipehead } from '../types/dag.js';
import { isPipehead } from '../types/dag.js';
import { TechnicalIndicatorsNode } from './plugins/TechnicalIndicatorsNode.js';
import { PatternRecognitionNode } from './plugins/PatternRecognitionNode.js';
import { SentimentNode } from './plugins/SentimentNode.js';
import { NewsNode } from './plugins/NewsNode.js';
import { AiMlNode } from './plugins/AiMlNode.js';
import { ScoutNode } from './plugins/ScoutNode.js';
import { SignalIngressNode } from './plugins/SignalIngressNode.js';

/**
 * Plugin type enumeration
 *
 * Defines the supported plugin types in the registry.
 */
export type PluginType = 'enrichment' | 'ingress' | 'egress';

/**
 * Plugin metadata
 *
 * Additional metadata about a registered plugin.
 */
export interface PluginMetadata {
  /** Plugin name */
  name: string;

  /** Plugin type */
  type: PluginType;

  /** Plugin version */
  version: string;

  /** Plugin description */
  description: string;

  /** Whether the plugin is enabled */
  enabled: boolean;

  /** Registration timestamp */
  registeredAt: string;
}

/**
 * Plugin registration result
 *
 * Result of registering a plugin.
 */
export interface PluginRegistrationResult {
  /** Whether registration was successful */
  success: boolean;

  /** Plugin name */
  pluginName: string;

  /** Error message if registration failed */
  error?: string;
}

/**
 * Plugin discovery result
 *
 * Result of discovering plugins from the plugins directory.
 */
export interface PluginDiscoveryResult {
  /** Number of plugins discovered */
  discovered: number;

  /** Number of plugins registered */
  registered: number;

  /** Number of plugins that failed to register */
  failed: number;

  /** Failed plugin registrations */
  failures: Array<{
    pluginName: string;
    error: string;
  }>;
}

/**
 * Plugin Registry
 *
 * Centralized registry for managing all DAG plugins.
 * Provides methods for registration, validation, discovery, and retrieval.
 */
export class PluginRegistry {
  /** Map of plugin name to plugin instance */
  private plugins: Map<string, Pipehead>;

  /** Map of plugin name to plugin metadata */
  private metadata: Map<string, PluginMetadata>;

  /** Map of plugin type to array of plugin names */
  private pluginsByType: Map<PluginType, string[]>;

  /** Whether the registry has been initialized */
  private initialized: boolean;

  /**
   * Creates a new PluginRegistry instance.
   */
  constructor() {
    this.plugins = new Map();
    this.metadata = new Map();
    this.pluginsByType = new Map();
    this.initialized = false;

    // Initialize plugin type maps
    this.pluginsByType.set('enrichment', []);
    this.pluginsByType.set('ingress', []);
    this.pluginsByType.set('egress', []);
  }

  /**
   * Initializes the registry with default plugins.
   *
   * This method registers all built-in plugins:
   * - TechnicalIndicatorsNode (enrichment)
   * - PatternRecognitionNode (enrichment)
   * - SentimentNode (enrichment)
   * - NewsNode (enrichment)
   * - AiMlNode (enrichment)
   * - ScoutNode (ingress)
   * - SignalIngressNode (ingress)
   *
   * @returns PluginDiscoveryResult - Result of plugin discovery
   */
  initialize(): PluginDiscoveryResult {
    if (this.initialized) {
      return {
        discovered: 0,
        registered: 0,
        failed: 0,
        failures: [],
      };
    }

    const result: PluginDiscoveryResult = {
      discovered: 0,
      registered: 0,
      failed: 0,
      failures: [],
    };

    // Register enrichment nodes
    const enrichmentNodes = [
      { name: 'technical-indicators', plugin: new TechnicalIndicatorsNode() },
      { name: 'pattern-recognition', plugin: new PatternRecognitionNode() },
      { name: 'sentiment', plugin: new SentimentNode() },
      { name: 'news', plugin: new NewsNode() },
      { name: 'ai-ml', plugin: new AiMlNode() },
    ];

    for (const { name, plugin } of enrichmentNodes) {
      result.discovered++;
      const registrationResult = this.registerPlugin(plugin);
      if (registrationResult.success) {
        result.registered++;
      } else {
        result.failed++;
        result.failures.push({
          pluginName: name,
          error: registrationResult.error || 'Unknown error',
        });
      }
    }

    // Register ingress nodes
    const ingressNodes = [
      { name: 'scout', plugin: new ScoutNode() },
      { name: 'signal-ingress', plugin: new SignalIngressNode() },
    ];

    for (const { name, plugin } of ingressNodes) {
      result.discovered++;
      const registrationResult = this.registerPlugin(plugin);
      if (registrationResult.success) {
        result.registered++;
      } else {
        result.failed++;
        result.failures.push({
          pluginName: name,
          error: registrationResult.error || 'Unknown error',
        });
      }
    }

    this.initialized = true;
    return result;
  }

  /**
   * Registers a plugin in the registry.
   *
   * This method:
   * 1. Validates the plugin implements Pipehead interface
   * 2. Checks if a plugin with the same name already exists
   * 3. Registers the plugin and its metadata
   * 4. Adds the plugin to the type index
   *
   * @param plugin - The plugin to register
   * @returns PluginRegistrationResult - Result of registration
   */
  registerPlugin(plugin: Pipehead): PluginRegistrationResult {
    // Validate plugin
    if (!this.validatePlugin(plugin)) {
      return {
        success: false,
        pluginName: plugin.id,
        error: 'Plugin does not implement Pipehead interface',
      };
    }

    // Check if plugin already exists
    if (this.plugins.has(plugin.id)) {
      return {
        success: false,
        pluginName: plugin.id,
        error: `Plugin with name '${plugin.id}' is already registered`,
      };
    }

    // Determine plugin type
    const pluginType = this.determinePluginType(plugin);

    // Create metadata
    const metadata: PluginMetadata = {
      name: plugin.id,
      type: pluginType,
      version: '1.0.0',
      description: `${plugin.type} node plugin`,
      enabled: true,
      registeredAt: new Date().toISOString(),
    };

    // Register plugin
    this.plugins.set(plugin.id, plugin);
    this.metadata.set(plugin.id, metadata);

    // Add to type index
    const pluginsOfType = this.pluginsByType.get(pluginType) || [];
    pluginsOfType.push(plugin.id);
    this.pluginsByType.set(pluginType, pluginsOfType);

    return {
      success: true,
      pluginName: plugin.id,
    };
  }

  /**
   * Unregisters a plugin from the registry.
   *
   * @param name - The name of the plugin to unregister
   * @returns Whether the plugin was unregistered
   */
  unregisterPlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }

    // Get plugin type
    const metadata = this.metadata.get(name);
    if (metadata) {
      // Remove from type index
      const pluginsOfType = this.pluginsByType.get(metadata.type) || [];
      const index = pluginsOfType.indexOf(name);
      if (index !== -1) {
        pluginsOfType.splice(index, 1);
        this.pluginsByType.set(metadata.type, pluginsOfType);
      }

      // Remove metadata
      this.metadata.delete(name);
    }

    // Remove plugin
    this.plugins.delete(name);

    return true;
  }

  /**
   * Gets a plugin by name.
   *
   * @param name - The name of the plugin to retrieve
   * @returns The plugin if found, undefined otherwise
   */
  getPlugin(name: string): Pipehead | undefined {
    return this.plugins.get(name);
  }

  /**
   * Gets all plugins of a specific type.
   *
   * @param type - The plugin type to filter by
   * @returns Array of plugins of the specified type
   */
  getPluginsByType(type: PluginType): Pipehead[] {
    const pluginNames = this.pluginsByType.get(type) || [];
    const plugins: Pipehead[] = [];

    for (const name of pluginNames) {
      const plugin = this.plugins.get(name);
      if (plugin) {
        plugins.push(plugin);
      }
    }

    return plugins;
  }

  /**
   * Gets all registered plugins.
   *
   * @returns Array of all registered plugins
   */
  getAllPlugins(): Pipehead[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Gets metadata for a plugin.
   *
   * @param name - The name of the plugin
   * @returns The plugin metadata if found, undefined otherwise
   */
  getPluginMetadata(name: string): PluginMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Gets all plugin metadata.
   *
   * @returns Array of all plugin metadata
   */
  getAllPluginMetadata(): PluginMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Validates that a plugin implements the Pipehead interface.
   *
   * This method checks:
   * - The plugin is an object
   * - The plugin has an id property (string)
   * - The plugin has a type property ('required', 'enrichment', or 'ingress')
   * - The plugin has a plugin property (string)
   * - The plugin has an execute property (function)
   *
   * @param plugin - The plugin to validate
   * @returns Whether the plugin is valid
   */
  validatePlugin(plugin: unknown): boolean {
    return isPipehead(plugin);
  }

  /**
   * Determines the plugin type based on the pipehead type.
   *
   * @param plugin - The plugin to determine type for
   * @returns The plugin type
   * @private
   */
  private determinePluginType(plugin: Pipehead): PluginType {
    if (plugin.type === 'enrichment') {
      return 'enrichment';
    } else if (plugin.type === 'ingress') {
      return 'ingress';
    } else {
      // For 'required' nodes, we'll treat them as enrichment for now
      // This can be adjusted if needed
      return 'enrichment';
    }
  }

  /**
   * Discovers and registers plugins from the plugins directory.
   *
   * This method is a placeholder for future implementation of dynamic
   * plugin discovery. Currently, it relies on the initialize() method
   * which manually registers all built-in plugins.
   *
   * @returns PluginDiscoveryResult - Result of plugin discovery
   */
  discoverPlugins(): PluginDiscoveryResult {
    // For now, just initialize with built-in plugins
    // In the future, this could scan the plugins directory and
    // dynamically import and register plugins
    return this.initialize();
  }

  /**
   * Checks if a plugin is registered.
   *
   * @param name - The name of the plugin
   * @returns Whether the plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Gets the number of registered plugins.
   *
   * @returns The number of registered plugins
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Gets the number of registered plugins by type.
   *
   * @param type - The plugin type
   * @returns The number of plugins of the specified type
   */
  getPluginCountByType(type: PluginType): number {
    return (this.pluginsByType.get(type) || []).length;
  }

  /**
   * Clears all registered plugins.
   *
   * This method is primarily used for testing purposes.
   */
  clear(): void {
    this.plugins.clear();
    this.metadata.clear();
    this.pluginsByType.set('enrichment', []);
    this.pluginsByType.set('ingress', []);
    this.pluginsByType.set('egress', []);
    this.initialized = false;
  }

  /**
   * Gets a list of all registered plugin names.
   *
   * @returns Array of plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Enables a plugin.
   *
   * @param name - The name of the plugin to enable
   * @returns Whether the plugin was enabled
   */
  enablePlugin(name: string): boolean {
    const metadata = this.metadata.get(name);
    if (!metadata) {
      return false;
    }

    metadata.enabled = true;
    return true;
  }

  /**
   * Disables a plugin.
   *
   * @param name - The name of the plugin to disable
   * @returns Whether the plugin was disabled
   */
  disablePlugin(name: string): boolean {
    const metadata = this.metadata.get(name);
    if (!metadata) {
      return false;
    }

    metadata.enabled = false;
    return true;
  }

  /**
   * Checks if a plugin is enabled.
   *
   * @param name - The name of the plugin
   * @returns Whether the plugin is enabled
   */
  isPluginEnabled(name: string): boolean {
    const metadata = this.metadata.get(name);
    return metadata?.enabled ?? false;
  }

  /**
   * Gets all enabled plugins.
   *
   * @returns Array of enabled plugins
   */
  getEnabledPlugins(): Pipehead[] {
    const enabledPlugins: Pipehead[] = [];

    for (const [name, plugin] of this.plugins.entries()) {
      const metadata = this.metadata.get(name);
      if (metadata?.enabled) {
        enabledPlugins.push(plugin);
      }
    }

    return enabledPlugins;
  }

  /**
   * Gets all enabled plugins of a specific type.
   *
   * @param type - The plugin type
   * @returns Array of enabled plugins of the specified type
   */
  getEnabledPluginsByType(type: PluginType): Pipehead[] {
    const pluginNames = this.pluginsByType.get(type) || [];
    const enabledPlugins: Pipehead[] = [];

    for (const name of pluginNames) {
      const metadata = this.metadata.get(name);
      if (metadata?.enabled) {
        const plugin = this.plugins.get(name);
        if (plugin) {
          enabledPlugins.push(plugin);
        }
      }
    }

    return enabledPlugins;
  }
}

/**
 * Global plugin registry instance.
 *
 * A singleton instance of the PluginRegistry that can be used
 * throughout the application.
 */
export const pluginRegistry = new PluginRegistry();
