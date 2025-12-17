# CPJ Collectors - Telegram/Discord Signal Ingestion

## Overview

CPJ collectors monitor third-party messaging platforms (Telegram, Discord) for trading signals and automatically post them to the AFI Reactor CPJ ingestion endpoint.

**Flow:**
```
Telegram/Discord Channel
  ↓
Collector (polls for new messages)
  ↓
Parser (extracts signal fields → CPJ v0.1)
  ↓
POST /api/ingest/cpj (with shared secret)
  ↓
AFI Reactor Pipeline
```

---

## Telegram Collector

### Prerequisites

1. **Create a Telegram Bot:**
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Send `/newbot` and follow instructions
   - Save the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. **Add Bot to Channels:**
   - Add your bot as an administrator to the channels you want to monitor
   - The bot needs permission to read messages

3. **Get Channel IDs:**
   - For public channels: use `@channelname` format
   - For private channels: use numeric ID (e.g., `-1001234567890`)
   - To find numeric IDs, forward a message from the channel to [@userinfobot](https://t.me/userinfobot)

### Environment Variables

```bash
# Enable Telegram collector
AFI_TELEGRAM_ENABLED=1

# Bot token from @BotFather
AFI_TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Comma-separated list of channels to monitor
# Can use @username for public channels or numeric IDs for private channels
AFI_TELEGRAM_CHANNELS=@cryptosignals,@tradingalerts,-1001234567890

# Poll interval in milliseconds (default: 5000 = 5 seconds)
AFI_TELEGRAM_POLL_INTERVAL_MS=5000

# CPJ ingestion endpoint URL (default: http://localhost:8080/api/ingest/cpj)
AFI_CPJ_INGEST_URL=http://localhost:8080/api/ingest/cpj

# Shared secret for webhook authentication (must match reactor config)
WEBHOOK_SHARED_SECRET=your-secret-here

# Minimum confidence threshold (0.0-1.0, default: 0.55)
# Signals below this confidence are skipped
AFI_CPJ_MIN_CONFIDENCE=0.55
```

### Running Locally

```bash
cd afi-reactor

# Set environment variables
export AFI_TELEGRAM_ENABLED=1
export AFI_TELEGRAM_TOKEN=your-bot-token
export AFI_TELEGRAM_CHANNELS=@yourchannel
export WEBHOOK_SHARED_SECRET=your-secret

# Start reactor (collector starts automatically)
npm run dev
```

### Supported Signal Formats

The parser recognizes common trading signal formats:

**Cornix-style:**
```
🚀 BTC LONG SIGNAL

Symbol: BTCUSDT
Entry: 42000-42500
Stop Loss: 41500
Take Profit 1: 43000
Take Profit 2: 44000
Leverage: 5x
```

**Simple format:**
```
BTC LONG @ 42000
SL: 41500
TP: 43000
```

**Structured format:**
```
PAIR: ETH/USDT
DIRECTION: LONG
ENTRY: 2200
STOP LOSS: 2150
TAKE PROFIT: 2300
```

### Confidence Scoring

The parser calculates a confidence score (0.0-1.0) based on extracted fields:

- **Base score:** 0.5 (symbol + side detected)
- **+0.15:** Entry price found
- **+0.15:** Stop loss found
- **+0.10:** Take profit(s) found
- **+0.05:** Leverage found
- **+0.05:** Timeframe found

**Example:**
- Symbol + Side only: 0.50 (likely skipped if min=0.55)
- Symbol + Side + Entry + SL + TP: 0.90 (high confidence)

### Logs and Observability

The collector logs structured information for each message:

```
📨 New message from Crypto Signals Pro: { messageId: 12345, text: 'BTC LONG...' }
   ✅ Ingested: { signalId: 'cpj-telegram-...', ingestHash: 'abc123...', decision: 'approve' }
```

**Log Prefixes:**
- `📨` - New message received
- `✅` - Successfully ingested
- `⚠️` - Duplicate detected (409)
- `❌` - Error (422 symbol normalization, 400 invalid CPJ, etc.)
- `⏭️` - Skipped (low confidence, missing fields, etc.)

### Troubleshooting

**Problem:** Collector not receiving messages

- ✅ Check bot is added to channel as administrator
- ✅ Check channel ID/username is correct in `AFI_TELEGRAM_CHANNELS`
- ✅ Check bot token is valid
- ✅ Check bot has permission to read messages

**Problem:** All signals skipped (low confidence)

- ✅ Lower `AFI_CPJ_MIN_CONFIDENCE` (e.g., 0.4)
- ✅ Check signal format matches supported patterns
- ✅ Check logs for parse reason: `⏭️ Skipped: Missing required fields (symbol or side)`

**Problem:** 422 Symbol normalization failed

- ✅ Check symbol format in message (e.g., `BTCUSDT`, `BTC/USDT`, `BTC-USD`)
- ✅ Check logs for `symbolRaw` and `reason`
- ✅ Exotic symbols may need manual mapping

**Problem:** 401 Unauthorized

- ✅ Check `WEBHOOK_SHARED_SECRET` matches between collector and reactor
- ✅ Check reactor is running and accessible at `AFI_CPJ_INGEST_URL`

**Problem:** 409 Duplicate

- ✅ This is normal! Dedupe is working correctly
- ✅ Same message posted twice will be rejected
- ✅ Check `AFI_INGEST_DEDUPE=1` is set on reactor

---

## Telegram MTProto Collector (User-Client)

### Overview

The MTProto collector uses Telegram's user-client API (via gramJS) to read messages from public channels **without requiring admin rights or bot permissions**.

**Key Differences from Bot API:**

| Feature | Bot API Collector | MTProto Collector |
|---------|------------------|-------------------|
| **Authentication** | Bot token from @BotFather | Phone number + API credentials |
| **Channel Access** | Requires admin rights | Can read any public channel |
| **History** | Limited | Can fetch full history |
| **Setup Complexity** | Simple | Moderate (requires login) |
| **Use Case** | Channels you control | Channels you monitor |

### When to Use MTProto

✅ **Use MTProto when:**
- You want to monitor public channels you don't control
- You don't have admin access to add a bot
- You need to read channel history

❌ **Use Bot API when:**
- You control the channels and can add a bot as admin
- You prefer simpler setup (no phone number login)
- You don't need historical messages

### Setup

See **[TELEGRAM_MTPROTO_SETUP.md](./TELEGRAM_MTPROTO_SETUP.md)** for detailed setup instructions.

**Quick Start:**

1. Get API credentials from https://my.telegram.org
2. Set environment variables:
   ```bash
   AFI_TELEGRAM_MTPROTO_ENABLED=1
   AFI_TELEGRAM_MTPROTO_API_ID=12345678
   AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
   AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
   AFI_TELEGRAM_MTPROTO_CHANNELS=@channel1,@channel2
   ```
3. Run `npm run dev` and complete login prompts
4. Session is saved for future runs

### Running Both Collectors

You can run Bot API and MTProto collectors simultaneously:

```bash
# Bot API for channels you control
export AFI_TELEGRAM_ENABLED=1
export AFI_TELEGRAM_TOKEN=bot-token
export AFI_TELEGRAM_CHANNELS=@mychannel1

# MTProto for channels you monitor
export AFI_TELEGRAM_MTPROTO_ENABLED=1
export AFI_TELEGRAM_MTPROTO_API_ID=12345678
export AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
export AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
export AFI_TELEGRAM_MTPROTO_CHANNELS=@otherchannel1,@otherchannel2

npm run dev
```

Both collectors post to the same CPJ endpoint with dedupe protection.

---

## Discord Collector (Future)

Discord collector is planned but not yet implemented. Design will mirror Telegram:

- Use Discord.js library
- Monitor specific channels/servers
- Parse similar signal formats
- Post CPJ to same endpoint

---

## Testing Without Live Channels

You can test the collector locally by:

1. Creating a test Telegram channel
2. Adding your bot as admin
3. Posting test signals manually
4. Watching reactor logs for ingestion

**Example test signal:**
```
BTC LONG
Entry: 42000
SL: 41500
TP: 43000
```

---

## Production Deployment

For production use:

1. **Use environment variables** (never commit tokens to git)
2. **Set up monitoring** for collector health
3. **Configure dedupe** (`AFI_INGEST_DEDUPE=1`)
4. **Set appropriate confidence threshold** (0.6-0.7 recommended)
5. **Monitor 422 errors** for symbol normalization issues
6. **Use HTTPS** for `AFI_CPJ_INGEST_URL` in production

---

## Architecture Notes

- **Polling vs Webhooks:** Uses long polling (simpler, no public endpoint needed)
- **ESM Compatibility:** Uses `node-telegram-bot-api` with ESM imports
- **No State Persistence:** Collector state is in-memory (restarts from latest on reboot)
- **Graceful Degradation:** Continues on parse errors, logs and skips bad messages
- **Self-Throttling:** Respects `AFI_TELEGRAM_POLL_INTERVAL_MS` to avoid rate limits

