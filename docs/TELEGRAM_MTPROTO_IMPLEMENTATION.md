# Telegram MTProto Collector - Implementation Summary

**Date:** 2024-12-16  
**Status:** ✅ COMPLETE - Production-ready MTProto user-client collector

---

## Overview

Implemented a **Telegram MTProto user-client collector** that runs alongside the existing Bot API collector, allowing AFI to monitor public Telegram channels without requiring admin rights or bot permissions.

**Key Features:**
- ✅ User-client authentication (phone number + API credentials)
- ✅ Read public channels without admin access
- ✅ Fetch historical messages (optional)
- ✅ Persistent session and state management
- ✅ Flood-wait handling and throttling
- ✅ Same CPJ v0.1 output as Bot API collector
- ✅ Runs in parallel with Bot API collector
- ✅ No breaking changes to existing code

---

## Architecture

### Module Structure

```
src/collectors/telegram_mtproto/
├── mtprotoClient.ts       # Session handling, login flow, connection management
├── mtprotoCollector.ts    # Subscribe to channels, receive messages, post CPJ
├── mtprotoToCpj.ts        # Convert Telegram messages to CPJ v0.1
└── mtprotoState.ts        # Track last-seen message IDs per channel
```

### Library Choice: gramJS (telegram npm package)

**Chosen:** `telegram@2.26.22` (gramJS)

**Rationale:**
- ✅ Official MTProto implementation for Node.js
- ✅ ESM compatible (works with AFI's ESM-first setup)
- ✅ TypeScript support with full type definitions
- ✅ Active maintenance and community support
- ✅ Handles session persistence, flood waits, reconnection
- ✅ Works in both Node.js and browsers

**Alternatives Considered:**
- TDLib: Too heavy, requires native bindings
- mtproto-core: Lower-level, more complex
- Direct API calls: Too much boilerplate

---

## Implementation Details

### A) Authentication & Session Management

**mtprotoClient.ts:**
- Uses `StringSession` for session persistence
- First run prompts for phone code and 2FA password (if enabled)
- Session saved to `AFI_TELEGRAM_MTPROTO_SESSION_PATH` (default: `./.secrets/telegram.session`)
- Subsequent runs reuse session (no prompts)
- Supports Docker volume mounting for session persistence

**Environment Variables:**
```bash
AFI_TELEGRAM_MTPROTO_API_ID=12345678
AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
AFI_TELEGRAM_MTPROTO_SESSION_PATH=./.secrets/telegram.session
```

### B) Message Collection

**mtprotoCollector.ts:**
- Resolves channels by username or numeric ID
- Subscribes to `NewMessage` events for real-time updates
- Optional history fetch on startup (`AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=1`)
- Throttling between joins/fetches (`AFI_TELEGRAM_MTPROTO_THROTTLE_MS`)
- Graceful error handling (logs and continues on failures)

**Environment Variables:**
```bash
AFI_TELEGRAM_MTPROTO_ENABLED=1
AFI_TELEGRAM_MTPROTO_CHANNELS=@channel1,@channel2
AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=0
AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT=50
AFI_TELEGRAM_MTPROTO_THROTTLE_MS=500
```

### C) CPJ Conversion

**mtprotoToCpj.ts:**
- Converts Telegram `Api.Message` to CPJ v0.1
- Uses same regex patterns as Bot API parser for consistency
- Minimal parsing (symbol, side, entry, SL, TP, leverage, timeframe)
- Confidence scoring (0.5 base + field bonuses)
- Provenance includes channel ID, message ID, timestamp

**CPJ Mapping:**
```typescript
{
  schema: "afi.cpj.v0.1",
  provenance: {
    providerType: "telegram",
    providerId: "telegram-mtproto-{channelId}",
    messageId: "msg-{messageId}",
    postedAt: "{ISO timestamp}",
    rawText: "{message text}",
    channelName: "{username or channel-{id}}"
  },
  extracted: { symbolRaw, side, entry, stopLoss, takeProfits, ... },
  parse: {
    parserId: "telegram-mtproto-raw",
    parserVersion: "1.0.0",
    confidence: 0.0-1.0
  }
}
```

### D) State Persistence

**mtprotoState.ts:**
- Tracks last-seen message ID per channel
- Stored in JSON file at `AFI_TELEGRAM_MTPROTO_STATE_PATH`
- On restart, skips messages ≤ last-seen (unless `FETCH_HISTORY=1`)
- Prevents re-processing old messages
- Works alongside server-side ingest dedupe

**State File Format:**
```json
{
  "channels": {
    "channel-123": {
      "lastMessageId": 54321,
      "lastUpdated": "2024-12-16T12:00:00Z"
    }
  }
}
```

### E) Flood-Wait & Rate Limiting

**Safety Features:**
- Throttle delay between channel joins (`THROTTLE_MS`)
- Throttle delay between history fetches
- GramJS handles flood-wait errors automatically (backoff and retry)
- Structured logging for backoff events

**Recommended Defaults:**
```bash
AFI_TELEGRAM_MTPROTO_THROTTLE_MS=1000  # 1 second between operations
AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=0   # Don't fetch history by default
AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT=20  # Limit history if enabled
```

### F) Server Integration

**server.ts:**
- MTProto collector starts only when `AFI_TELEGRAM_MTPROTO_ENABLED=1`
- Runs in parallel with Bot API collector (both can be enabled)
- Both collectors post to same CPJ endpoint
- Server-side dedupe prevents duplicate ingestion

**Startup Flow:**
```typescript
// Bot API collector (existing)
const telegramCollector = await startTelegramCollector();

// MTProto collector (new)
const mtprotoClient = createMtprotoClientFromEnv();
if (mtprotoClient) {
  await mtprotoClient.connect();  // Prompts for login on first run
  const mtprotoCollector = await startMtprotoCollector(mtprotoClient);
}
```

---

## Files Created

### New Files (5)
- `src/collectors/telegram_mtproto/mtprotoClient.ts` - Session & auth
- `src/collectors/telegram_mtproto/mtprotoCollector.ts` - Message collection
- `src/collectors/telegram_mtproto/mtprotoToCpj.ts` - CPJ conversion
- `src/collectors/telegram_mtproto/mtprotoState.ts` - State persistence
- `scripts/telegram_mtproto_smoke.ts` - Smoke test script

### Documentation (2)
- `docs/TELEGRAM_MTPROTO_SETUP.md` - Setup guide
- `docs/TELEGRAM_MTPROTO_IMPLEMENTATION.md` - This document

### Modified Files (3)
- `src/server.ts` - Added MTProto collector startup
- `docs/CPJ_COLLECTORS.md` - Added MTProto section
- `package.json` - Added `test:mtproto:smoke` script

### Dependencies Added (2)
- `telegram@2.26.22` - GramJS MTProto client
- `input` - Interactive CLI prompts for login

---

## Testing

### Smoke Test

```bash
npm run test:mtproto:smoke
```

**Tests:**
- ✅ CPJ conversion with mock message
- ✅ CPJ structure validation
- ✅ State manager read/write/update
- ✅ Environment variable validation

**Output:**
```
✅ CPJ conversion successful
   Confidence: 1.00
   Symbol: BTCUSDT
   Side: long
   Entry: 42000
   Stop Loss: 41500
   Take Profits: 2
✅ CPJ structure validation passed
✅ State manager tests passed
```

### Integration Tests

All existing CPJ integration tests pass (13/13):
```bash
AFI_INGEST_DEDUPE=1 npm test -- integration/cpj
```

**No regressions** - Bot API collector and CPJ ingestion unchanged.

---

## Usage Examples

### Bot API Only
```bash
export AFI_TELEGRAM_ENABLED=1
export AFI_TELEGRAM_TOKEN=bot-token
export AFI_TELEGRAM_CHANNELS=@mychannel
npm run dev
```

### MTProto Only
```bash
export AFI_TELEGRAM_MTPROTO_ENABLED=1
export AFI_TELEGRAM_MTPROTO_API_ID=12345678
export AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
export AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
export AFI_TELEGRAM_MTPROTO_CHANNELS=@otherchannel
npm run dev
```

### Both Collectors
```bash
# Bot API
export AFI_TELEGRAM_ENABLED=1
export AFI_TELEGRAM_TOKEN=bot-token
export AFI_TELEGRAM_CHANNELS=@mychannel

# MTProto
export AFI_TELEGRAM_MTPROTO_ENABLED=1
export AFI_TELEGRAM_MTPROTO_API_ID=12345678
export AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
export AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
export AFI_TELEGRAM_MTPROTO_CHANNELS=@otherchannel

# Shared
export WEBHOOK_SHARED_SECRET=secret
export AFI_INGEST_DEDUPE=1

npm run dev
```

---

## Production Readiness

- ✅ All smoke tests passing
- ✅ All integration tests passing (13/13)
- ✅ No breaking changes to existing code
- ✅ ESM-compatible
- ✅ Session persistence
- ✅ State persistence
- ✅ Flood-wait handling
- ✅ Graceful error handling
- ✅ Structured logging
- ✅ Complete documentation
- ✅ Docker-ready (volume mounting)

---

## Tradeoffs & Design Decisions

### 1. GramJS vs TDLib
**Chosen:** GramJS
- ✅ Pure JavaScript (no native bindings)
- ✅ ESM compatible
- ✅ Lighter weight
- ⚠️ Less battle-tested than TDLib

### 2. Session Storage
**Chosen:** File-based StringSession
- ✅ Simple and portable
- ✅ Works in Docker with volume mounts
- ⚠️ Not encrypted (rely on file permissions)

### 3. State Persistence
**Chosen:** JSON file
- ✅ Simple and human-readable
- ✅ No database dependency
- ⚠️ Not suitable for high-volume (but fine for AFI's use case)

### 4. Parsing Strategy
**Chosen:** Minimal regex-based parsing
- ✅ Consistent with Bot API parser
- ✅ Simple and debuggable
- ⚠️ Not ML-based (could improve with training data)

---

## Next Steps (Optional Enhancements)

1. **Encrypted Session Storage** - Use keyring or encrypted files
2. **SQLite State Storage** - For higher volume or multi-instance deployments
3. **Advanced Parsing** - ML-based signal extraction
4. **Multi-Account Support** - Rotate between multiple user accounts
5. **Metrics/Monitoring** - Prometheus metrics for collector health

---

## Conclusion

The MTProto collector is **production-ready** and provides a robust alternative to the Bot API collector for monitoring public Telegram channels without admin access. It runs seamlessly alongside the existing Bot API collector with no breaking changes.

**Ready for live deployment.**

