# T.S.S.D. Vault MongoDB Setup (Phase 1)

**Date**: 2025-12-07  
**Status**: Phase 1 — Basic Persistence Only  
**Purpose**: Persist scored + validated signals from AFI Eliza Demo pipeline to MongoDB

---

## 1. Overview

The **T.S.S.D. (Time-Series Signal Data) Vault** is a MongoDB-based persistence layer for storing final pipeline results from the AFI Eliza Demo.

**What it does**:
- ✅ Stores signal ID, UWR score, validator decision, execution status, and stage summaries
- ✅ Time-series optimized document structure
- ✅ Graceful degradation (if MongoDB unavailable, logs error but doesn't crash)
- ✅ Adds `vaultWrite` status to endpoint response

**What it does NOT do** (Phase 1):
- ❌ NO replay logic (Phase 2+)
- ❌ NO complex querying or analytics (Phase 2+)
- ❌ NO real-time dashboards (Phase 2+)

---

## 2. Required Environment Variables

Add these to your `.env` file (copy from `.env.example`):

```bash
# MongoDB connection URI (Atlas or local)
AFI_MONGO_URI="mongodb+srv://afi_app:<password>@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority&appName=AFI"

# Database name
AFI_MONGO_DB_NAME="afi"

# Collection name for TSSD signals
AFI_MONGO_COLLECTION_TSSD="tssd_signals"
```

**Important**:
- Replace `<password>` with your actual MongoDB password
- If `AFI_MONGO_URI` is NOT set, vault is disabled (graceful degradation)
- DO NOT commit `.env` to version control

---

## 3. MongoDB Atlas Setup

### Step 1: Create a MongoDB Atlas Account

1. Go to [https://www.mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up or log in
3. Create a new project (e.g., "AFI")

### Step 2: Create a Cluster

1. Click "Build a Database"
2. Choose **M0 Free Tier** (sufficient for Phase 1)
3. Select a cloud provider and region (e.g., AWS, us-east-1)
4. Name your cluster (e.g., "AFI-Cluster")
5. Click "Create"

### Step 3: Create a Database User

1. Go to **Database Access** (left sidebar)
2. Click "Add New Database User"
3. Username: `afi_app` (or your choice)
4. Password: Generate a secure password (save it!)
5. Database User Privileges: **Read and write to any database**
6. Click "Add User"

### Step 4: Configure Network Access

1. Go to **Network Access** (left sidebar)
2. Click "Add IP Address"
3. Option A: **Allow Access from Anywhere** (0.0.0.0/0) — for dev/demo only
4. Option B: **Add Your Current IP Address** — more secure
5. Click "Confirm"

### Step 5: Get Connection String

1. Go to **Database** (left sidebar)
2. Click "Connect" on your cluster
3. Choose "Drivers"
4. Select "Node.js" and version "6.0 or later"
5. Copy the connection string:

   ```
   mongodb+srv://afi_app:<password>@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority&appName=AFI
   ```

6. Replace `<password>` with your actual password
7. Add this to your `.env` file as `AFI_MONGO_URI`

### Step 6: Create Database and Collection (Optional)

MongoDB will auto-create the database and collection on first insert, but you can create them manually:

1. Go to **Database** → **Browse Collections**
2. Click "Add My Own Data"
3. Database name: `afi`
4. Collection name: `tssd_signals`
5. Click "Create"

---

## 4. Local MongoDB Setup (Alternative)

If you prefer to run MongoDB locally:

### Install MongoDB

```bash
# macOS (Homebrew)
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB
brew services start mongodb-community
```

### Configure Environment

```bash
# .env
AFI_MONGO_URI="mongodb://localhost:27017"
AFI_MONGO_DB_NAME="afi"
AFI_MONGO_COLLECTION_TSSD="tssd_signals"
```

---

## 5. Document Schema

### Example Document

```json
{
  "signalId": "alpha-1733515200000",
  "createdAt": "2025-12-07T12:00:00.000Z",
  "source": "afi-eliza-demo",
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "market": "spot"
  },
  "pipeline": {
    "uwrScore": 0.75,
    "validatorDecision": {
      "decision": "approve",
      "uwrConfidence": 0.78,
      "reasonCodes": ["score-high"]
    },
    "execution": {
      "status": "simulated",
      "type": "buy",
      "asset": "BTC/USDT",
      "amount": 0.1,
      "simulatedPrice": 67500,
      "timestamp": "2025-12-07T12:00:00.000Z",
      "notes": "Simulated BUY based on validator approval"
    },
    "stageSummaries": [ ... ]
  },
  "strategy": {
    "name": "froggy_trend_pullback_v1",
    "direction": "long"
  },
  "rawPayload": { ... },
  "version": "v0.1"
}
```

---

## 6. Testing the Vault

### Start AFI Reactor with Vault Enabled

```bash
cd /Users/secretservice/AFI_Modular_Repos/afi-reactor
npm run build
npm run start:demo
```

### Run AFI Eliza Demo

```bash
curl -X POST http://localhost:8080/demo/afi-eliza-demo \
  -H "Content-Type: application/json"
```

### Check Response

Look for `vaultWrite` field in the response:

```json
{
  "signalId": "alpha-1733515200000",
  "validatorDecision": { ... },
  "execution": { ... },
  "vaultWrite": "success"  // ← Should be "success" if MongoDB is configured
}
```

### Verify in MongoDB

**Atlas**:
1. Go to **Database** → **Browse Collections**
2. Select `afi` database → `tssd_signals` collection
3. You should see the inserted document

**Local**:
```bash
mongosh
use afi
db.tssd_signals.find().pretty()
```

---

## 7. Troubleshooting

### `vaultWrite: "skipped"`

**Cause**: `AFI_MONGO_URI` is not set  
**Solution**: Add `AFI_MONGO_URI` to your `.env` file

### `vaultWrite: "failed"`

**Cause**: MongoDB connection failed or insert failed  
**Solution**: Check server logs for error details

**Common issues**:
- Incorrect password in connection string
- IP address not whitelisted in Atlas Network Access
- MongoDB server not running (local)

### Connection Timeout

**Cause**: Network access not configured in Atlas  
**Solution**: Add your IP address to Network Access whitelist

---

## 8. Security Notes

⚠️ **DEV/DEMO ONLY**:
- This setup is for development and demo purposes only
- No PII (Personally Identifiable Information) is stored
- No real-money trades are executed
- All execution is simulated

**Production Considerations** (Phase 2+):
- Use MongoDB Atlas with proper authentication
- Restrict network access to specific IPs
- Enable encryption at rest and in transit
- Implement proper backup and disaster recovery
- Add monitoring and alerting

---

**End of Setup Notes**

