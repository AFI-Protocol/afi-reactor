# afi-reactor — Agent Instructions

**afi-reactor** is the canonical DAG orchestrator for AFI Protocol. It implements a **flexible, plugin-based DAG pipeline** following the AFI Orchestrator Doctrine. This is the **ONLY orchestrator** in the AFI ecosystem—agents are nodes, not orchestrators.

**Naming Note**: Use "afi-reactor" naming throughout.

**Global Authority**: All agents operating in AFI Protocol repos must follow `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`. If this AGENTS.md conflicts with the Charter, **the Charter wins**.

For global droid behavior and terminology, see:
- `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`
- `afi-config/codex/governance/droids/AFI_DROID_PLAYBOOK.v0.1.md`
- `afi-config/codex/governance/droids/AFI_DROID_GLOSSARY.md`

**⚠️ CRITICAL**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` (10 Commandments) before touching DAG logic.

---

## Canonical Scored-Only Pipeline

afi-reactor is **scored-only**. There is no hardcoded pipeline in source: composition flows from the boot-validated registries (`src/config/runtimeComposition.ts`), the strategy resolves from the provider binding (`src/config/strategyResolution.ts`), and the registered pipeline manifest is executed by the generic graph executor (`src/pipeline/executor.ts` via `src/services/graphScoringService.ts`). The registered froggy composition enriches (technical+pattern ∥ sentiment+news → merge, optional AI/ML fail-soft), scores `trend_pullback_v1` from afi-core (UWR), and persists the governed evidence record through the packaged afi-infra canonical store.

**Output**: a scored-only `ReactorScoredSignalV1` — `{ signalId, rawUss, lenses?, _priceFeedMetadata?, analystScore { uwrScore, uwrAxes { structure, execution, risk, insight } }, scoredAt, decayParams, meta }`. There is **no** `validatorDecision` and **no** execution block.

**Not the reactor's responsibility**: validator certification and trade execution are downstream / external (external certification consumers; mint orchestration lives in `afi-mint`). The legacy demo personas (ingest scout, signal structurer, validator decision evaluator, execution simulator) have been **removed** and must not be reintroduced as the current flow.

---

## Build & Test

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (Jest)
npm test

# Check ESM invariants (lint for cross-repo imports, missing .js extensions, etc.)
npm run esm:check

# Validate all DAG configs and Codex metadata
npm run validate-all

# Replay vault for determinism testing
npm run replay-vault

# Lint Codex metadata
npm run codex-lint

# Run mentor evaluations
npm run mentor-eval

# Start demo server
npm run start:demo
```

**Expected outcomes**: All tests pass, DAG configs validate, signal simulation succeeds, demo server starts successfully.

---

## Run Locally / Dev Workflow

```bash
# Replay vault for determinism testing
npm run replay-vault

# Lint Codex metadata
npm run codex-lint

# Run mentor evaluations
npm run mentor-eval
```

---

## Architecture Overview

**Purpose**: Orchestrate signal pipelines via DAG. **Not** for business logic, token economics, or agent personas.

**Key directories**:
- `src/cli/` — CLI entrypoints (run-pipehead-demo.ts)
- `src/pipeline/` — the manifest-driven graph executor (executor, registryLoader, nodeSdk, hashing, category nodes)
- `src/aiMl/` — AI/ML provider integration (MLProviderRegistry, TinyBrainsProvider)
- `src/adapters/` — External service adapters (Coinalyze, CoinGecko, exchanges)
- `src/collectors/` — Data collectors (Telegram, MTProto)
- `src/core/` — Core services (VaultService)
- `src/cpj/` — CPJ (Canonical Protocol JSON) validation and mapping
- `src/enrichment/` — Enrichment logic (pattern recognition, technical indicators)
- `src/indicator/` — Indicator profiles and kernels
- `src/news/` — News providers and features
- `src/novelty/` — Novelty detection and baseline fetching
- `src/services/` — Business logic services (FroggyDemoService, pipelineRunner)
- `src/uss/` — USS (Universal Signal Schema) mappers and validators
- `src/utils/` — Utility functions (marketUtils)
- `src/types/` — TypeScript type definitions
- `codex/` — Codex configuration and replay logic
- `config/` — DAG configuration files
- `test/` — Jest tests

**Depends on**: afi-core (runtime, validators)
**Consumed by**: afi-ops (deployment), afi-infra (templates), Eliza gateways (via HTTP/WS APIs)

**Boundary with afi-core**:
- `afi-reactor` = orchestration (DAG wiring, pipeline execution)
- `afi-core` = runtime behavior (validators, scoring)

**Eliza integration**:
- `afi-reactor` exposes HTTP/WS APIs for signal scoring, replay, and DAG introspection.
- Eliza-based gateways and plugins may call these APIs as external clients.
- `afi-reactor` MUST NOT import ElizaOS code, SDKs, or character definitions.
- **Dependency direction**: Eliza gateways depend on afi-reactor; afi-reactor never depends on Eliza.

### afi-gateway Integration

afi-reactor integrates with afi-gateway via HTTP/WS APIs, enabling ElizaOS agents to interact with the Froggy pipeline.

#### AFI Reactor Actions Plugin

Located in `afi-gateway/plugins/afi-reactor-actions/index.ts`, the AFI Reactor Actions Plugin provides ElizaOS actions for interacting with afi-reactor's Froggy trend-pullback pipeline.

**Available Actions**:

1. **SUBMIT_SIGNAL_DRAFT**
   - Purpose: Submit a trend-pullback signal draft to AFI Reactor's Froggy pipeline for scoring
   - Endpoint: `POST http://localhost:8080/api/webhooks/tradingview`
   - Input: Symbol, timeframe, strategy, direction, market, setup summary, notes, enrichment profile
   - Output: Scored-only `ReactorScoredSignalV1` (signalId, `analystScore.uwrScore` + `uwrAxes`). No validator decision, no execution result.

2. **CHECK_AFI_REACTOR_HEALTH** (Phoenix Guide)
   - Purpose: Check if AFI Reactor is online and available
   - Character: Phoenix Guide
   - Endpoint: `GET http://localhost:8080/health`
   - Output: Health status, availability

3. **EXPLAIN_LAST_DECISION** (Phoenix Guide)
   - Purpose: Explain the last UWR scoring rationale produced by AFI Reactor
   - Character: Phoenix Guide
   - Endpoint: In-memory cache (future: persistent storage)
   - Output: Last signal details and UWR score breakdown (`uwrAxes`). No validator decision, no execution result.

#### Enrichment Layers

The Froggy pipeline supports multiple enrichment layers that can be configured via the enrichment profile:

- **Technical**: Technical indicators (RSI, MACD, EMA, etc.)
- **Pattern**: Chart pattern recognition (head and shoulders, triangles, etc.)
- **Sentiment**: Market sentiment analysis (social media, news sentiment)
- **News**: News analysis and feature extraction
- **AI/ML**: AI/ML predictions (conviction scores, direction, regime, risk flags)

#### Community Agents

afi-gateway provides community agent configurations for Discord and Telegram:

- **Phoenix Guide**: Checks AFI Reactor health and explains the last UWR scoring rationale
- **Froggy**: Provides trend-pullback analysis and UWR scoring explanations

Gateway clients submit signal drafts via the `SUBMIT_SIGNAL_DRAFT` action; the reactor responds with a scored-only `ReactorScoredSignalV1`.

#### Integration Architecture

```
┌─────────────────────────────────────┐
│  afi-gateway                        │
│  - SUBMIT_SIGNAL_DRAFT (submission)  │
│  - Phoenix Guide (health/explain)   │
│  - AFI Reactor Actions Plugin       │
└──────────────┬──────────────────────┘
               │
               │ HTTP POST /api/webhooks/tradingview
               │ HTTP GET /health
               ▼
┌─────────────────────────────────────┐
│  afi-reactor (scored-only)          │
│  - Froggy DAG Pipeline (6 stages)    │
│  - Telemetry → Enrichment → Analyst  │
│  - Froggy Trend-Pullback UWR scoring │
│  - TSSD Vault Write                  │
└──────────────┬──────────────────────┘
               │ ReactorScoredSignalV1 (scored-only)
               ▼
   external certification / afi-mint
   (validator + mint orchestration —
    NOT reactor responsibilities)
```

#### Configuration

Environment variable: `AFI_REACTOR_BASE_URL` (default: `http://localhost:8080`)

Required for AFI Reactor integration:
- AFI Reactor must be running on the configured URL
- HTTP endpoints must be accessible
- Webhook endpoint must be configured for signal submission

---

## Agent Registry

afi-reactor uses a registry system to manage agent configurations and their integration with the DAG pipeline. The registry enables dynamic agent discovery, registration, and lifecycle management.

### Registry Files

#### agent.registry.json

Located in [`config/agent.registry.json`](config/agent.registry.json), this registry contains agent definitions for signal generation and analysis.

**Structure**:
```json
[
  {
    "agentName": "signal-agent",
    "entry": "tools/agents/signal-agent.ts",
    "strategy": "mean-reversion",
    "version": "0.1.0",
    "description": "A stub strategy simulating mean-reversion behavior.",
    "enabled": true,
    "tags": ["stub", "strategy", "demo"]
  }
]
```

**Purpose**: Defines available signal agents and their entry points.

**Fields**:
- `agentName`: Unique name for the agent
- `entry`: File path to the agent implementation
- `strategy`: Trading strategy type
- `version`: Semantic version of the agent
- `description`: Human-readable description
- `enabled`: Whether the agent is enabled
- `tags`: Array of tags for categorization

#### execution-agent.registry.json

Located in [`config/execution-agent.registry.json`](config/execution-agent.registry.json), this registry contains execution agent configurations for trade execution.

**Structure**:
```json
{
  "binance-local": {
    "type": "local",
    "auth": "env",
    "entry": "tools/execution/binance-local.ts",
    "description": "Direct Binance API execution using local environment variables.",
    "mode": "simulated",
    "environment": "dev"
  },
  "coinbase-remote": {
    "type": "remote",
    "auth": "injected",
    "entry": "tools/execution/coinbase-remote.ts",
    "description": "Remote execution via secure agent, credentials injected at runtime."
  },
  "paper-sim": {
    "type": "simulated",
    "auth": "none",
    "entry": "tools/execution/paper-sim.ts",
    "description": "Simulation agent for testing execution logic without real orders.",
    "mode": "simulated",
    "environment": "dev"
  }
}
```

**Purpose**: Defines available execution agents and their authentication methods.

**Fields**:
- `type`: Execution type (local, remote, simulated)
- `auth`: Authentication method (env, injected, none)
- `entry`: File path to the execution agent implementation
- `description`: Human-readable description
- `mode`: Execution mode (simulated, live)
- `environment`: Target environment (dev, staging, prod)

#### agents.codex.json

Located in [`config/agents.codex.json`](config/agents.codex.json), this registry contains comprehensive metadata for all agents in the AFI ecosystem.

**Structure**:
```json
[
  {
    "agentId": "MarketDataAgentV1",
    "linkedNodes": ["market-data-streamer"],
    "description": "Streams real-time market prices, OHLCV, and order books from multiple exchanges",
    "maintainer": "afi-reactor",
    "agentReady": true,
    "status": "active",
    "role": "generator",
    "capabilities": ["price-streaming", "orderbook-analysis", "volume-tracking"],
    "version": "1.0.0"
  }
]
```

**Purpose**: Provides canonical metadata for agents, including their capabilities, roles, and integration points.

### Agent Metadata Fields

**Key Fields**:

- **agentId**: Unique identifier for the agent (e.g., "MarketDataAgentV1", "TechnicalAnalysisAgentV1")
- **linkedNodes**: Array of DAG node IDs this agent connects to (e.g., ["market-data-streamer"], ["technical-indicators"])
- **description**: Human-readable description of the agent's purpose and functionality
- **maintainer**: Repository or team responsible for maintaining the agent
- **agentReady**: Boolean flag indicating if the agent is ready for production use
- **status**: Current status of the agent (active, deprecated, experimental)
- **role**: Functional role in the pipeline:
  - **generator**: Produces signals or data
  - **analyzer**: Analyzes signals or data
  - **scorer**: Assigns scores to signals
  - **validator**: Validates signals
  - **persister**: Persists signals
  - **executor**: Executes trades
  - **observer**: Observes and logs results
- **capabilities**: Array of capabilities the agent provides (e.g., ["price-streaming", "technical-indicators"])
- **version**: Semantic version of the agent implementation

### Agent Roles

#### Generator Agents

Produce signals or data for the pipeline:

- **MarketDataAgentV1**: Streams real-time market prices, OHLCV, and order books from multiple exchanges
- **OnchainFeedAgentV1**: Ingests blockchain events and DeFi protocol data from multiple networks
- **SocialSignalAgentV1**: Collects Twitter, Discord, and social sentiment signals for market analysis
- **NewsFeedAgentV1**: Parses financial news and RSS feeds for breaking events and market impact
- **AIStrategyAgentV1**: Generates candidate trading signals using AI models and strategy frameworks

#### Analyzer Agents

Analyze signals or data:

- **TechnicalAnalysisAgentV1**: Runs MACD, RSI, Bollinger, and other TA indicators for signal validation
- **PatternRecognitionAgentV1**: Detects price action setups and chart patterns for trading opportunities
- **SentimentAnalysisAgentV1**: Scores market and social sentiment for bias detection and trend confirmation
- **NewsEventAgentV1**: Evaluates market impact of news and events for signal enhancement
- **AIEnsembleAgentV1**: Aggregates multiple analyses into a final weighted score using ensemble methods

#### Scorer Agents

Assign scores to signals:

- **afi-reactor**: Handles ensemble-based signal scoring using PoI and PoInsight balancing

#### Validator Agents

Validate signals:

- **factory.droid**: Handles DAO quorum verification and checkpoint validation

#### Persister Agents

Persist signals:

- **scarlet**: Manages MongoDB T.S.S.D. Vault persistence of approved signals

#### Executor Agents

Execute trades:

- **ExchangeExecutionAgentV1**: Executes trades via exchanges with risk controls and position management

#### Observer Agents

Observe and log results:

- **TelemetryAgentV1**: Logs all signals, scores, and execution results to T.S.S.D. vault for monitoring

### Agent Discovery and Registration

**Discovery Process**:
1. Registry files are loaded at startup from [`config/`](config/) directory
2. Agent metadata is parsed and validated
3. Agents are indexed by `agentId` for fast lookup
4. Agents with `agentReady: true` are marked as available for production use

**Registration Process**:
1. New agents are added to registry files
2. Agent metadata is validated against schema
3. `agentReady` flag is set to `false` for new agents until testing is complete
4. Once tested and validated, `agentReady` is set to `true`
5. Registry is reloaded to pick up new agents

### agentReady Flag

**Purpose**: The `agentReady` flag indicates whether an agent is ready for production use.

**Usage**:
- **true**: Agent has been tested, validated, and is ready for production deployment
- **false**: Agent is under development, testing, or not yet validated

**Lifecycle**:
1. **Development**: `agentReady: false` - Agent is being developed
2. **Testing**: `agentReady: false` - Agent is undergoing testing
3. **Validation**: `agentReady: false` - Agent is being validated
4. **Production**: `agentReady: true` - Agent has passed all validation and is production-ready

### Integration with DAG

Agents integrate with the DAG pipeline through their `linkedNodes` field:

1. **Generator Agents**: Connect to ingress nodes (e.g., ScoutNode, SignalIngressNode)
2. **Analyzer Agents**: Connect to enrichment nodes (e.g., TechnicalIndicatorsNode, PatternRecognitionNode, SentimentNode, NewsNode, AiMlNode)
3. **Scorer Agents**: Connect to AnalystNode for final scoring
4. **Validator Agents**: Connect to validation nodes in the DAG
5. **Persister Agents**: Connect to persistence nodes (e.g., TSSD Vault)
6. **Executor Agents**: Connect to ExecutionNode for trade execution
7. **Observer Agents**: Connect to ObserverNode for logging and telemetry

**Example Integration**:
```json
{
  "agentId": "TechnicalAnalysisAgentV1",
  "linkedNodes": ["technical-indicators-node"],
  "description": "Runs MACD, RSI, Bollinger, and other TA indicators for signal validation",
  "maintainer": "afi-reactor",
  "agentReady": true,
  "status": "active",
  "role": "analyzer",
  "capabilities": ["technical-indicators", "trend-analysis", "support-resistance"],
  "version": "1.0.0"
}
```

This agent connects to the `TechnicalIndicatorsNode` plugin in the DAG, providing technical indicator enrichment for signals.

### Examples

**Example 1: Generator Agent**
```json
{
  "agentId": "MarketDataAgentV1",
  "linkedNodes": ["market-data-streamer"],
  "description": "Streams real-time market prices, OHLCV, and order books from multiple exchanges",
  "maintainer": "afi-reactor",
  "agentReady": true,
  "status": "active",
  "role": "generator",
  "capabilities": ["price-streaming", "orderbook-analysis", "volume-tracking"],
  "version": "1.0.0"
}
```

**Example 2: Analyzer Agent**
```json
{
  "agentId": "TechnicalAnalysisAgentV1",
  "linkedNodes": ["technical-analysis-node"],
  "description": "Runs MACD, RSI, Bollinger, and other TA indicators for signal validation",
  "maintainer": "afi-reactor",
  "agentReady": true,
  "status": "active",
  "role": "analyzer",
  "capabilities": ["technical-indicators", "trend-analysis", "support-resistance"],
  "version": "1.0.0"
}
```

**Example 3: Scorer Agent**
```json
{
  "agentId": "afi-reactor",
  "linkedNodes": ["afi-ensemble-score"],
  "description": "AFI Reactor handles ensemble-based signal scoring using PoI and PoInsight balancing",
  "maintainer": "afi-reactor",
  "agentReady": true,
  "status": "active",
  "role": "scorer",
  "capabilities": ["poi-scoring", "insight-balancing", "ensemble-validation"],
  "version": "1.0.0"
}
```

**Example 4: Validator Agent**
```json
{
  "agentId": "factory.droid",
  "linkedNodes": ["dao-mint-checkpoint"],
  "description": "Factory Droids handle DAO quorum verification and checkpoint validation",
  "maintainer": "factory.droid",
  "agentReady": true,
  "status": "active",
  "role": "validator",
  "capabilities": ["dao-consensus", "quorum-verification", "mint-eligibility"],
  "version": "1.0.0"
}
```

**Example 5: Persister Agent**
```json
{
  "agentId": "scarlet",
  "linkedNodes": ["tssd-vault-persist"],
  "description": "Scarlet manages MongoDB T.S.S.D. Vault persistence of approved signals",
  "maintainer": "Scarlet",
  "agentReady": true,
  "status": "active",
  "role": "persister",
  "capabilities": ["vault-storage", "data-persistence", "signal-archival"],
  "version": "1.0.0"
}
```

**Example 6: Executor Agent**
```json
{
  "agentId": "ExchangeExecutionAgentV1",
  "linkedNodes": ["exchange-execution-node"],
  "description": "Executes trades via exchanges with risk controls and position management",
  "maintainer": "afi-reactor",
  "agentReady": true,
  "status": "active",
  "role": "executor",
  "capabilities": ["trade-execution", "risk-management", "position-sizing"],
  "version": "1.0.0"
}
```

**Example 7: Observer Agent**
```json
{
  "agentId": "TelemetryAgentV1",
  "linkedNodes": ["telemetry-log-node"],
  "description": "Logs all signals, scores, and execution results to T.S.S.D. vault for monitoring",
  "maintainer": "Scarlet",
  "agentReady": true,
  "status": "active",
  "role": "observer",
  "capabilities": ["telemetry-logging", "performance-monitoring", "data-analytics"],
  "version": "1.0.0"
}
```

### Best Practices

**For Contributors**:
1. When adding a new agent, update the appropriate registry file
2. Set `agentReady: false` during development and testing
3. Set `agentReady: true` only after thorough testing and validation
4. Provide clear descriptions and capabilities
5. Specify the correct `linkedNodes` for DAG integration
6. Use semantic versioning for `version` field
7. Tag agents appropriately (e.g., "stub", "strategy", "demo")

**For Maintainers**:
1. Review agent registry changes in pull requests
2. Validate agent metadata against schema
3. Test agent integration with DAG before setting `agentReady: true`
4. Monitor agent performance and status
5. Update agent status as needed (active, deprecated, etc.)

### Related Documentation

- [Flexible DAG Architecture](#flexible-dag-architecture) - How DAG nodes are composed and executed
- [Node Types](#node-types) - Core nodes and plugin nodes in the DAG
- [afi-gateway Integration](#afi-gateway-integration) - ElizaOS agent integration
- [AFI Orchestrator Doctrine](../AFI_ORCHESTRATOR_DOCTRINE.md) - Guidelines for agent behavior

---

## Flexible DAG Architecture

afi-reactor implements a **flexible, plugin-based DAG system** that allows dynamic pipeline construction and execution. This architecture replaces the previous fixed 15-node pipeline with a composable, extensible system.

### Core Components

#### DAGBuilder
Located in `src/dag/DAGBuilder.ts`, the DAGBuilder is responsible for:
- **DAG Construction**: Builds DAGs from analyst configurations
- **Dependency Resolution**: Resolves dependencies between nodes and validates no cycles exist
- **Topological Sorting**: Determines execution order using Kahn's algorithm
- **Execution Level Grouping**: Groups nodes by execution level for parallel execution
- **Validation**: Validates DAG structure and node configurations

Key methods:
- `buildFromConfig(config: AnalystConfig): DAGBuildResult` - Builds DAG from configuration
- `validateDAG(dag: DAG): ValidationResult` - Validates DAG structure
- `topologicalSort(dag: DAG): string[]` - Returns nodes in topological order
- `getExecutionLevels(dag: DAG): string[][]` - Groups nodes by execution level

#### DAGExecutor
Located in `src/dag/DAGExecutor.ts`, the DAGExecutor is responsible for:
- **DAG Execution**: Executes DAGs with sequential and parallel execution patterns
- **Error Handling**: Provides retry logic, cancellation support, and error recovery
- **Metrics Tracking**: Collects execution metrics (timing, success/failure rates)
- **Execution Context**: Manages execution state and context
- **Node Execution**: Executes individual nodes with dependency checking

Key methods:
- `execute(dag: DAG, initialState?: PipelineState, options?: ExecutionOptions): Promise<ExecutionResult>` - Executes DAG
- `executeSequential(dag: DAG, initialState?: PipelineState, options?: ExecutionOptions): Promise<ExecutionResult>` - Sequential execution
- `executeParallel(dag: DAG, initialState?: PipelineState, options?: ExecutionOptions): Promise<ExecutionResult>` - Parallel execution
- `cancelExecution(executionId: string, reason?: string): Promise<void>` - Cancels running execution

Execution options:
- `timeout?: number` - Maximum execution time in milliseconds
- `maxRetries?: number` - Maximum number of retries for failed nodes
- `retryDelay?: number` - Delay between retries in milliseconds
- `continueOnError?: boolean` - Continue execution on non-critical failures
- `failFast?: boolean` - Fail fast on first error
- `maxParallelNodes?: number` - Maximum number of parallel nodes
- `trackMemoryUsage?: boolean` - Track memory usage during execution
- `enableLogging?: boolean` - Enable detailed logging

#### PluginRegistry
Located in `src/dag/PluginRegistry.ts`, the PluginRegistry is responsible for:
- **Plugin Registration**: Registers and manages all DAG plugins
- **Plugin Discovery**: Discovers plugins from the plugins directory
- **Plugin Validation**: Validates plugins implement the Pipehead interface
- **Plugin Retrieval**: Retrieves plugins by name or type
- **Plugin Lifecycle**: Manages plugin enable/disable state

Built-in plugins:
- **Enrichment plugins**: TechnicalIndicatorsNode, PatternRecognitionNode, SentimentNode, NewsNode, AiMlNode
- **Ingress plugins**: ScoutNode, SignalIngressNode

Key methods:
- `registerPlugin(plugin: Pipehead): PluginRegistrationResult` - Registers a plugin
- `getPlugin(name: string): Pipehead | undefined` - Gets plugin by name
- `getPluginsByType(type: PluginType): Pipehead[]` - Gets plugins by type
- `initialize(): PluginDiscoveryResult` - Initializes registry with built-in plugins
- `enablePlugin(name: string): boolean` - Enables a plugin
- `disablePlugin(name: string): boolean` - Disables a plugin

### State Management

#### StateManager
Located in `src/state/StateManager.ts`, the StateManager is responsible for:
- **State Management**: Manages Pipeline state with thread-safe updates
- **History Tracking**: Maintains state history for rollback capabilities
- **Execution Metrics**: Tracks execution metrics from trace entries
- **Rollback Support**: Provides rollback to previous state or checkpoint

Key methods:
- `getState(): PipelineState` - Gets current state
- `updateState(updater: (state: PipelineState) => PipelineState): Promise<void>` - Updates state
- `getStateHistory(): PipelineState[]` - Gets state history
- `rollbackState(): boolean` - Rolls back to previous state
- `createCheckpoint(): number` - Creates a checkpoint
- `rollbackToCheckpoint(index: number): boolean` - Rolls back to checkpoint

#### StateSerializer
Located in `src/state/StateSerializer.ts`, the StateSerializer is responsible for:
- **State Serialization**: Serializes Pipeline state to JSON
- **State Deserialization**: Deserializes JSON to Pipeline state
- **Codex Compatibility**: Ensures state is Codex-replayable

#### StateValidator
Located in `src/state/StateValidator.ts`, the StateValidator is responsible for:
- **State Validation**: Validates Pipeline state structure and content
- **Schema Validation**: Validates state against schema definitions
- **Error Reporting**: Reports validation errors and warnings

### AI/ML Provider Integration

#### MLProviderRegistry
Located in `src/aiMl/providers/MLProviderRegistry.ts`, the MLProviderRegistry is responsible for:
- **Provider Registration**: Registers ML provider factories
- **Provider Selection**: Selects best provider based on priority, availability, and capabilities
- **Lazy Initialization**: Creates provider instances on demand
- **Health Monitoring**: Monitors provider health status
- **Fallback Mechanism**: Provides fallback providers for failures

Key methods:
- `registerProvider(providerId: string, factory: MLProviderFactory): void` - Registers a provider factory
- `getBestProvider(input: MLProviderInput): Promise<MLProvider | undefined>` - Gets best provider
- `initializeAll(): Promise<void>` - Initializes all enabled providers
- `getHealthStatus(): Promise<Map<string, MLProviderHealth>>` - Gets health status

#### TinyBrainsProvider
Located in `src/aiMl/providers/TinyBrainsProvider.ts`, the TinyBrainsProvider is responsible for:
- **AI/ML Predictions**: Provides AI/ML predictions for trading signals
- **Conviction Scoring**: Calculates conviction scores for signals
- **Direction Prediction**: Predicts market direction (long/short)
- **Regime Detection**: Detects market regimes
- **Risk Flagging**: Flags high-risk signals

### Plugin System

The plugin system allows dynamic composition of DAG pipelines:

1. **Plugin Registration**: Plugins are registered with the PluginRegistry
2. **Plugin Discovery**: Plugins are discovered from the plugins directory
3. **Plugin Validation**: Plugins are validated to implement the Pipehead interface
4. **Plugin Execution**: Plugins are executed by the DAGExecutor based on DAG structure

Plugin types:
- **Enrichment plugins**: Add enrichment data to signals (technical indicators, patterns, sentiment, news, AI/ML)
- **Ingress plugins**: Provide signal input (scout, signal ingress)
- **Required plugins**: Core pipeline nodes (analyst, execution, observer)

### Execution Flow

1. **Scout nodes** execute first (independent signal sources, no dependencies)
2. **Signal Ingress nodes** execute second (may depend on Scout)
3. **Enrichment nodes** execute in parallel where possible (based on dependencies)
4. **Required nodes** execute last (analyst, execution, observer)

This flexible architecture allows analysts to configure custom pipelines by selecting and ordering plugins as needed.

---

## Node Types

afi-reactor uses two categories of nodes: **core nodes** and **plugin nodes**.

### Core Nodes

Core nodes are required nodes that are always present in the DAG and handle fundamental pipeline operations.

#### AnalystNode
Located in `src/dag/nodes/AnalystNode.ts`, the AnalystNode is responsible for:
- Loading analyst configuration from afi-factory
- Initializing the enrichment pipeline
- Preparing signals for enrichment
- Aggregating all enrichment results (including AI/ML predictions)
- Scoring signals from Scout nodes using ensemble ML models and AI/ML predictions
- Generating narratives and interpretations based on enriched signals

Key responsibilities:
- Load analyst configuration from afi-factory
- Validate analyst configuration
- Initialize enrichment pipeline
- Prepare signal for enrichment
- Aggregate enrichment results from all enrichment nodes (including AI/ML)
- Score signals using ensemble ML models and AI/ML predictions
- Generate narratives based on enriched signals

#### ExecutionNode
Located in `src/dag/nodes/ExecutionNode.ts`, the ExecutionNode is responsible for:
- Aggregating enrichment results from all enrichment nodes
- Validating enrichment results
- Generating final scored signal
- Preparing signal for observer

Key responsibilities:
- Aggregate enrichment results from all enrichment nodes
- Validate enrichment results
- Generate final scored signal
- Prepare signal for observer

#### ObserverNode
Located in `src/dag/nodes/ObserverNode.ts`, the ObserverNode is responsible for:
- Observing the final scored signal
- Logging execution metrics
- Publishing signal to downstream consumers
- Adding trace entries for execution tracking

Key responsibilities:
- Retrieve scored signal from state
- Validate scored signal
- Log execution metrics
- Publish signal to downstream consumers (message queues, webhooks, databases)

### Plugin Nodes

Plugin nodes are optional, composable nodes that provide specific functionality. They can be enabled/disabled and ordered as needed.

#### ScoutNode
Located in `src/dag/plugins/ScoutNode.ts`, the ScoutNode is responsible for:
- Scouting for new signals from external sources or AFI-native models
- Discovering potential trading opportunities
- Submitting signals to the enrichment pipeline
- Tracking signal submissions for reward attribution

Key characteristics:
- Executes BEFORE enrichment stage (no dependencies)
- Discovers signals from external sources or AFI-native models
- Does NOT perform scoring (that's Analyst's responsibility)
- Does NOT enrich signals (that's Enrichers' responsibility)
- Tracks submissions for reward attribution (important for third-party Scouts)

#### NewsNode
Located in `src/dag/plugins/NewsNode.ts`, the NewsNode is responsible for:
- Fetching news data from news providers
- Extracting news features
- Storing news enrichment results

#### SentimentNode
Located in `src/dag/plugins/SentimentNode.ts`, the SentimentNode is responsible for:
- Fetching sentiment data from sentiment providers
- Calculating sentiment scores
- Storing sentiment enrichment results

#### PatternRecognitionNode
Located in `src/dag/plugins/PatternRecognitionNode.ts`, the PatternRecognitionNode is responsible for:
- Detecting chart patterns
- Calculating pattern metrics
- Storing pattern recognition enrichment results

#### SignalIngressNode
Located in `src/dag/plugins/SignalIngressNode.ts`, the SignalIngressNode is responsible for:
- Ingesting external signals
- Normalizing signal format
- Storing signal ingress results

#### TechnicalIndicatorsNode
Located in `src/dag/plugins/TechnicalIndicatorsNode.ts`, the TechnicalIndicatorsNode is responsible for:
- Calculating technical indicators
- Storing technical indicator enrichment results

#### AiMlNode
Located in `src/dag/plugins/AiMlNode.ts`, the AiMlNode is responsible for:
- Calling AI/ML providers for predictions
- Storing AI/ML enrichment results (conviction scores, direction, regime, risk flags)

### Node Type Distinction

**Core nodes**:
- Always present in the DAG
- Handle fundamental pipeline operations
- Cannot be disabled or removed
- Execute in fixed order (analyst → execution → observer)

**Plugin nodes**:
- Optional and composable
- Can be enabled/disabled
- Can be ordered as needed
- Execute based on DAG configuration and dependencies

---

## Security

- **DAG changes affect all signals**: Incorrect orchestration can corrupt signal processing.
- **Codex replay must be deterministic**: Changes that break replay break auditability.
- **No secrets in DAG configs**: Use environment variables.
- **Plugin validation**: Plugins must follow plugin contract and security review.

---

## Git Workflows

- **Base branch**: `main` or `migration/multi-repo-reorg`
- **Branch naming**: `feat/`, `fix/`, `refactor/`
- **Commit messages**: Conventional commits (e.g., `feat(dag): add sentiment analysis node`)
- **Before committing**: Run `npm test && npm run validate-all`

### Feature Branches

Current feature branches may contain experimental or in-development features:

- **feat/dag-infrastructure**: Flexible DAG system with plugin architecture, state management, and AI/ML provider integration
  - Introduces DAGBuilder, DAGExecutor, PluginRegistry
  - Adds StateManager, StateSerializer, StateValidator
  - Implements MLProviderRegistry and TinyBrainsProvider
  - Migrates from fixed 15-node pipeline to flexible, plugin-based architecture

**Branch Protection Rules**:
- Direct pushes to `main` are disabled
- All changes must be submitted via pull requests
- PRs require at least one approval before merging
- CI/CD checks must pass before merge

**Pull Request Process**:
1. Create feature branch from `main` or `migration/multi-repo-reorg`
2. Make changes following the AFI Orchestrator Doctrine
3. Run `npm test && npm run validate-all` locally
4. Submit pull request with clear description
5. Address review feedback
6. Ensure CI/CD checks pass
7. Merge after approval

**For Contributors**: Always work on feature branches and submit PRs. Never push directly to protected branches.

---

## Conventions & Patterns

- **Language**: TypeScript (ESM)
- **DAG nodes**: Stateless, composable, follow Doctrine
- **Naming**: Use "afi-reactor" naming throughout
- **Tests**: Jest, located in `test/`
- **Codex**: All DAG runs must be Codex-replayable

---

## ESM Invariants

**afi-reactor is pure ESM** and depends on **afi-core** as an ESM package. All code must follow strict ESM conventions to ensure runtime compatibility.

**Required practices**:
- All imports from **afi-core** must use the package name, never relative paths across repos:
  ```typescript
  // ✅ CORRECT
  import { scoreFroggyTrendPullbackFromEnriched } from "afi-core/analysts/froggy.trend_pullback_v1.js";
  import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";

  // ❌ WRONG - Never use cross-repo relative paths
  import { scoreFroggyTrendPullbackFromEnriched } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
  import type { ValidatorDecisionBase } from "../../afi-core/validators/ValidatorDecision.js";
  ```
- All relative imports within afi-reactor (e.g., from `src/` to `plugins/`) **must** include `.js` extensions:
  ```typescript
  // ✅ CORRECT
  import froggyEnrichmentTechPattern from "../../plugins/froggy-enrichment-tech-pattern.plugin.js";

  // ❌ WRONG
  import froggyEnrichmentTechPattern from "../../plugins/froggy-enrichment-tech-pattern.plugin";
  ```
- External package imports (e.g., `from "express"`) do **not** need `.js` extensions.
- No imports may reference `.ts` files at runtime.
- New plugins and services must follow the same ESM pattern—no CommonJS.

**Why these rules matter**:
- afi-reactor uses plain `tsc` compilation (no bundler).
- Node.js ESM requires explicit file extensions for relative imports.
- Cross-repo relative paths break at runtime because `afi-core` is a separate npm package.
- afi-core is linked via npm (`node_modules/afi-core -> ../../afi-core`), so imports must use the package name.

**Validation**:
- Run `npm run build` to verify TypeScript compiles without errors.
- Run `npm run start:demo` to ensure the server starts without ESM module resolution errors.

**For new contributors**: When adding new plugins or services, always use `afi-core/...` for cross-repo imports and include `.js` extensions for relative paths. This is non-negotiable for ESM compatibility.

---

## Scope & Boundaries for Agents

**Allowed**:
- Add new DAG nodes to `src/dags/` (following Doctrine)
- Improve orchestration logic in `src/cli/`
- Add tests, update Codex configs, add plugins
- Update `.afi-codex.json` if capabilities change

**Forbidden**:
- Violate AFI Orchestrator Doctrine (10 Commandments)
- Make agents into orchestrators (agents are nodes only)
- Change 15-node DAG structure without explicit approval
- Modify Codex replay logic without understanding impact
- Add orchestration logic to other repos (afi-reactor is ONLY orchestrator)

**When unsure**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` first. Ask for explicit spec on DAG changes. Prefer no-op over breaking orchestration.

---

## Cursor Cloud / Dev Environment Notes

Durable, non-obvious notes for running afi-reactor in a Cursor Cloud VM (or any
dev checkout). Standard commands live in **Build & Test** above; only caveats
are captured here.

### Sibling repos are mandatory and live beside the repo

`package.json` links `afi-core`, `afi-factory`, and `afi-config` via `file:../`
(afi-core also pulls in `afi-math`). With the repo checked out at `/workspace`,
`../` resolves to `/`, so the siblings must exist at `/afi-core`,
`/afi-factory`, `/afi-math`, and **`/afi-config`** (required since Mission
1.5-B made afi-config a real schema dependency of the canonical USS validator).
If any sibling is missing, clone it beside the repo (creating dirs under `/`
needs `sudo`):

```bash
for r in afi-core afi-factory afi-math afi-config; do
  sudo mkdir -p /$r && sudo chown -R "$USER" /$r
  git clone https://github.com/AFI-Protocol/$r.git /$r
done
```

### afi-config's prepare/build can affect installs

`afi-config` declares a `prepare` script (`npm run build` → `tsc`). Because
afi-reactor depends on `afi-config@file:../afi-config`, a plain `npm install`
in afi-reactor can trigger that hook — which may fail on a bare afi-config
checkout (no local toolchain) and will regenerate `afi-config/dist/**`
artifacts (harmless drift; restore with `git -C /afi-config restore dist`).
Mitigations:

- Run `npm ci` inside `/afi-config` first so the hook resolves afi-config's own
  locked `tsc` — the CI workflow (`.github/workflows/validate-all.yml`) already
  does exactly this via its "Install and build afi-config" step before
  installing afi-reactor.
- Or install in afi-reactor with `npm install --ignore-scripts` when you only
  need dependency resolution.

### Runtime deps required for server bootability

`npm run start:demo` (`dist/src/server.js`, port 8080) statically imports
modules beyond the pipehead/test surface: `ccxt` (BloFin/Coinbase price-feed
adapters) and `telegram` / `node-telegram-bot-api` / `input` (Telegram
collectors — opt-in at runtime but statically imported). These are declared in
`package.json`; without them the server exits at startup with
`ERR_MODULE_NOT_FOUND`. The validation/indicator stack (`ajv`, `ajv-formats`,
`trading-signals`, `afi-config`) is canonical and wired since Mission 1.5-B
(DR-001/DR-002 resolved) — see `docs/PIPEHEAD_SYSTEM.md`.

### Running / smoke-testing the server

`npm run build` then `npm run start:demo`. Healthy startup logs
`USS v1.1 validator initialized successfully` and
`Listening on http://localhost:8080`. The `❌ Missing required MTProto env vars`
line is expected — Telegram collectors are opt-in
(`AFI_TELEGRAM_MTPROTO_ENABLED=1`). No env vars or MongoDB are required for the
demo flow; the default `demo` price feed and fail-soft enrichment cover it.

```bash
curl -s localhost:8080/health
curl -s -X POST localhost:8080/api/webhooks/tradingview -H 'Content-Type: application/json' \
  -d '{"symbol":"BTC/USDT","timeframe":"1h","strategy":"trend_pullback_v1","direction":"long"}'
```

The webhook returns a scored-only `ReactorScoredSignalV1`
(`analystScore.uwrScore` + `uwrAxes`; no validator/execution block).

### Known caveats (pre-existing, verified 2026-07-02)

- `npm run codex-lint` (and therefore `npm run validate-all`) fails because
  `tsc` does not copy `config/*.json` into `dist/`, so the codex manifests are
  absent under `dist/config/`. CI runs `build` + `test`, not `validate-all`.
- The repo-wide `npm run esm:check` still flags a handful of pre-existing
  legacy files importing without `.js` extensions (e.g.
  `src/aiMl/providers/TinyBrainsProvider.ts`, `test/uss/*`). This predates
  Mission 1.5-B and does not affect build/test.
  The scoped pipehead gates (`npx tsc -p tsconfig.pipeheads.json`,
  `bash scripts/esm-check-pipeheads.sh`) pass clean.

---

**Last Updated**: 2025-11-26 | **Maintainers**: AFI Reactor Team | **Charter**: `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md` | **Doctrine**: `AFI_ORCHESTRATOR_DOCTRINE.md`
