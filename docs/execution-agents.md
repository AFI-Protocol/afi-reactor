# Execution Agents

Execution agents are responsible for placing orders, handling interactions with CEXes, DEXes, or simulated environments.

## Registry Fields

- **type**: 
  - `local`: runs on the same machine as AFI core
  - `remote`: offloaded to a cloud/VM/droid
  - `simulated`: for test networks or mock orders

- **auth**:
  - `env`: credentials loaded from .env file
  - `injected`: provided at runtime (e.g. secrets manager, CI)
  - `none`: no credentials needed (safe for testing)

## Examples

```json
{
  "binance-local": {
    "type": "local",
    "auth": "env",
    "entry": "tools/execution/binance-local.ts",
    "description": "Direct Binance API execution using local environment variables."
  }
}
```

## Security Tips

- Never commit API keys.
- Use `.env` for local development and `dotenv` in your agent scripts.
- Prefer simulated agents for dry runs or pipeline testing.
