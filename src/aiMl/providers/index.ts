/**
 * ML Provider Types - Main Export Module
 *
 * This module exports all ML provider types and interfaces for easy importing.
 * These types enable the AiMlNode to support multiple ML providers through a unified interface.
 *
 * @module providers
 */

// Core Provider Interface
export type {
  MLProvider,
  MLProviderFactory,
} from './types.js';

// Provider Capabilities and Status
export type {
  MLProviderCapabilities,
  MLProviderHealth,
  MLProviderStatus,
} from './types.js';

// Input/Output Types
export type {
  MLProviderInput,
  MLProviderOutput,
} from './types.js';

// Configuration Types
export type {
  MLProviderConfig,
  MLProviderRegistryConfig,
  TinyBrainsConfig,
  BigBrainsConfig,
  CustomProviderConfig,
  ThirdPartyProviderConfig,
} from './types.js';

// Configuration Schema
export { MLProviderConfigSchema } from './types.js';
