/**
 * AFI Reactor - Plugin Registry Tests
 *
 * Comprehensive unit tests for the PluginRegistry component.
 *
 * @module afi-reactor/src/langgraph/__tests__/PluginRegistry.test
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Pipehead, PipelineState } from '../../types/pipeline.js';
import {
  PluginRegistry,
  pluginRegistry,
  type PluginType,
  type PluginMetadata,
  type PluginRegistrationResult,
  type PluginDiscoveryResult,
} from '../PluginRegistry.js';

/**
 * Mock plugin for testing
 */
class MockPlugin implements Pipehead {
  id = 'mock-plugin';
  type = 'enrichment' as const;
  plugin = 'mock-plugin';
  parallel = true;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    return state;
  }
}

/**
 * Mock ingress plugin for testing
 */
class MockIngressPlugin implements Pipehead {
  id = 'mock-ingress-plugin';
  type = 'ingress' as const;
  plugin = 'mock-ingress-plugin';
  parallel = true;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    return state;
  }
}

/**
 * Invalid plugin for testing validation
 */
class InvalidPlugin {
  id = 'invalid-plugin';
  // Missing required properties
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    // Create a fresh registry for each test
    registry = new PluginRegistry();
  });

  afterEach(() => {
    // Clean up the registry after each test
    registry.clear();
  });

  describe('Constructor', () => {
    it('should create a new PluginRegistry instance', () => {
      expect(registry).toBeInstanceOf(PluginRegistry);
    });

    it('should initialize with empty plugins map', () => {
      expect(registry.getPluginCount()).toBe(0);
    });

    it('should initialize with empty metadata map', () => {
      expect(registry.getAllPluginMetadata()).toHaveLength(0);
    });

    it('should initialize with empty type maps', () => {
      expect(registry.getPluginCountByType('enrichment')).toBe(0);
      expect(registry.getPluginCountByType('ingress')).toBe(0);
      expect(registry.getPluginCountByType('egress')).toBe(0);
    });

    it('should not be initialized by default', () => {
      const result = registry.initialize();
      expect(result.discovered).toBeGreaterThan(0);
    });
  });

  describe('initialize', () => {
    it('should register all built-in plugins', () => {
      const result = registry.initialize();

      expect(result.discovered).toBe(7);
      expect(result.registered).toBe(7);
      expect(result.failed).toBe(0);
      expect(result.failures).toHaveLength(0);
    });

    it('should register enrichment plugins', () => {
      registry.initialize();

      const enrichmentPlugins = registry.getPluginsByType('enrichment');
      expect(enrichmentPlugins).toHaveLength(5);

      const pluginNames = enrichmentPlugins.map(p => p.id);
      expect(pluginNames).toContain('technical-indicators');
      expect(pluginNames).toContain('pattern-recognition');
      expect(pluginNames).toContain('sentiment');
      expect(pluginNames).toContain('news');
      expect(pluginNames).toContain('ai-ml');
    });

    it('should register ingress plugins', () => {
      registry.initialize();

      const ingressPlugins = registry.getPluginsByType('ingress');
      expect(ingressPlugins).toHaveLength(2);

      const pluginNames = ingressPlugins.map(p => p.id);
      expect(pluginNames).toContain('scout');
      expect(pluginNames).toContain('signal-ingress');
    });

    it('should not initialize twice', () => {
      const result1 = registry.initialize();
      const result2 = registry.initialize();

      expect(result1.discovered).toBe(7);
      expect(result2.discovered).toBe(0);
    });

    it('should set initialized flag after initialization', () => {
      registry.initialize();
      const result = registry.initialize();

      expect(result.discovered).toBe(0);
      expect(result.registered).toBe(0);
    });
  });

  describe('registerPlugin', () => {
    it('should register a valid plugin', () => {
      const plugin = new MockPlugin();
      const result = registry.registerPlugin(plugin);

      expect(result.success).toBe(true);
      expect(result.pluginName).toBe('mock-plugin');
      expect(result.error).toBeUndefined();
    });

    it('should add plugin to plugins map', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const retrievedPlugin = registry.getPlugin('mock-plugin');
      expect(retrievedPlugin).toBe(plugin);
    });

    it('should add plugin metadata', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const metadata = registry.getPluginMetadata('mock-plugin');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('mock-plugin');
      expect(metadata?.type).toBe('enrichment');
      expect(metadata?.enabled).toBe(true);
    });

    it('should add plugin to type index', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const enrichmentPlugins = registry.getPluginsByType('enrichment');
      expect(enrichmentPlugins).toHaveLength(1);
      expect(enrichmentPlugins[0].id).toBe('mock-plugin');
    });

    it('should reject duplicate plugin registration', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();

      const result1 = registry.registerPlugin(plugin1);
      const result2 = registry.registerPlugin(plugin2);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already registered');
    });

    it('should reject invalid plugin', () => {
      const invalidPlugin = new InvalidPlugin() as unknown as Pipehead;
      const result = registry.registerPlugin(invalidPlugin);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not implement Pipehead interface');
    });

    it('should reject plugin with missing execute function', () => {
      const invalidPlugin = {
        id: 'invalid',
        type: 'enrichment' as const,
        plugin: 'invalid',
        // Missing execute function
      } as unknown as Pipehead;

      const result = registry.registerPlugin(invalidPlugin);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not implement Pipehead interface');
    });

    it('should register ingress plugin correctly', () => {
      const plugin = new MockIngressPlugin();
      const result = registry.registerPlugin(plugin);

      expect(result.success).toBe(true);
      expect(result.pluginName).toBe('mock-ingress-plugin');

      const metadata = registry.getPluginMetadata('mock-ingress-plugin');
      expect(metadata?.type).toBe('ingress');
    });

    it('should increment plugin count', () => {
      expect(registry.getPluginCount()).toBe(0);

      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      expect(registry.getPluginCount()).toBe(1);
    });
  });

  describe('unregisterPlugin', () => {
    it('should unregister an existing plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const result = registry.unregisterPlugin('mock-plugin');

      expect(result).toBe(true);
      expect(registry.hasPlugin('mock-plugin')).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      const result = registry.unregisterPlugin('non-existent');

      expect(result).toBe(false);
    });

    it('should remove plugin from plugins map', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.unregisterPlugin('mock-plugin');

      expect(registry.getPlugin('mock-plugin')).toBeUndefined();
    });

    it('should remove plugin metadata', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.unregisterPlugin('mock-plugin');

      expect(registry.getPluginMetadata('mock-plugin')).toBeUndefined();
    });

    it('should remove plugin from type index', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.unregisterPlugin('mock-plugin');

      const enrichmentPlugins = registry.getPluginsByType('enrichment');
      expect(enrichmentPlugins).toHaveLength(0);
    });

    it('should decrement plugin count', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      expect(registry.getPluginCount()).toBe(1);

      registry.unregisterPlugin('mock-plugin');
      expect(registry.getPluginCount()).toBe(0);
    });
  });

  describe('getPlugin', () => {
    it('should return registered plugin by name', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const retrievedPlugin = registry.getPlugin('mock-plugin');

      expect(retrievedPlugin).toBe(plugin);
    });

    it('should return undefined for non-existent plugin', () => {
      const retrievedPlugin = registry.getPlugin('non-existent');

      expect(retrievedPlugin).toBeUndefined();
    });

    it('should return plugin with correct properties', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const retrievedPlugin = registry.getPlugin('mock-plugin');

      expect(retrievedPlugin?.id).toBe('mock-plugin');
      expect(retrievedPlugin?.type).toBe('enrichment');
      expect(retrievedPlugin?.plugin).toBe('mock-plugin');
      expect(typeof retrievedPlugin?.execute).toBe('function');
    });
  });

  describe('getPluginsByType', () => {
    it('should return all enrichment plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();
      plugin2.id = 'mock-plugin-2';

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const enrichmentPlugins = registry.getPluginsByType('enrichment');

      expect(enrichmentPlugins).toHaveLength(2);
      expect(enrichmentPlugins[0].type).toBe('enrichment');
      expect(enrichmentPlugins[1].type).toBe('enrichment');
    });

    it('should return all ingress plugins', () => {
      const plugin = new MockIngressPlugin();
      registry.registerPlugin(plugin);

      const ingressPlugins = registry.getPluginsByType('ingress');

      expect(ingressPlugins).toHaveLength(1);
      expect(ingressPlugins[0].type).toBe('ingress');
    });

    it('should return empty array for type with no plugins', () => {
      const egressPlugins = registry.getPluginsByType('egress');

      expect(egressPlugins).toHaveLength(0);
    });

    it('should not mix plugin types', () => {
      const enrichmentPlugin = new MockPlugin();
      const ingressPlugin = new MockIngressPlugin();

      registry.registerPlugin(enrichmentPlugin);
      registry.registerPlugin(ingressPlugin);

      const enrichmentPlugins = registry.getPluginsByType('enrichment');
      const ingressPlugins = registry.getPluginsByType('ingress');

      expect(enrichmentPlugins).toHaveLength(1);
      expect(ingressPlugins).toHaveLength(1);
      expect(enrichmentPlugins[0].id).toBe('mock-plugin');
      expect(ingressPlugins[0].id).toBe('mock-ingress-plugin');
    });
  });

  describe('getAllPlugins', () => {
    it('should return all registered plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const allPlugins = registry.getAllPlugins();

      expect(allPlugins).toHaveLength(2);
    });

    it('should return empty array when no plugins registered', () => {
      const allPlugins = registry.getAllPlugins();

      expect(allPlugins).toHaveLength(0);
    });

    it('should include plugins of all types', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const allPlugins = registry.getAllPlugins();

      const types = allPlugins.map(p => p.type);
      expect(types).toContain('enrichment');
      expect(types).toContain('ingress');
    });
  });

  describe('getPluginMetadata', () => {
    it('should return metadata for registered plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const metadata = registry.getPluginMetadata('mock-plugin');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('mock-plugin');
      expect(metadata?.type).toBe('enrichment');
      expect(metadata?.version).toBe('1.0.0');
      expect(metadata?.enabled).toBe(true);
      expect(typeof metadata?.registeredAt).toBe('string');
    });

    it('should return undefined for non-existent plugin', () => {
      const metadata = registry.getPluginMetadata('non-existent');

      expect(metadata).toBeUndefined();
    });

    it('should have correct timestamp format', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const metadata = registry.getPluginMetadata('mock-plugin');

      expect(metadata?.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('getAllPluginMetadata', () => {
    it('should return metadata for all plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const allMetadata = registry.getAllPluginMetadata();

      expect(allMetadata).toHaveLength(2);
    });

    it('should return empty array when no plugins registered', () => {
      const allMetadata = registry.getAllPluginMetadata();

      expect(allMetadata).toHaveLength(0);
    });

    it('should include metadata for all plugin types', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const allMetadata = registry.getAllPluginMetadata();

      const types = allMetadata.map(m => m.type);
      expect(types).toContain('enrichment');
      expect(types).toContain('ingress');
    });
  });

  describe('validatePlugin', () => {
    it('should validate a valid plugin', () => {
      const plugin = new MockPlugin();

      const isValid = registry.validatePlugin(plugin);

      expect(isValid).toBe(true);
    });

    it('should reject invalid plugin', () => {
      const invalidPlugin = new InvalidPlugin();

      const isValid = registry.validatePlugin(invalidPlugin);

      expect(isValid).toBe(false);
    });

    it('should reject null', () => {
      const isValid = registry.validatePlugin(null);

      expect(isValid).toBe(false);
    });

    it('should reject undefined', () => {
      const isValid = registry.validatePlugin(undefined);

      expect(isValid).toBe(false);
    });

    it('should reject object without execute function', () => {
      const invalidPlugin = {
        id: 'invalid',
        type: 'enrichment' as const,
        plugin: 'invalid',
      } as unknown as Pipehead;

      const isValid = registry.validatePlugin(invalidPlugin);

      expect(isValid).toBe(false);
    });

    it('should reject object with invalid type', () => {
      const invalidPlugin = {
        id: 'invalid',
        type: 'invalid' as 'enrichment',
        plugin: 'invalid',
        execute: async () => ({}),
      } as unknown as Pipehead;

      const isValid = registry.validatePlugin(invalidPlugin);

      expect(isValid).toBe(false);
    });
  });

  describe('discoverPlugins', () => {
    it('should discover and register built-in plugins', () => {
      const result = registry.discoverPlugins();

      expect(result.discovered).toBe(7);
      expect(result.registered).toBe(7);
      expect(result.failed).toBe(0);
    });

    it('should initialize registry if not already initialized', () => {
      const result = registry.discoverPlugins();

      expect(registry.getPluginCount()).toBe(7);
      expect(result.registered).toBe(7);
    });

    it('should not reinitialize if already initialized', () => {
      registry.initialize();
      const result = registry.discoverPlugins();

      expect(result.discovered).toBe(0);
      expect(result.registered).toBe(0);
    });
  });

  describe('hasPlugin', () => {
    it('should return true for registered plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      expect(registry.hasPlugin('mock-plugin')).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      expect(registry.hasPlugin('non-existent')).toBe(false);
    });

    it('should return false after unregistering', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.unregisterPlugin('mock-plugin');

      expect(registry.hasPlugin('mock-plugin')).toBe(false);
    });
  });

  describe('getPluginCount', () => {
    it('should return 0 when no plugins registered', () => {
      expect(registry.getPluginCount()).toBe(0);
    });

    it('should return correct count after registration', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      expect(registry.getPluginCount()).toBe(1);

      registry.registerPlugin(plugin2);
      expect(registry.getPluginCount()).toBe(2);
    });

    it('should decrease after unregistering', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      expect(registry.getPluginCount()).toBe(1);

      registry.unregisterPlugin('mock-plugin');
      expect(registry.getPluginCount()).toBe(0);
    });
  });

  describe('getPluginCountByType', () => {
    it('should return 0 for type with no plugins', () => {
      expect(registry.getPluginCountByType('enrichment')).toBe(0);
      expect(registry.getPluginCountByType('ingress')).toBe(0);
      expect(registry.getPluginCountByType('egress')).toBe(0);
    });

    it('should return correct count for enrichment plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();
      plugin2.id = 'mock-plugin-2';

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      expect(registry.getPluginCountByType('enrichment')).toBe(2);
    });

    it('should return correct count for ingress plugins', () => {
      const plugin = new MockIngressPlugin();
      registry.registerPlugin(plugin);

      expect(registry.getPluginCountByType('ingress')).toBe(1);
    });

    it('should not count plugins of other types', () => {
      const enrichmentPlugin = new MockPlugin();
      const ingressPlugin = new MockIngressPlugin();

      registry.registerPlugin(enrichmentPlugin);
      registry.registerPlugin(ingressPlugin);

      expect(registry.getPluginCountByType('enrichment')).toBe(1);
      expect(registry.getPluginCountByType('ingress')).toBe(1);
      expect(registry.getPluginCountByType('egress')).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);
      registry.clear();

      expect(registry.getPluginCount()).toBe(0);
    });

    it('should clear all metadata', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.clear();

      expect(registry.getAllPluginMetadata()).toHaveLength(0);
    });

    it('should clear type maps', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);
      registry.clear();

      expect(registry.getPluginCountByType('enrichment')).toBe(0);
      expect(registry.getPluginCountByType('ingress')).toBe(0);
      expect(registry.getPluginCountByType('egress')).toBe(0);
    });

    it('should reset initialized flag', () => {
      registry.initialize();
      registry.clear();

      const result = registry.initialize();
      expect(result.discovered).toBe(7);
    });
  });

  describe('getPluginNames', () => {
    it('should return empty array when no plugins registered', () => {
      const names = registry.getPluginNames();

      expect(names).toHaveLength(0);
    });

    it('should return all plugin names', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const names = registry.getPluginNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('mock-plugin');
      expect(names).toContain('mock-ingress-plugin');
    });

    it('should update after unregistering', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      let names = registry.getPluginNames();
      expect(names).toHaveLength(1);

      registry.unregisterPlugin('mock-plugin');
      names = registry.getPluginNames();
      expect(names).toHaveLength(0);
    });
  });

  describe('enablePlugin', () => {
    it('should enable a registered plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const result = registry.enablePlugin('mock-plugin');

      expect(result).toBe(true);
      expect(registry.isPluginEnabled('mock-plugin')).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      const result = registry.enablePlugin('non-existent');

      expect(result).toBe(false);
    });

    it('should keep plugin enabled after enabling', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      registry.enablePlugin('mock-plugin');
      expect(registry.isPluginEnabled('mock-plugin')).toBe(true);
    });
  });

  describe('disablePlugin', () => {
    it('should disable a registered plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const result = registry.disablePlugin('mock-plugin');

      expect(result).toBe(true);
      expect(registry.isPluginEnabled('mock-plugin')).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      const result = registry.disablePlugin('non-existent');

      expect(result).toBe(false);
    });

    it('should keep plugin disabled after disabling', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      registry.disablePlugin('mock-plugin');
      expect(registry.isPluginEnabled('mock-plugin')).toBe(false);
    });
  });

  describe('isPluginEnabled', () => {
    it('should return true for newly registered plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      expect(registry.isPluginEnabled('mock-plugin')).toBe(true);
    });

    it('should return false for disabled plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.disablePlugin('mock-plugin');

      expect(registry.isPluginEnabled('mock-plugin')).toBe(false);
    });

    it('should return true for re-enabled plugin', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.disablePlugin('mock-plugin');
      registry.enablePlugin('mock-plugin');

      expect(registry.isPluginEnabled('mock-plugin')).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      expect(registry.isPluginEnabled('non-existent')).toBe(false);
    });
  });

  describe('getEnabledPlugins', () => {
    it('should return all enabled plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const enabledPlugins = registry.getEnabledPlugins();

      expect(enabledPlugins).toHaveLength(2);
    });

    it('should not return disabled plugins', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockIngressPlugin();

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);
      registry.disablePlugin('mock-plugin');

      const enabledPlugins = registry.getEnabledPlugins();

      expect(enabledPlugins).toHaveLength(1);
      expect(enabledPlugins[0].id).toBe('mock-ingress-plugin');
    });

    it('should return empty array when all plugins disabled', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.disablePlugin('mock-plugin');

      const enabledPlugins = registry.getEnabledPlugins();

      expect(enabledPlugins).toHaveLength(0);
    });
  });

  describe('getEnabledPluginsByType', () => {
    it('should return all enabled plugins of type', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();
      plugin2.id = 'mock-plugin-2';

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);

      const enabledPlugins = registry.getEnabledPluginsByType('enrichment');

      expect(enabledPlugins).toHaveLength(2);
    });

    it('should not return disabled plugins of type', () => {
      const plugin1 = new MockPlugin();
      const plugin2 = new MockPlugin();
      plugin2.id = 'mock-plugin-2';

      registry.registerPlugin(plugin1);
      registry.registerPlugin(plugin2);
      registry.disablePlugin('mock-plugin');

      const enabledPlugins = registry.getEnabledPluginsByType('enrichment');

      expect(enabledPlugins).toHaveLength(1);
      expect(enabledPlugins[0].id).toBe('mock-plugin-2');
    });

    it('should return empty array when no enabled plugins of type', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.disablePlugin('mock-plugin');

      const enabledPlugins = registry.getEnabledPluginsByType('enrichment');

      expect(enabledPlugins).toHaveLength(0);
    });

    it('should not mix plugin types', () => {
      const enrichmentPlugin = new MockPlugin();
      const ingressPlugin = new MockIngressPlugin();

      registry.registerPlugin(enrichmentPlugin);
      registry.registerPlugin(ingressPlugin);

      const enabledEnrichment = registry.getEnabledPluginsByType('enrichment');
      const enabledIngress = registry.getEnabledPluginsByType('ingress');

      expect(enabledEnrichment).toHaveLength(1);
      expect(enabledIngress).toHaveLength(1);
      expect(enabledEnrichment[0].id).toBe('mock-plugin');
      expect(enabledIngress[0].id).toBe('mock-ingress-plugin');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete workflow', () => {
      // Initialize registry
      const initResult = registry.initialize();
      expect(initResult.registered).toBe(7);

      // Get all plugins
      const allPlugins = registry.getAllPlugins();
      expect(allPlugins).toHaveLength(7);

      // Get enrichment plugins
      const enrichmentPlugins = registry.getPluginsByType('enrichment');
      expect(enrichmentPlugins).toHaveLength(5);

      // Get ingress plugins
      const ingressPlugins = registry.getPluginsByType('ingress');
      expect(ingressPlugins).toHaveLength(2);

      // Disable a plugin
      registry.disablePlugin('technical-indicators');
      expect(registry.isPluginEnabled('technical-indicators')).toBe(false);

      // Get enabled plugins
      const enabledPlugins = registry.getEnabledPlugins();
      expect(enabledPlugins).toHaveLength(6);

      // Unregister a plugin
      registry.unregisterPlugin('sentiment');
      expect(registry.hasPlugin('sentiment')).toBe(false);

      // Clear registry
      registry.clear();
      expect(registry.getPluginCount()).toBe(0);
    });

    it('should handle multiple registrations and unregistrations', () => {
      const plugins: Pipehead[] = [];

      for (let i = 0; i < 5; i++) {
        const plugin = new MockPlugin();
        plugin.id = `mock-plugin-${i}`;
        plugins.push(plugin);
        registry.registerPlugin(plugin);
      }

      expect(registry.getPluginCount()).toBe(5);

      // Unregister every other plugin (0, 2, 4)
      for (let i = 0; i < 5; i += 2) {
        registry.unregisterPlugin(`mock-plugin-${i}`);
      }

      // Should have 2 plugins remaining (1, 3)
      expect(registry.getPluginCount()).toBe(2);
    });

    it('should handle plugin type changes', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      expect(registry.getPluginCountByType('enrichment')).toBe(1);
      expect(registry.getPluginCountByType('ingress')).toBe(0);

      registry.unregisterPlugin('mock-plugin');

      const ingressPlugin = new MockIngressPlugin();
      registry.registerPlugin(ingressPlugin);

      expect(registry.getPluginCountByType('enrichment')).toBe(0);
      expect(registry.getPluginCountByType('ingress')).toBe(1);
    });
  });

  describe('Global pluginRegistry instance', () => {
    it('should export a global pluginRegistry instance', () => {
      expect(pluginRegistry).toBeInstanceOf(PluginRegistry);
    });

    it('should be a singleton', () => {
      const registry1 = pluginRegistry;
      const registry2 = pluginRegistry;

      expect(registry1).toBe(registry2);
    });

    it('should work independently of test registries', () => {
      // Clear global registry
      pluginRegistry.clear();

      // Register a plugin in global registry
      const plugin = new MockPlugin();
      pluginRegistry.registerPlugin(plugin);

      // Create a new test registry
      const testRegistry = new PluginRegistry();

      // They should be independent
      expect(pluginRegistry.getPluginCount()).toBe(1);
      expect(testRegistry.getPluginCount()).toBe(0);

      // Clean up
      pluginRegistry.clear();
    });
  });
});
