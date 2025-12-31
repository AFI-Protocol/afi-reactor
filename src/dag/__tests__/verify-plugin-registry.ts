/**
 * Plugin Registry Verification Script
 *
 * This script verifies that all enrichment and ingress nodes are correctly registered
 * in the PluginRegistry.
 */

import { pluginRegistry } from '../PluginRegistry.js';

console.log('=== Plugin Registry Verification ===\n');

// Initialize the registry
const result = pluginRegistry.initialize();

console.log('Initialization Result:');
console.log(`  Discovered: ${result.discovered}`);
console.log(`  Registered: ${result.registered}`);
console.log(`  Failed: ${result.failed}`);

if (result.failures.length > 0) {
  console.log('\nFailures:');
  result.failures.forEach(failure => {
    console.log(`  - ${failure.pluginName}: ${failure.error}`);
  });
}

console.log('\n=== Registered Plugins ===\n');

// Get all plugins
const allPlugins = pluginRegistry.getAllPlugins();
console.log(`Total Plugins: ${allPlugins.length}\n`);

// Get enrichment plugins
const enrichmentPlugins = pluginRegistry.getPluginsByType('enrichment');
console.log('Enrichment Plugins:');
enrichmentPlugins.forEach(plugin => {
  const metadata = pluginRegistry.getPluginMetadata(plugin.id);
  console.log(`  - ${plugin.id} (${metadata?.type})`);
  console.log(`    Plugin: ${plugin.plugin}`);
  console.log(`    Parallel: ${plugin.parallel}`);
  console.log(`    Dependencies: ${plugin.dependencies.join(', ') || 'none'}`);
  console.log(`    Enabled: ${metadata?.enabled}`);
});

// Get ingress plugins
const ingressPlugins = pluginRegistry.getPluginsByType('ingress');
console.log('\nIngress Plugins:');
ingressPlugins.forEach(plugin => {
  const metadata = pluginRegistry.getPluginMetadata(plugin.id);
  console.log(`  - ${plugin.id} (${metadata?.type})`);
  console.log(`    Plugin: ${plugin.plugin}`);
  console.log(`    Parallel: ${plugin.parallel}`);
  console.log(`    Dependencies: ${plugin.dependencies.join(', ') || 'none'}`);
  console.log(`    Enabled: ${metadata?.enabled}`);
});

// Get egress plugins
const egressPlugins = pluginRegistry.getPluginsByType('egress');
console.log('\nEgress Plugins:');
if (egressPlugins.length === 0) {
  console.log('  (none)');
} else {
  egressPlugins.forEach(plugin => {
    const metadata = pluginRegistry.getPluginMetadata(plugin.id);
    console.log(`  - ${plugin.id} (${metadata?.type})`);
  });
}

console.log('\n=== Plugin Counts ===\n');
console.log(`Total: ${pluginRegistry.getPluginCount()}`);
console.log(`Enrichment: ${pluginRegistry.getPluginCountByType('enrichment')}`);
console.log(`Ingress: ${pluginRegistry.getPluginCountByType('ingress')}`);
console.log(`Egress: ${pluginRegistry.getPluginCountByType('egress')}`);

console.log('\n=== Verification Complete ===\n');
