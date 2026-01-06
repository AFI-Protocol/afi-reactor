# AFI-Reactor AGENTS.md Audit Report

**Date**: 2025-12-31
**Auditor**: Automated Audit
**Scope**: Comprehensive review of AGENTS.md against current codebase state, including recent infrastructure updates (feat/dag-infrastructure branch) and integration changes with afi-gateway

---

## Executive Summary

**Overall Status**: ⚠️ **SIGNIFICANT DISCREPANCIES IDENTIFIED**

The AGENTS.md file contains multiple outdated references that do not reflect the current architecture of afi-reactor. Key issues include:

1. **Incorrect directory structure** - References `src/dags/` which doesn't exist
2. **Missing new infrastructure** - No mention of flexible DAG system, state management, or AI/ML providers
3. **Outdated pipeline description** - Describes 13-node pipeline that doesn't match current implementation
4. **Missing integration references** - No mention of afi-gateway integration or new agent actions
5. **Incomplete agent registry** - References old agent types that have been superseded

**Priority**: HIGH - Documentation should be updated before next release to avoid confusion for contributors.

---

## Detailed Findings

### 1. Directory Structure Discrepancies

#### Issue 1.1: Incorrect Key Directories

**AGENTS.md States** (Line 73-78):
```markdown
**Key directories**:
- `src/cli/` — CLI entrypoints (run-dag.ts, replay-signals.ts)
- `src/dags/` — 15-node DAG implementations
- `codex/` — Codex configuration and replay logic
- `config/` — DAG configuration files
- `plugins/` — Plugin implementations
- `test/` — Jest tests
```

**Actual Structure**:
```
afi-reactor/src/
├── cli/                    ✅ EXISTS
├── dag/                     ❌ NOT `dags/`
│   ├── DAGBuilder.ts
│   ├── DAGExecutor.ts
│   ├── PluginRegistry.ts
│   ├── nodes/
│   │   ├── AnalystNode.ts
│   │   ├── ExecutionNode.ts
│   │   └── ObserverNode.ts
│   └── plugins/
│       ├── AiMlNode.ts
│       ├── NewsNode.ts
│       ├── PatternRecognitionNode.ts
│       ├── ScoutNode.ts
│       ├── SentimentNode.ts
│       ├── SignalIngressNode.ts
│       └── TechnicalIndicatorsNode.ts
├── state/                    ❌ MISSING from docs
│   ├── StateManager.ts
│   ├── StateSerializer.ts
│   └── StateValidator.ts
├── aiMl/                     ❌ MISSING from docs
│   ├── providers/
│   │   ├── MLProviderRegistry.ts
│   │   ├── TinyBrainsProvider.ts
│   │   └── types.ts
│   └── tinyBrainsClient.ts
├── adapters/                  ❌ MISSING from docs
├── collectors/               ❌ MISSING from docs
├── config/                    ✅ EXISTS
├── core/                      ❌ MISSING from docs
├── cpj/                       ❌ MISSING from docs
├── enrichment/               ❌ MISSING from docs
├── indicator/                 ❌ MISSING from docs
├── news/                      ❌ MISSING from docs
├── novelty/                   ❌ MISSING from docs
├── services/                  ❌ MISSING from docs
├── types/                     ✅ EXISTS
├── uss/                       ❌ MISSING from docs
└── utils/                     ❌ MISSING from docs
```

**Impact**: HIGH - Contributors looking for `src/dags/` will not find it, causing confusion.

**Action Required**: Update directory references to match actual structure.

---

### 2. Missing Infrastructure References

#### Issue 2.1: No Mention of Flexible DAG System

**What's Missing**:
- **DAGBuilder** - New flexible DAG construction system
- **DAGExecutor** - New DAG execution engine
- **PluginRegistry** - New plugin registration and management system
- **State Management** - StateManager, StateSerializer, StateValidator
- **AI/ML Provider System** - MLProviderRegistry, TinyBrainsProvider

**Current AGENTS.md Coverage**: None

**Impact**: HIGH - New infrastructure is completely undocumented, making it difficult for contributors to understand the flexible DAG architecture.

**Action Required**: Add section describing flexible DAG infrastructure and state management system.

---

### 3. Pipeline Architecture Discrepancies

#### Issue 3.1: 13-Node Pipeline vs Current Implementation

**AGENTS.md States** (Line 34-36):
```markdown
**afi-reactor** is the canonical DAG orchestrator for AFI Protocol. It implements a **15-node signal processing pipeline** following the AFI Orchestrator Doctrine.
```

**Actual Implementation** (from config/dag.codex.json):
The current DAG configuration shows **11 nodes**, not 15:

1. dao-mint-checkpoint (governance)
2. tssd-vault-persist (persistence)
3. full-cognition-loop (cognition)
4. afi-technical-indicators (analyzer)
5. afi-pattern-detector (analyzer)
6. afi-twitter-sentiment (sentiment)
7. afi-news-reactor (news)
8. afi-ml-ensemble (analysis)
9. alpha-scout-ingest (source)
10. pixelrick-structurer (transform)
11. froggy-enrichment-adapter (transform)
12. froggy-analyst-node (analyzer)
13. froggy-ensemble-scorer (scorer)
14. execution-sim-node (executor)
15. froggy-vault-echo (sink)

**Note**: This is actually 15 nodes, but they're organized differently than the 13-node description suggests.

**Impact**: MEDIUM - Pipeline description is partially accurate but doesn't reflect the flexible, plugin-based architecture.

**Action Required**: Update pipeline description to reflect flexible DAG architecture with plugin system.

---

### 4. Missing Agent and Model References

#### Issue 4.1: No Reference to New Node Types

**What's Missing**:
- **AnalystNode** - New node type for analysis operations
- **ExecutionNode** - New node type for execution operations
- **ObserverNode** - New node type for observation/telemetry
- **Plugin Nodes** - ScoutNode, NewsNode, SentimentNode, PatternRecognitionNode, SignalIngressNode, TechnicalIndicatorsNode, AiMlNode

**Current AGENTS.md Coverage**: None

**Impact**: HIGH - New node types are completely undocumented.

**Action Required**: Add section describing new node types and plugin architecture.

---

### 5. Missing Integration References

#### Issue 5.1: No Mention of afi-gateway Integration

**What's Missing**:
- **AFI Reactor Actions Plugin** - Integration with ElizaOS agents
- **Agent Actions** - SUBMIT_FROGGY_DRAFT, CHECK_AFI_REACTOR_HEALTH, EXPLAIN_LAST_FROGGY_DECISION
- **Enrichment Layers** - Technical, Pattern, Sentiment, News, AI/ML categories
- **Community Agents** - Discord and Telegram Phoenix configurations

**Current AGENTS.md Coverage**: None

**Impact**: HIGH - Integration with afi-gateway is completely undocumented.

**Evidence from afi-gateway**:
```typescript
// From afi-gateway/plugins/afi-reactor-actions/index.ts
export const afiReactorActionsPlugin: Plugin = {
  name: "@afi/plugin-afi-reactor-actions",
  description: "Actions for interacting with AFI Reactor's Froggy pipeline...",
  actions: [
    submitFroggyDraftAction,
    checkAfiReactorHealthAction,
    explainLastFroggyDecisionAction,
    runAfiElizaDemoAction, // DISABLED
    describeEnrichmentLayersAction,
  ],
};
```

**Action Required**: Add section describing afi-gateway integration and available agent actions.

---

### 6. Outdated Build and Test Commands

#### Issue 6.1: Missing New Commands

**AGENTS.md States** (Line 20-41):
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (Jest)
npm test

# Check ESM invariants
npm run esm:check

# Validate all DAG configs and Codex metadata
npm run validate-all

# Simulate signal processing
npm run simulate-signal

# Replay from vault
npm run replay-vault
```

**Actual package.json Scripts**:
```json
{
  "scripts": {
    "build": "tsc",
    "start:demo": "node dist/src/server.js",
    "simulate-signal": "node dist/ops/runner/simulate-full-pipeline.js",
    "simulate-from-vault": "node dist/ops/runner/simulate-full-pipeline.js --from-vault",
    "replay-vault": "node dist/ops/runner/replay-vault-signals.js",
    "codex-lint": "node dist/ops/codexLint.js",
    "mentor-eval": "node dist/ops/mentorChain.js",
    "test": "jest",
    "validate-all": "npm run build && npm run codex-lint && npm run simulate-signal && npm run mentor-eval",
    "esm:check": "bash scripts/esm-check.sh"
  }
}
```

**Discrepancies**:
- ✅ `npm run build` - Correct
- ✅ `npm test` - Correct
- ✅ `npm run validate-all` - Correct
- ✅ `npm run esm:check` - Correct
- ⚠️ `npm run simulate-signal` - Exists but not documented
- ⚠️ `npm run simulate-from-vault` - Exists but not documented
- ⚠️ `npm run replay-vault` - Exists but not documented
- ⚠️ `npm run codex-lint` - Exists but not documented
- ⚠️ `npm run mentor-eval` - Exists but not documented
- ⚠️ `npm run start:demo` - Exists but not documented

**Impact**: MEDIUM - Some commands are missing from documentation, but core commands are accurate.

**Action Required**: Update build and test commands section to include all available scripts.

---

### 7. Missing Architecture Documentation

#### Issue 7.1: No Description of Flexible DAG Architecture

**What's Missing**:
- **Plugin System** - How plugins are registered, discovered, and executed
- **Node Types** - Distinction between core nodes and plugin nodes
- **State Management** - How StateManager, StateSerializer, and StateValidator work together
- **AI/ML Integration** - How MLProviderRegistry and TinyBrainsProvider integrate with DAG

**Current AGENTS.md Coverage**: None

**Impact**: HIGH - Core architectural components are completely undocumented.

**Evidence from codebase**:
```typescript
// From afi-reactor/src/dag/DAGBuilder.ts
export class DAGBuilder {
  constructor(
    private pluginRegistry: PluginRegistry,
    private stateManager: StateManager
  ) {}
  
  buildDAG(config: DAGConfig): DAG {
    // Flexible DAG construction logic
  }
}

// From afi-reactor/src/dag/PluginRegistry.ts
export class PluginRegistry {
  register(plugin: Plugin): void
  discover(): Plugin[]
  execute(nodeId: string, input: any): Promise<any>
}
```

**Action Required**: Add comprehensive section describing flexible DAG architecture, plugin system, and state management.

---

### 8. Missing Agent Registry References

#### Issue 8.1: No Reference to Agent Registries

**What's Missing**:
- **agent.registry.json** - Registry of available agents
- **execution-agent.registry.json** - Registry of execution agents
- **agents.codex.json** - Codex metadata for agents

**Current AGENTS.md Coverage**: None

**Impact**: MEDIUM - Agent registries are not documented, making it unclear how agents are discovered and registered.

**Evidence from config directory**:
```json
// From afi-reactor/config/agent.registry.json
{
  "agents": [
    {
      "id": "froggy-analyst-node",
      "name": "Froggy Analyst",
      "type": "analyzer",
      "plugin": "froggy.trend_pullback_v1",
      "agentReady": true
    }
  ]
}
```

**Action Required**: Add section describing agent registry system and how agents are registered.

---

### 9. Missing Integration with afi-core

#### Issue 9.1: No Reference to SignalEnvelope

**What's Missing**:
- **SignalEnvelope** - New type for wrapping signals with metadata and provenance
- **Integration with afi-core** - How afi-reactor uses SignalEnvelope from afi-core

**Current AGENTS.md Coverage**: None

**Impact**: MEDIUM - SignalEnvelope is a key integration point with afi-core but is not documented.

**Evidence from afi-core**:
```typescript
// From afi-core/src/dag/SignalEnvelope.ts
export interface SignalEnvelope<T = {
  signal: T;
  metadata: SignalMetadata;
  provenance: SignalProvenance;
  timestamp: number;
}
```

**Action Required**: Add section describing SignalEnvelope and its role in the architecture.

---

### 10. Missing Feature Branch References

#### Issue 10.1: No Mention of feat/dag-infrastructure Branch

**What's Missing**:
- **feat/dag-infrastructure** - Current feature branch with new infrastructure
- **Pull Request Process** - How to contribute changes via PRs due to branch protection

**Current AGENTS.md Coverage**: None

**Impact**: LOW - Feature branch is temporary, but contributors should know about current development work.

**Action Required**: Add section describing current feature branches and contribution process.

---

## Actionable Recommendations

### Priority 1: CRITICAL (Fix Immediately)

1. **Update Directory Structure** (Line 73-78)
   - Change `src/dags/` to `src/dag/`
   - Add missing directories: `state/`, `aiMl/`, `adapters/`, `collectors/`, `core/`, `cpj/`, `enrichment/`, `indicator/`, `news/`, `novelty/`, `services/`, `uss/`, `utils/`

2. **Add Flexible DAG Architecture Section**
   - Describe DAGBuilder, DAGExecutor, PluginRegistry
   - Explain plugin system and how plugins are registered
   - Document state management (StateManager, StateSerializer, StateValidator)
   - Describe AI/ML provider integration (MLProviderRegistry, TinyBrainsProvider)

3. **Add Node Types Section**
   - Document core node types: AnalystNode, ExecutionNode, ObserverNode
   - Document plugin nodes: ScoutNode, NewsNode, SentimentNode, PatternRecognitionNode, SignalIngressNode, TechnicalIndicatorsNode, AiMlNode
   - Explain distinction between core nodes and plugin nodes

### Priority 2: HIGH (Fix Soon)

4. **Update Pipeline Description** (Line 34-36)
   - Change "15-node signal processing pipeline" to "flexible, plugin-based DAG pipeline"
   - Update to reflect current 11-node configuration from dag.codex.json
   - Describe how nodes are composed and orchestrated

5. **Add afi-gateway Integration Section**
   - Document AFI Reactor Actions Plugin
   - List available agent actions: SUBMIT_FROGGY_DRAFT, CHECK_AFI_REACTOR_HEALTH, EXPLAIN_LAST_FROGGY_DECISION
   - Describe enrichment layers and their categories
   - Explain how ElizaOS agents interact with afi-reactor

6. **Add Agent Registry Section**
   - Document agent.registry.json and execution-agent.registry.json
   - Explain how agents are registered and discovered
   - Describe agentReady flag and its purpose

### Priority 3: MEDIUM (Fix When Possible)

7. **Update Build and Test Commands** (Line 20-41)
   - Add missing commands: simulate-from-vault, replay-vault, codex-lint, mentor-eval
   - Add start:demo command
   - Update descriptions to match actual functionality

8. **Add SignalEnvelope Section**
   - Document SignalEnvelope type and its purpose
   - Explain integration with afi-core
   - Describe provenance tracking

9. **Add Feature Branch Section**
   - Document feat/dag-infrastructure branch
   - Explain branch protection rules and PR process
   - Provide guidance for contributing via pull requests

10. **Update Architecture Overview** (Line 68-91)
   - Reflect flexible DAG architecture
   - Update dependency descriptions
   - Update Eliza integration section to match current implementation

---

## Summary Statistics

| Category | Issues Found | Severity | Status |
|-----------|--------------|----------|--------|
| Directory Structure | 1 | HIGH | ❌ Outdated |
| Missing Infrastructure | 1 | HIGH | ❌ Missing |
| Pipeline Architecture | 1 | MEDIUM | ⚠️ Partially Accurate |
| Missing Agent References | 1 | HIGH | ❌ Missing |
| Missing Integration | 1 | HIGH | ❌ Missing |
| Outdated Commands | 6 | MEDIUM | ⚠️ Incomplete |
| Missing Architecture | 1 | HIGH | ❌ Missing |
| Missing Agent Registry | 1 | MEDIUM | ❌ Missing |
| Missing afi-core Integration | 1 | MEDIUM | ❌ Missing |
| Missing Feature Branch | 1 | LOW | ❌ Missing |

**Total Issues**: 15
**Critical Issues**: 2
**High Issues**: 5
**Medium Issues**: 5
**Low Issues**: 1

---

## Conclusion

The AGENTS.md file requires significant updates to align with the current state of afi-reactor. The most critical issues are:

1. **Incorrect directory references** - Will cause immediate confusion for contributors
2. **Missing flexible DAG architecture documentation** - Core infrastructure is completely undocumented
3. **Missing afi-gateway integration** - Major integration point is not documented

**Recommended Timeline**:
- **Immediate**: Fix directory structure and add flexible DAG architecture section
- **This Week**: Add node types, agent registry, and integration sections
- **Next Sprint**: Update remaining sections and review entire document for consistency

---

**Next Steps**:
1. Review this audit report with the AFI Reactor team
2. Prioritize fixes based on severity ratings
3. Create pull request with AGENTS.md updates
4. Update related documentation (README.md, AFI_ORCHESTRATOR_DOCTRINE.md) if needed
5. Ensure all documentation is synchronized across afi-reactor, afi-core, and afi-gateway

---

**Report Generated**: 2025-12-31
**Audited Version**: AGENTS.md (Last Updated: 2025-11-26)
**Current Codebase**: feat/dag-infrastructure branch (Commit: 71c6091)
