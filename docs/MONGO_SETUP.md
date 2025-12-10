# MongoDB Setup for AFI Reactor

This guide explains how to set up MongoDB for the AFI Reactor TSSD (Time-Series Signal Data) vault.

---

## Quick Start (Local MongoDB with Docker)

The fastest way to get MongoDB running locally:

```bash
# 1. Start MongoDB in Docker
docker run -d \
  --name afi-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=afi \
  mongo:7

# 2. Set environment variable
export AFI_MONGO_URI=mongodb://localhost:27017/afi

# 3. Verify connection
npm run verify:tssd:blofin
```

---

## Option 1: Local MongoDB (Docker)

### Start MongoDB

```bash
docker run -d \
  --name afi-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_DATABASE=afi \
  -v afi-mongo-data:/data/db \
  mongo:7
```

### Configure AFI Reactor

Add to `.env.local`:

```bash
AFI_MONGO_URI=mongodb://localhost:27017/afi
AFI_MONGO_DB_NAME=afi
AFI_MONGO_COLLECTION_TSSD=tssd_signals
```

### Stop/Start MongoDB

```bash
# Stop
docker stop afi-mongo

# Start
docker start afi-mongo

# Remove (WARNING: deletes all data)
docker rm -f afi-mongo
docker volume rm afi-mongo-data
```

---

## Option 2: Local MongoDB (Native Install)

### Install MongoDB

**macOS (Homebrew)**:
```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

**Ubuntu/Debian**:
```bash
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
```

### Configure AFI Reactor

Add to `.env.local`:

```bash
AFI_MONGO_URI=mongodb://localhost:27017/afi
AFI_MONGO_DB_NAME=afi
AFI_MONGO_COLLECTION_TSSD=tssd_signals
```

---

## Option 3: MongoDB Atlas (Cloud)

### Create Free Cluster

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for a free account
3. Create a new cluster (M0 Free Tier)
4. Create a database user
5. Whitelist your IP address (or use `0.0.0.0/0` for development)
6. Get your connection string

### Configure AFI Reactor

Add to `.env.local`:

```bash
AFI_MONGO_URI=mongodb+srv://username:password@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority
AFI_MONGO_DB_NAME=afi
AFI_MONGO_COLLECTION_TSSD=tssd_signals
```

**Replace**:
- `username` with your MongoDB Atlas username
- `password` with your MongoDB Atlas password
- `cluster0.abc123.mongodb.net` with your actual cluster URL

---

## Verify MongoDB Connection

After setting up MongoDB, verify the connection:

```bash
# 1. Make sure AFI_MONGO_URI is set
echo $AFI_MONGO_URI

# 2. Build the project
npm run build

# 3. Run verification script
npm run verify:tssd:blofin
```

Expected output if no signals exist yet:
```
⚠️  No BloFin-backed TSSD documents found.
```

---

## Generate Test Data

To populate the TSSD vault with BloFin-backed signals:

```bash
# 1. Set BloFin as price source
export AFI_PRICE_FEED_SOURCE=blofin

# 2. Start AFI Reactor
npm run start:demo

# 3. In another terminal, trigger a signal
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "market": "perp"
  }'

# 4. Verify the signal was written to MongoDB
npm run verify:tssd:blofin
```

Expected output:
```
✅ Found 1 BloFin-backed signal(s)

📄 Signal #1
  Signal ID:       alpha-...
  Price Source:    blofin ✅
  Venue Type:      crypto_perps ✅
```

---

## Troubleshooting

### Connection Refused

```
❌ MongoDB connection refused
```

**Solution**: Make sure MongoDB is running:
```bash
# Docker
docker ps | grep afi-mongo

# Native (macOS)
brew services list | grep mongodb

# Native (Linux)
sudo systemctl status mongod
```

### Authentication Failed

```
❌ Authentication failed
```

**Solution**: Check your credentials in `AFI_MONGO_URI`

### Database Not Found

MongoDB creates databases automatically when you first write data. If you see "database not found", it's normal - the database will be created when the first signal is written.

---

## MongoDB GUI Tools

For easier database inspection:

- **MongoDB Compass** (Official): https://www.mongodb.com/products/compass
- **Studio 3T**: https://studio3t.com/
- **Robo 3T**: https://robomongo.org/

---

## Security Notes

- **Never commit `.env.local`** to version control
- Use strong passwords for production MongoDB instances
- Restrict IP whitelist in MongoDB Atlas
- Use MongoDB authentication in production
- Consider enabling SSL/TLS for production connections

---

## Next Steps

After MongoDB is set up:

1. Run the BloFin validation: `npm run verify:tssd:blofin`
2. Check the validation report: `docs/BLOFIN_VALIDATION_REPORT.md`
3. Explore the TSSD vault schema: `src/types/TssdSignalDocument.ts`

