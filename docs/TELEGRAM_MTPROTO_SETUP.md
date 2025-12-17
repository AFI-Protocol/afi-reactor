# Telegram MTProto Collector Setup Guide

## Overview

The MTProto collector uses Telegram's user-client API (via gramJS) to read messages from public channels **without requiring admin rights or bot permissions**.

This is different from the Bot API collector which requires:
- Creating a bot via @BotFather
- Adding the bot as admin to channels

**Use MTProto when:**
- You want to monitor public channels you don't control
- You don't have admin access to add a bot
- You need to read channel history

**Use Bot API when:**
- You control the channels and can add a bot as admin
- You prefer simpler setup (no phone number login)
- You don't need historical messages

---

## Prerequisites

### 1. Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Log in with your phone number
3. Click "API development tools"
4. Create a new application:
   - App title: `AFI Reactor MTProto Collector`
   - Short name: `afi-reactor`
   - Platform: `Other`
5. Save your **API ID** and **API Hash**

### 2. Prepare Phone Number

You'll need a Telegram account (phone number) that will be used to log in as a user-client.

**Important:**
- This should be a dedicated account (not your personal Telegram)
- The account must be able to access the channels you want to monitor
- For public channels, any account works
- For private channels, the account must be a member

---

## Environment Variables

```bash
# Enable MTProto collector
AFI_TELEGRAM_MTPROTO_ENABLED=1

# API credentials from my.telegram.org
AFI_TELEGRAM_MTPROTO_API_ID=12345678
AFI_TELEGRAM_MTPROTO_API_HASH=abcdef1234567890abcdef1234567890

# Phone number with country code (e.g., +1234567890)
AFI_TELEGRAM_MTPROTO_PHONE=+1234567890

# Comma-separated list of channels to monitor
# Can use @username for public channels or numeric IDs for private channels
AFI_TELEGRAM_MTPROTO_CHANNELS=@cryptosignals,@tradingalerts

# Session file path (will be created on first login)
AFI_TELEGRAM_MTPROTO_SESSION_PATH=./.secrets/telegram.session

# State file path (tracks last-seen message IDs)
AFI_TELEGRAM_MTPROTO_STATE_PATH=./.secrets/telegram_mtproto.state.json

# Fetch historical messages on startup (default: 0)
AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=0

# Max historical messages to fetch (only if FETCH_HISTORY=1)
AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT=50

# Throttle delay for joins/fetches (milliseconds, default: 500)
AFI_TELEGRAM_MTPROTO_THROTTLE_MS=500

# Reuse existing env vars
AFI_CPJ_INGEST_URL=http://localhost:8080/api/ingest/cpj
WEBHOOK_SHARED_SECRET=your-secret-here
AFI_CPJ_MIN_CONFIDENCE=0.55
```

---

## First-Time Login

On first run, the collector will prompt for authentication:

```bash
cd afi-reactor

# Set environment variables
export AFI_TELEGRAM_MTPROTO_ENABLED=1
export AFI_TELEGRAM_MTPROTO_API_ID=12345678
export AFI_TELEGRAM_MTPROTO_API_HASH=your-api-hash
export AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
export AFI_TELEGRAM_MTPROTO_CHANNELS=@yourchannel
export WEBHOOK_SHARED_SECRET=your-secret

# Start reactor (will prompt for login)
npm run dev
```

**You will be prompted for:**
1. **Phone code:** Check your Telegram app for a login code
2. **2FA password:** If you have two-factor authentication enabled

**After successful login:**
- Session is saved to `AFI_TELEGRAM_MTPROTO_SESSION_PATH`
- Subsequent runs will reuse this session (no prompts)

---

## Docker Deployment

When running in Docker, you must mount the session and state directories:

```yaml
# docker-compose.yml
services:
  afi-reactor:
    image: afi-reactor:latest
    environment:
      - AFI_TELEGRAM_MTPROTO_ENABLED=1
      - AFI_TELEGRAM_MTPROTO_API_ID=${AFI_TELEGRAM_MTPROTO_API_ID}
      - AFI_TELEGRAM_MTPROTO_API_HASH=${AFI_TELEGRAM_MTPROTO_API_HASH}
      - AFI_TELEGRAM_MTPROTO_PHONE=${AFI_TELEGRAM_MTPROTO_PHONE}
      - AFI_TELEGRAM_MTPROTO_CHANNELS=${AFI_TELEGRAM_MTPROTO_CHANNELS}
      - AFI_TELEGRAM_MTPROTO_SESSION_PATH=/app/.secrets/telegram.session
      - AFI_TELEGRAM_MTPROTO_STATE_PATH=/app/.secrets/telegram_mtproto.state.json
    volumes:
      # Mount secrets directory to persist session
      - ./secrets:/app/.secrets
```

**First-time setup in Docker:**
1. Run container interactively: `docker run -it --rm -v ./secrets:/app/.secrets afi-reactor`
2. Complete login prompts
3. Session is saved to `./secrets/telegram.session`
4. Restart container normally (non-interactive)

---

## Running Both Collectors

You can run Bot API and MTProto collectors simultaneously:

```bash
# Bot API collector
export AFI_TELEGRAM_ENABLED=1
export AFI_TELEGRAM_TOKEN=bot-token
export AFI_TELEGRAM_CHANNELS=@channel1,@channel2

# MTProto collector
export AFI_TELEGRAM_MTPROTO_ENABLED=1
export AFI_TELEGRAM_MTPROTO_API_ID=12345678
export AFI_TELEGRAM_MTPROTO_API_HASH=your-hash
export AFI_TELEGRAM_MTPROTO_PHONE=+1234567890
export AFI_TELEGRAM_MTPROTO_CHANNELS=@channel3,@channel4

# Shared config
export WEBHOOK_SHARED_SECRET=your-secret
export AFI_INGEST_DEDUPE=1

npm run dev
```

Both collectors will post to the same CPJ endpoint with dedupe protection.

---

## Recommended Defaults for Safe Throttling

```bash
# Conservative throttling to avoid flood waits
AFI_TELEGRAM_MTPROTO_THROTTLE_MS=1000

# Don't fetch history by default (reduces initial load)
AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=0

# If fetching history, limit to recent messages
AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT=20
```

---

## Troubleshooting

### Problem: "FloodWaitError: A wait of X seconds is required"

**Solution:**
- Increase `AFI_TELEGRAM_MTPROTO_THROTTLE_MS` (try 2000-5000)
- Reduce `AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT`
- Wait for the specified time before restarting

### Problem: "SessionPasswordNeededError"

**Solution:**
- You have 2FA enabled
- Enter your 2FA password when prompted

### Problem: Session file not persisting in Docker

**Solution:**
- Ensure volume mount is correct: `-v ./secrets:/app/.secrets`
- Check file permissions on host directory

### Problem: "Could not find the input entity for..."

**Solution:**
- Channel username may be incorrect (check for typos)
- For private channels, use numeric ID instead of @username
- Ensure your account has access to the channel

---

## Security Notes

1. **Never commit session files to git** - Add `.secrets/` to `.gitignore`
2. **Protect API credentials** - Use environment variables, not hardcoded values
3. **Use dedicated account** - Don't use your personal Telegram account
4. **Rotate credentials** - If session is compromised, revoke it at my.telegram.org

---

## State Management

The collector tracks last-seen message IDs per channel in `AFI_TELEGRAM_MTPROTO_STATE_PATH`.

**On restart:**
- If `FETCH_HISTORY=0`: Only new messages are processed
- If `FETCH_HISTORY=1`: Fetches up to `HISTORY_LIMIT` messages, skipping already-seen ones

**To reset state:**
```bash
rm ./.secrets/telegram_mtproto.state.json
```

This will cause the collector to re-process recent messages (server-side dedupe will prevent duplicates).

