# Execution Agents

> **DEV / SIM-ONLY**  
> The execution agents described here are simulated/dev helpers. afi-reactor is an orchestrator, not a production execution layer. Real CEX/broker execution belongs in infra repos (e.g., afi-infra), not in afi-reactor.

Execution agents are responsible for placing simulated orders or paper trades; afi-reactor does not ship real exchange connectors.

## Registry Fields

- **type**: 
  - `local`: runs on the same machine as AFI core
  - `remote`: offloaded to a cloud/VM/droid
  - `simulated`: for test networks or mock orders

- **auth**:
  - `env`: credentials loaded from .env file
  - `injected`: provided at runtime (e.g. secrets manager, CI)
  - `none`: no credentials needed (safe for testing)

- **mode**:
  - `simulated` (used by afi-reactor helpers)
  - `paper` (optional for demos)
  - `live` (must **not** be used from afi-reactor)

- **environment**:
  - `dev` (afi-reactor built-ins)
  - `staging` or `prod` (reserved for external/infra repos, not shipped here)

## Examples

```json
{
  "binance-local": {
    "type": "local",
    "auth": "env",
    "entry": "tools/execution/binance-local.ts",
    "description": "Simulated local Binance-style execution helper for demos/dev only; not a sanctioned production connector.",
    "mode": "simulated",
    "environment": "dev"
  }
}
```

- **binance-local**: simulated local helper for Binance-style flows; demos/dev only, not a production connector.
- **paper/paper-sim agents**: paper/sim helpers for demo/testing without real orders.

afi-reactor MUST NOT ship real-money exchange connectors; those live in infra repos. Everything described here is non-canonical, simulated/dev-only.

## Security Tips

- Never commit API keys.
- Use `.env` for local development and `dotenv` in your agent scripts.
- Prefer simulated agents for dry runs or pipeline testing.
