# Deprecated Ingest Plugins

⚠️ **DO NOT USE THESE PLUGINS** ⚠️

## Why These Plugins Are Deprecated

These plugins were part of the **legacy pre-USS v1.1 ingestion flow**. They have been replaced by the canonical USS v1.1 pipeline.

### Legacy Flow (DEPRECATED)
```
Alpha Scout → alpha-scout-ingest → signal-structurer → enrichment → analyst → validator → vault
```

### Canonical USS v1.1 Flow (CURRENT)
```
Webhook → AJV validate → context.rawUss → uss-telemetry-deriver → enrichment → analyst → validator → vault
```

## What Changed

1. **Webhook Layer**: Now validates USS v1.1 payloads directly using AJV schemas
2. **Pipeline Input**: Consumes `context.rawUss` (the validated USS object) instead of custom envelope shapes
3. **Telemetry Extraction**: `uss-telemetry-deriver` extracts routing/debug fields from `context.rawUss`
4. **No Custom Envelopes**: No need for `alpha-scout-ingest` or `signal-structurer` stages

## Migration Path

- **For webhook ingestion**: Use `POST /api/webhooks/uss` with USS v1.1 schema
- **For demo/test data**: Use `froggyWebhookService` with USS v1.1 payloads
- **For pipeline stages**: Consume `context.rawUss`, not custom envelopes

## Files in This Directory

- `alpha-scout-ingest.plugin.ts` - Legacy Alpha Scout ingestion plugin
- `signal-structurer.plugin.ts` - Legacy Pixel Rick structurer plugin

These files are preserved only for:
- Historical reference
- Supporting legacy tests during migration
- Understanding the evolution of the pipeline architecture

They will be **permanently removed** in a future cleanup once all legacy tests are migrated.

## Guardrails

A build-time test (`test/guardrails/no-legacy-ingest.test.ts`) ensures that:
- No pipeline configurations reference these plugins
- No runtime code imports these plugins
- These plugins cannot be accidentally re-used

If you see this directory, **do not use these plugins**. Use the canonical USS v1.1 pipeline instead.

---

**Quarantined**: Phase 4 (USS v1.1 canonical pipeline)  
**Last Used**: Phase 3 (pre-USS v1.1 migration)  
**Removal Target**: Phase 5 (after legacy test migration)

