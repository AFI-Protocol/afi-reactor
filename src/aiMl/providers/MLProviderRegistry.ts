/**
 * ML Provider Registry
 *
 * Central registry for managing ML providers. Handles registration, retrieval,
 * lifecycle management, and provider selection based on configuration and capabilities.
 *
 * @module providers/MLProviderRegistry
 */

import type {
  MLProvider,
  MLProviderFactory,
  MLProviderConfig,
  MLProviderInput,
  MLProviderHealth,
  MLProviderRegistryConfig,
} from './types.js';

/**
 * ML Provider Registry
 *
 * Manages ML provider instances, handles provider selection based on priority
 * and capabilities, and provides lifecycle management for all registered providers.
 *
 * Key features:
 * - Provider registration with factories
 * - Lazy initialization of providers
 * - Intelligent provider selection based on priority, availability, and capabilities
 * - Fallback mechanism for provider failures
 * - Health monitoring for all providers
 * - Thread-safe operations using Map storage
 * - Backward compatibility with environment variable configuration
 *
 * @example
 * ```typescript
 * const registry = new MLProviderRegistry();
 *
 * // Register a provider factory
 * registry.registerProvider('tiny-brains', tinyBrainsFactory);
 *
 * // Load configuration
 * registry.loadConfigs([
 *   {
 *     providerId: 'tiny-brains',
 *     enabled: true,
 *     priority: 100,
 *     config: { tinyBrainsUrl: 'https://api.example.com' }
 *   }
 * ]);
 *
 * // Initialize all providers
 * await registry.initializeAll();
 *
 * // Get the best provider for a request
 * const provider = await registry.getBestProvider({
 *   signalId: 'signal-123',
 *   symbol: 'BTC',
 *   timeframe: '1h',
 *   technical: { ... },
 *   pattern: { ... },
 *   sentiment: { ... },
 *   newsFeatures: { ... }
 * });
 * ```
 */
export class MLProviderRegistry {
  /**
   * Map of provider instances keyed by provider ID
   * Uses Map for efficient O(1) lookup and thread-safe operations
   */
  private providers: Map<string, MLProvider>;

  /**
   * Map of provider factories keyed by provider ID
   * Factories are used to create provider instances on demand
   */
  private factories: Map<string, MLProviderFactory>;

  /**
   * Map of provider configurations keyed by provider ID
   * Stores configuration for each registered provider
   */
  private configs: Map<string, MLProviderConfig>;

  /**
   * Registry-level configuration
   * Contains default provider, fallback strategy, and health check settings
   */
  private registryConfig: MLProviderRegistryConfig | null;

  /**
   * Flag indicating whether the registry has been initialized
   */
  private initialized: boolean;

  /**
   * Health check interval timer ID
   * Used for periodic health monitoring if enabled
   */
  private healthCheckTimer: NodeJS.Timeout | null;

  /**
   * Creates a new MLProviderRegistry instance
   */
  constructor() {
    this.providers = new Map<string, MLProvider>();
    this.factories = new Map<string, MLProviderFactory>();
    this.configs = new Map<string, MLProviderConfig>();
    this.registryConfig = null;
    this.initialized = false;
    this.healthCheckTimer = null;
  }

  /**
   * Register a provider factory for creating provider instances
   *
   * The factory is used to create provider instances on demand (lazy initialization).
   * This allows providers to be registered without immediately creating instances.
   *
   * @param providerId - Unique identifier for the provider
   * @param factory - Factory function for creating provider instances
   * @throws Error if a factory with the same ID is already registered
   *
   * @example
   * ```typescript
   * registry.registerProvider('tiny-brains', tinyBrainsFactory);
   * ```
   */
  registerProvider(providerId: string, factory: MLProviderFactory): void {
    if (this.factories.has(providerId)) {
      throw new Error(`Provider factory with ID '${providerId}' is already registered`);
    }

    this.factories.set(providerId, factory);
    console.log(`[MLProviderRegistry] Registered provider factory: ${providerId}`);
  }

  /**
   * Get a provider instance by ID
   *
   * If the provider instance doesn't exist yet, it will be created using the
   * registered factory (lazy initialization). The provider will be initialized
   * with its configuration if available.
   *
   * @param providerId - Provider identifier
   * @returns Provider instance or undefined if not found
   *
   * @example
   * ```typescript
   * const provider = registry.getProvider('tiny-brains');
   * if (provider) {
   *   const prediction = await provider.predict(input);
   * }
   * ```
   */
  async getProvider(providerId: string): Promise<MLProvider | undefined> {
    // Check if provider instance already exists
    if (this.providers.has(providerId)) {
      return this.providers.get(providerId);
    }

    // Check if factory is registered
    const factory = this.factories.get(providerId);
    if (!factory) {
      console.warn(`[MLProviderRegistry] No factory registered for provider: ${providerId}`);
      return undefined;
    }

    // Get provider configuration
    const config = this.configs.get(providerId);
    if (!config) {
      console.warn(`[MLProviderRegistry] No configuration found for provider: ${providerId}`);
      return undefined;
    }

    try {
      // Create provider instance using factory
      const provider = factory.create(providerId, config.config);

      // Initialize provider with configuration
      await provider.initialize(config.config);

      // Store provider instance
      this.providers.set(providerId, provider);

      console.log(`[MLProviderRegistry] Created and initialized provider: ${providerId}`);
      return provider;
    } catch (error) {
      console.error(`[MLProviderRegistry] Failed to create provider ${providerId}:`, error);
      return undefined;
    }
  }

  /**
   * Get the best available provider for a given request
   *
   * Selection algorithm considers:
   * 1. Enabled status (from configuration)
   * 2. Availability (provider's isAvailable() method)
   * 3. Capabilities (supported assets, timeframes, features)
   * 4. Priority (from configuration, higher = preferred)
   * 5. Fallback mechanism for provider failures
   *
   * @param input - ML provider input containing symbol, timeframe, and features
   * @returns Promise that resolves to the best provider or undefined if none available
   *
   * @example
   * ```typescript
   * const provider = await registry.getBestProvider({
   *   signalId: 'signal-123',
   *   symbol: 'BTC',
   *   timeframe: '1h',
   *   technical: { ... },
   *   pattern: { ... },
   *   sentiment: { ... },
   *   newsFeatures: { ... }
   * });
   * ```
   */
  async getBestProvider(input: MLProviderInput): Promise<MLProvider | undefined> {
    const candidates: Array<{ provider: MLProvider; priority: number }> = [];

    // Iterate through all registered configurations
    for (const [providerId, config] of this.configs.entries()) {
      // Check if provider is enabled
      if (!config.enabled) {
        continue;
      }

      // Get or create provider instance
      const provider = await this.getProvider(providerId);
      if (!provider) {
        continue;
      }

      // Check if provider is available
      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          console.debug(`[MLProviderRegistry] Provider ${providerId} is not available`);
          continue;
        }
      } catch (error) {
        console.error(`[MLProviderRegistry] Error checking availability for ${providerId}:`, error);
        continue;
      }

      // Check if provider supports the requested asset
      if (
        provider.capabilities.supportedAssets.length > 0 &&
        !provider.capabilities.supportedAssets.includes(input.symbol)
      ) {
        console.debug(
          `[MLProviderRegistry] Provider ${providerId} does not support asset: ${input.symbol}`
        );
        continue;
      }

      // Check if provider supports the requested timeframe
      if (
        provider.capabilities.supportedTimeframes.length > 0 &&
        !provider.capabilities.supportedTimeframes.includes(input.timeframe)
      ) {
        console.debug(
          `[MLProviderRegistry] Provider ${providerId} does not support timeframe: ${input.timeframe}`
        );
        continue;
      }

      // Provider is a valid candidate
      const priority = config.priority ?? 0;
      candidates.push({ provider, priority });
    }

    // No candidates found
    if (candidates.length === 0) {
      console.warn('[MLProviderRegistry] No available providers found for request');
      return undefined;
    }

    // Sort candidates by priority (descending)
    candidates.sort((a, b) => b.priority - a.priority);

    // Return the highest priority provider
    const selected = candidates[0].provider;
    console.log(
      `[MLProviderRegistry] Selected provider: ${selected.providerId} (priority: ${candidates[0].priority})`
    );

    return selected;
  }

  /**
   * Get all registered provider instances
   *
   * Returns all provider instances that have been created (lazy initialized).
   * Providers that are registered but not yet instantiated will not be included.
   *
   * @returns Array of all instantiated provider instances
   *
   * @example
   * ```typescript
   * const allProviders = registry.getAllProviders();
   * console.log(`Total providers: ${allProviders.length}`);
   * ```
   */
  getAllProviders(): MLProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all registered provider configurations
   *
   * Returns configuration for all registered providers, regardless of whether
   * they have been instantiated.
   *
   * @returns Array of all provider configurations
   *
   * @example
   * ```typescript
   * const configs = registry.getAllConfigs();
   * configs.forEach(config => {
   *   console.log(`${config.providerId}: enabled=${config.enabled}`);
   * });
   * ```
   */
  getAllConfigs(): MLProviderConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Get enabled provider configurations
   *
   * Returns only configurations for providers that are enabled.
   *
   * @returns Array of enabled provider configurations
   *
   * @example
   * ```typescript
   * const enabledProviders = registry.getEnabledProviders();
   * console.log(`Enabled providers: ${enabledProviders.length}`);
   * ```
   */
  getEnabledProviders(): MLProviderConfig[] {
    return Array.from(this.configs.values()).filter((config) => config.enabled);
  }

  /**
   * Initialize all registered providers
   *
   * Creates and initializes all enabled providers using their registered factories.
   * Providers that fail to initialize are logged but do not prevent other providers
   * from being initialized (fail-soft behavior).
   *
   * @returns Promise that resolves when all providers have been initialized
   *
   * @example
   * ```typescript
   * await registry.initializeAll();
   * console.log('All providers initialized');
   * ```
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      console.warn('[MLProviderRegistry] Registry already initialized');
      return;
    }

    console.log('[MLProviderRegistry] Initializing all providers...');

    const enabledConfigs = this.getEnabledProviders();
    const initializationPromises: Promise<void>[] = [];

    for (const config of enabledConfigs) {
      const promise = (async () => {
        try {
          const provider = await this.getProvider(config.providerId);
          if (provider) {
            console.log(`[MLProviderRegistry] Initialized provider: ${config.providerId}`);
          } else {
            console.warn(`[MLProviderRegistry] Failed to initialize provider: ${config.providerId}`);
          }
        } catch (error) {
          console.error(`[MLProviderRegistry] Error initializing provider ${config.providerId}:`, error);
        }
      })();

      initializationPromises.push(promise);
    }

    // Wait for all providers to initialize
    await Promise.all(initializationPromises);

    this.initialized = true;
    console.log(`[MLProviderRegistry] Initialization complete. ${this.providers.size} providers ready.`);

    // Start health check monitoring if enabled
    if (this.registryConfig?.enableHealthChecks) {
      this.startHealthCheckMonitoring();
    }
  }

  /**
   * Dispose all provider instances
   *
   * Calls dispose() on all provider instances to release resources.
   * Clears all provider instances from the registry.
   *
   * @returns Promise that resolves when all providers have been disposed
   *
   * @example
   * ```typescript
   * await registry.disposeAll();
   * console.log('All providers disposed');
   * ```
   */
  async disposeAll(): Promise<void> {
    console.log('[MLProviderRegistry] Disposing all providers...');

    // Stop health check monitoring
    this.stopHealthCheckMonitoring();

    const disposalPromises: Promise<void>[] = [];

    for (const [providerId, provider] of this.providers.entries()) {
      const promise = (async () => {
        try {
          await provider.dispose();
          console.log(`[MLProviderRegistry] Disposed provider: ${providerId}`);
        } catch (error) {
          console.error(`[MLProviderRegistry] Error disposing provider ${providerId}:`, error);
        }
      })();

      disposalPromises.push(promise);
    }

    // Wait for all providers to dispose
    await Promise.all(disposalPromises);

    // Clear all maps
    this.providers.clear();
    this.initialized = false;

    console.log('[MLProviderRegistry] All providers disposed');
  }

  /**
   * Get health status for all providers
   *
   * Returns health status for all instantiated providers.
   * Providers that are not instantiated will not be included.
   *
   * @returns Promise that resolves to a map of provider health status keyed by provider ID
   *
   * @example
   * ```typescript
   * const healthStatus = await registry.getHealthStatus();
   * for (const [providerId, health] of healthStatus.entries()) {
   *   console.log(`${providerId}: ${health.healthy ? 'healthy' : 'unhealthy'}`);
   * }
   * ```
   */
  async getHealthStatus(): Promise<Map<string, MLProviderHealth>> {
    const healthMap = new Map<string, MLProviderHealth>();

    for (const [providerId, provider] of this.providers.entries()) {
      try {
        const health = await provider.getHealth();
        healthMap.set(providerId, health);
      } catch (error) {
        console.error(`[MLProviderRegistry] Error getting health for ${providerId}:`, error);
        healthMap.set(providerId, {
          healthy: false,
          timestamp: new Date().toISOString(),
          message: 'Failed to get health status',
          error: {
            code: 'HEALTH_CHECK_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return healthMap;
  }

  /**
   * Load provider configurations
   *
   * Loads provider configurations into the registry.
   * Supports backward compatibility with environment variable configuration (TINY_BRAINS_URL).
   *
   * @param configs - Array of provider configurations
   * @throws Error if configuration is invalid
   *
   * @example
   * ```typescript
   * registry.loadConfigs([
   *   {
   *     providerId: 'tiny-brains',
   *     enabled: true,
   *     priority: 100,
   *     config: { tinyBrainsUrl: 'https://api.example.com' }
   *   }
   * ]);
   * ```
   */
  loadConfigs(configs: MLProviderConfig[]): void {
    for (const config of configs) {
      // Validate required fields
      if (!config.providerId) {
        throw new Error('Provider configuration missing required field: providerId');
      }

      if (typeof config.enabled !== 'boolean') {
        throw new Error(`Provider configuration for ${config.providerId} missing required field: enabled`);
      }

      // Support backward compatibility with environment variables
      if (config.providerId === 'tiny-brains' && config.config) {
        const tinyBrainsConfig = config.config as { tinyBrainsUrl?: string };
        // If no URL in config, check environment variable
        if (!tinyBrainsConfig.tinyBrainsUrl && process.env.TINY_BRAINS_URL) {
          tinyBrainsConfig.tinyBrainsUrl = process.env.TINY_BRAINS_URL;
          console.log(
            `[MLProviderRegistry] Using TINY_BRAINS_URL from environment for tiny-brains provider`
          );
        }
      }

      // Store configuration
      this.configs.set(config.providerId, config);
      console.log(`[MLProviderRegistry] Loaded configuration for provider: ${config.providerId}`);
    }
  }

  /**
   * Load registry-level configuration
   *
   * Loads top-level registry configuration including default provider,
   * fallback strategy, and health check settings.
   *
   * @param config - Registry configuration
   *
   * @example
   * ```typescript
   * registry.loadRegistryConfig({
   *   defaultProvider: 'tiny-brains',
   *   fallbackStrategy: 'next-available',
   *   healthCheckInterval: 60000,
   *   enableHealthChecks: true,
   *   providers: [...]
   * });
   * ```
   */
  loadRegistryConfig(config: MLProviderRegistryConfig): void {
    this.registryConfig = config;

    // Load provider configurations
    if (config.providers) {
      this.loadConfigs(config.providers);
    }

    console.log('[MLProviderRegistry] Loaded registry configuration');
  }

  /**
   * Get the default provider ID
   *
   * @returns Default provider ID or undefined if not configured
   */
  getDefaultProviderId(): string | undefined {
    return this.registryConfig?.defaultProvider;
  }

  /**
   * Get a fallback provider for a given provider
   *
   * Returns the fallback provider configured for the given provider ID.
   *
   * @param providerId - Provider ID to get fallback for
   * @returns Fallback provider instance or undefined if not configured
   *
   * @example
   * ```typescript
   * const fallback = await registry.getFallbackProvider('tiny-brains');
   * if (fallback) {
   *   console.log(`Fallback provider: ${fallback.providerId}`);
   * }
   * ```
   */
  async getFallbackProvider(providerId: string): Promise<MLProvider | undefined> {
    const config = this.configs.get(providerId);
    if (!config?.fallbackProviderId) {
      return undefined;
    }

    return this.getProvider(config.fallbackProviderId);
  }

  /**
   * Start periodic health check monitoring
   *
   * Starts a timer that periodically checks the health of all providers.
   * The interval is configured via registryConfig.healthCheckInterval.
   *
   * @private
   */
  private startHealthCheckMonitoring(): void {
    if (this.healthCheckTimer) {
      return; // Already running
    }

    const interval = this.registryConfig?.healthCheckInterval ?? 60000;

    this.healthCheckTimer = setInterval(async () => {
      try {
        const healthStatus = await this.getHealthStatus();
        for (const [providerId, health] of healthStatus.entries()) {
          if (!health.healthy) {
            console.warn(
              `[MLProviderRegistry] Health check failed for ${providerId}: ${health.message || 'Unknown error'}`
            );
          }
        }
      } catch (error) {
        console.error('[MLProviderRegistry] Error during health check monitoring:', error);
      }
    }, interval);

    console.log(`[MLProviderRegistry] Started health check monitoring (interval: ${interval}ms)`);
  }

  /**
   * Stop periodic health check monitoring
   *
   * Stops the health check timer if it is running.
   *
   * @private
   */
  private stopHealthCheckMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[MLProviderRegistry] Stopped health check monitoring');
    }
  }

  /**
   * Check if the registry has been initialized
   *
   * @returns True if registry has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the number of registered provider factories
   *
   * @returns Number of registered factories
   */
  getFactoryCount(): number {
    return this.factories.size;
  }

  /**
   * Get the number of instantiated providers
   *
   * @returns Number of instantiated providers
   */
  getProviderCount(): number {
    return this.providers.size;
  }
}
