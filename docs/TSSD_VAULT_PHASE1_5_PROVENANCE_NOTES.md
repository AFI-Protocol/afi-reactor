# T.S.S.D. Vault Phase 1.5 — Receipt Provenance Tracking

**Date**: 2025-12-07  
**Phase**: 1.5 (Schema Extension)  
**Status**: Complete  
**Scope**: Off-chain only (no on-chain minting)

---

## Overview

Phase 1.5 extends the T.S.S.D. Vault schema to track **receipt provenance** — the lifecycle of signal minting and on-chain receipt/token issuance.

This phase prepares the vault for future integration with AFI's on-chain minting architecture (AFIToken, AFISignalReceipt, AFIMintCoordinator) without implementing any on-chain calls.

**Key Deliverables**:
- ✅ Extended `TssdSignalDocument` schema with optional `receiptProvenance` block
- ✅ Helper functions for updating provenance metadata
- ✅ Backward-compatible (existing Phase 1 documents remain valid)
- ✅ Graceful degradation (no-op if MongoDB unavailable)

---

## Schema Extension: `receiptProvenance` Block

The `TssdSignalDocument` interface now includes an optional `receiptProvenance` block:

```typescript
interface TssdSignalDocument {
  // ... existing fields (signalId, createdAt, source, market, pipeline, strategy, etc.) ...

  receiptProvenance?: {
    // Lifecycle tracking
    mintStatus: "pending" | "eligible" | "minted" | "failed" | "ineligible";
    mintEligibleAt?: Date;        // When signal became eligible for minting
    mintAttemptedAt?: Date;       // When mint was attempted
    mintedAt?: Date;              // When mint succeeded

    // On-chain identifiers (bridge keys)
    epochId?: number;             // Emissions epoch/batch number
    receiptId?: string;           // ERC-1155 receipt token ID
    mintTxHash?: string;          // Transaction hash (0x...)
    mintBlockNumber?: number;     // Block number where mint occurred

    // Beneficiary and amounts
    beneficiary?: string;         // EVM address receiving tokens/receipts
    tokenAmount?: string;         // AFI tokens minted (decimal string)
    receiptAmount?: number;       // Receipt NFTs minted (typically 1)

    // Error handling
    mintError?: string;           // Error message if mint failed
    mintRetryCount?: number;      // Number of retry attempts
  };
}
```

---

## Bridge to On-Chain: AFIMintCoordinator Event

The `receiptProvenance` block maps directly to the **`MintCoordinated`** event emitted by `AFIMintCoordinator.sol`:

```solidity
event MintCoordinated(
    bytes32 indexed signalId,   // ← Off-chain signalId (string) converted to bytes32
    uint256 indexed epochId,    // ← receiptProvenance.epochId
    address indexed beneficiary,// ← receiptProvenance.beneficiary
    uint256 tokenAmount,        // ← receiptProvenance.tokenAmount (as decimal string)
    uint256 receiptAmount       // ← receiptProvenance.receiptAmount
);
```

**Bridge Keys**:

| Off-Chain (TSSD Vault) | On-Chain (MintCoordinated Event) | Purpose |
|------------------------|----------------------------------|---------|
| `signalId` (string) | `signalId` (bytes32) | PRIMARY KEY linking signal to mint |
| `epochId` (number) | `epochId` (uint256) | Batch/epoch grouping for emissions |
| `receiptId` (string) | ERC-1155 token ID (uint256) | Receipt NFT identifier |
| `mintTxHash` (string) | Transaction hash | Immutable audit trail |
| `beneficiary` (string) | `beneficiary` (address) | Recipient of tokens/receipts |
| `tokenAmount` (string) | `tokenAmount` (uint256) | AFI tokens minted |
| `receiptAmount` (number) | `receiptAmount` (uint256) | Receipt NFTs minted |

---

## Mint Lifecycle States

The `mintStatus` field tracks the signal's position in the minting lifecycle:

| Status | Description | Typical Transitions |
|--------|-------------|---------------------|
| `pending` | Signal created, not yet evaluated for minting | → `eligible` or `ineligible` |
| `eligible` | Signal passed eligibility checks (UWR score, novelty, challenge window) | → `minted` or `failed` |
| `minted` | Signal successfully minted on-chain | (terminal state) |
| `failed` | Mint attempt failed (e.g., gas error, contract revert) | → `eligible` (retry) or `ineligible` |
| `ineligible` | Signal does not meet minting criteria | (terminal state) |

---

## Helper Functions

Phase 1.5 provides helper functions in `src/services/receiptProvenanceService.ts`:

### 1. `markSignalEligibleForMint(signalId, options?)`

Marks a signal as eligible for minting after passing eligibility checks.

```typescript
await markSignalEligibleForMint("alpha-1733515200000", {
  epochId: 5,
  beneficiary: "0x1234567890123456789012345678901234567890",
  reason: "UWR score 0.92, novelty high",
});
```

**Updates**:
- `mintStatus` → `"eligible"`
- `mintEligibleAt` → current timestamp
- `epochId` (optional)
- `beneficiary` (optional)

---

### 2. `markSignalMinted(signalId, params)`

Marks a signal as successfully minted on-chain with full provenance metadata.

```typescript
await markSignalMinted("alpha-1733515200000", {
  epochId: 5,
  receiptId: "42",
  mintTxHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  mintBlockNumber: 12345678,
  beneficiary: "0x1234567890123456789012345678901234567890",
  tokenAmount: "1000.0",
  receiptAmount: 1,
});
```

**Updates**:
- `mintStatus` → `"minted"`
- `mintedAt` → current timestamp
- All on-chain identifiers (epochId, receiptId, mintTxHash, etc.)

---

### 3. `markSignalMintFailed(signalId, errorMessage)`

Marks a signal mint as failed and increments the retry counter.

```typescript
await markSignalMintFailed("alpha-1733515200000", "Insufficient gas");
```

**Updates**:
- `mintStatus` → `"failed"`
- `mintAttemptedAt` → current timestamp
- `mintError` → error message
- `mintRetryCount` → incremented by 1

---

### 4. `querySignalsByMintStatus(mintStatus, limit?)`

Queries signals by mint status (useful for finding eligible signals to mint).

```typescript
const eligibleSignals = await querySignalsByMintStatus("eligible", 50);
```

---

### 5. `isSignalAlreadyMinted(signalId)`

Checks if a signal has already been minted (idempotency check).

```typescript
const alreadyMinted = await isSignalAlreadyMinted("alpha-1733515200000");
if (alreadyMinted) {
  console.log("Signal already minted, skipping...");
}
```

---

## Example: TSSD Document Before and After Minting

### Before Minting (Phase 1)

```json
{
  "signalId": "alpha-1733515200000",
  "createdAt": "2025-12-07T10:00:00.000Z",
  "source": "afi-eliza-demo",
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
  },
  "pipeline": {
    "uwrScore": 0.92,
    "validatorDecision": {
      "decision": "approve",
      "uwrConfidence": 0.95
    },
    "execution": {
      "status": "simulated",
      "type": "buy",
      "timestamp": "2025-12-07T10:00:30.000Z"
    }
  },
  "strategy": {
    "name": "froggy_trend_pullback_v1",
    "direction": "long"
  },
  "version": "v0.1"
}
```

### After Minting (Phase 1.5+)

```json
{
  "signalId": "alpha-1733515200000",
  "createdAt": "2025-12-07T10:00:00.000Z",
  "source": "afi-eliza-demo",
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h"
  },
  "pipeline": {
    "uwrScore": 0.92,
    "validatorDecision": {
      "decision": "approve",
      "uwrConfidence": 0.95
    },
    "execution": {
      "status": "simulated",
      "type": "buy",
      "timestamp": "2025-12-07T10:00:30.000Z"
    }
  },
  "strategy": {
    "name": "froggy_trend_pullback_v1",
    "direction": "long"
  },
  "receiptProvenance": {
    "mintStatus": "minted",
    "mintEligibleAt": "2025-12-07T10:05:00.000Z",
    "mintAttemptedAt": "2025-12-07T10:10:00.000Z",
    "mintedAt": "2025-12-07T10:10:15.000Z",
    "epochId": 5,
    "receiptId": "42",
    "mintTxHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "mintBlockNumber": 12345678,
    "beneficiary": "0x1234567890123456789012345678901234567890",
    "tokenAmount": "1000.0",
    "receiptAmount": 1
  },
  "version": "v0.1"
}
```

---

## Backward Compatibility

Phase 1.5 is **fully backward-compatible** with Phase 1:

- ✅ `receiptProvenance` is **optional** (existing documents without it remain valid)
- ✅ All Phase 1 queries and operations continue to work
- ✅ No breaking changes to existing code
- ✅ Graceful degradation (helpers return `false` if MongoDB unavailable)

---

## Out of Scope (Phase 1.5)

Phase 1.5 does **NOT** include:

- ❌ On-chain minting (no Web3 provider, no transaction signing)
- ❌ Event indexing (listening for `MintCoordinated` events)
- ❌ Automatic eligibility checks (UWR thresholds, novelty, challenge windows)
- ❌ Receipt ID generation strategy (caller chooses IDs)
- ❌ Epoch pulse integration (emissions scheduling)

These features are planned for **Phase 2+** (on-chain integration).

---

## Next Steps (Phase 2+)

Future phases will build on this foundation:

1. **Event Indexer** — Listen for `MintCoordinated` events and update vault
2. **Eligibility Agent** — Query vault for approved signals and mark as eligible
3. **Minting Agent** — Construct `MintRequest` and call `AFIMintCoordinator.mintForSignal()`
4. **Receipt ID Strategy** — Define and implement receipt ID generation (sequential, hash-based, or composite)
5. **Epoch Pulse Integration** — Coordinate with governance for emissions scheduling

---

## Testing

Run tests with:

```bash
npm test -- receiptProvenanceService.test.ts
```

All tests should pass, validating:
- ✅ Type safety for `receiptProvenance` block
- ✅ Backward compatibility (documents without provenance)
- ✅ All mint status values
- ✅ Update structure for helper functions

---

**End of Phase 1.5 Documentation**

