/**
 * Receipt Provenance Service (Phase 1.5)
 * 
 * Provides helpers for tracking signal minting lifecycle and on-chain receipt/token provenance.
 * 
 * This service updates the `receiptProvenance` block in TSSD vault documents to track:
 * - Mint eligibility status
 * - On-chain identifiers (epochId, receiptId, mintTxHash)
 * - Beneficiary and token/receipt amounts
 * - Error handling and retry tracking
 * 
 * Phase 1.5 Scope:
 * - Off-chain only (no on-chain calls, no Web3 provider)
 * - Schema preparation for future minting agents
 * - Graceful degradation (no-op if MongoDB unavailable)
 * 
 * @module receiptProvenanceService
 */

import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";
import { getTssdCollection } from "./tssdVaultService.js";

/**
 * Mark a signal as eligible for minting
 * 
 * Updates the signal's receiptProvenance block to indicate it has passed
 * eligibility checks (UWR score, novelty, challenge window, etc.) and is
 * ready to be minted on-chain.
 * 
 * @param signalId - Unique signal identifier
 * @param options - Optional metadata (epochId, beneficiary, reason)
 * @returns true if update succeeded, false otherwise
 */
export async function markSignalEligibleForMint(
  signalId: string,
  options?: {
    epochId?: number;
    beneficiary?: string;
    reason?: string; // Optional note for logs
  }
): Promise<boolean> {
  try {
    const collection = await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Receipt provenance update skipped: TSSD vault disabled");
      return false;
    }

    const updateDoc: any = {
      "receiptProvenance.mintStatus": "eligible",
      "receiptProvenance.mintEligibleAt": new Date(),
    };

    if (options?.epochId !== undefined) {
      updateDoc["receiptProvenance.epochId"] = options.epochId;
    }

    if (options?.beneficiary) {
      updateDoc["receiptProvenance.beneficiary"] = options.beneficiary;
    }

    const result = await collection.updateOne(
      { signalId },
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      console.warn(`⚠️  Signal not found for eligibility update: ${signalId}`);
      return false;
    }

    console.info(`✅ Signal marked eligible for mint: ${signalId}`, options?.reason ? `(${options.reason})` : "");
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to mark signal eligible:`, {
      signalId,
      error: error.message || String(error),
    });
    return false;
  }
}

/**
 * Mark a signal as successfully minted on-chain
 * 
 * Updates the signal's receiptProvenance block with full on-chain metadata
 * from the MintCoordinated event (epochId, receiptId, mintTxHash, etc.).
 * 
 * @param signalId - Unique signal identifier
 * @param params - On-chain mint metadata
 * @returns true if update succeeded, false otherwise
 */
export async function markSignalMinted(
  signalId: string,
  params: {
    epochId: number;
    receiptId: string;
    mintTxHash: string;
    mintBlockNumber?: number;
    beneficiary: string;
    tokenAmount: string;
    receiptAmount: number;
  }
): Promise<boolean> {
  try {
    const collection = await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Receipt provenance update skipped: TSSD vault disabled");
      return false;
    }

    const updateDoc = {
      "receiptProvenance.mintStatus": "minted",
      "receiptProvenance.mintedAt": new Date(),
      "receiptProvenance.epochId": params.epochId,
      "receiptProvenance.receiptId": params.receiptId,
      "receiptProvenance.mintTxHash": params.mintTxHash,
      "receiptProvenance.beneficiary": params.beneficiary,
      "receiptProvenance.tokenAmount": params.tokenAmount,
      "receiptProvenance.receiptAmount": params.receiptAmount,
    };

    if (params.mintBlockNumber !== undefined) {
      (updateDoc as any)["receiptProvenance.mintBlockNumber"] = params.mintBlockNumber;
    }

    const result = await collection.updateOne(
      { signalId },
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      console.warn(`⚠️  Signal not found for mint update: ${signalId}`);
      return false;
    }

    console.info(`✅ Signal marked as minted: ${signalId}`, {
      epochId: params.epochId,
      receiptId: params.receiptId,
      mintTxHash: params.mintTxHash,
    });
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to mark signal minted:`, {
      signalId,
      error: error.message || String(error),
    });
    return false;
  }
}

/**
 * Mark a signal mint as failed
 *
 * Updates the signal's receiptProvenance block to indicate the mint attempt
 * failed, stores the error message, and increments the retry counter.
 *
 * @param signalId - Unique signal identifier
 * @param errorMessage - Error message describing the failure
 * @returns true if update succeeded, false otherwise
 */
export async function markSignalMintFailed(
  signalId: string,
  errorMessage: string
): Promise<boolean> {
  try {
    const collection = await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Receipt provenance update skipped: TSSD vault disabled");
      return false;
    }

    const updateDoc = {
      "receiptProvenance.mintStatus": "failed",
      "receiptProvenance.mintAttemptedAt": new Date(),
      "receiptProvenance.mintError": errorMessage,
    };

    const result = await collection.updateOne(
      { signalId },
      {
        $set: updateDoc,
        $inc: { "receiptProvenance.mintRetryCount": 1 },
      }
    );

    if (result.matchedCount === 0) {
      console.warn(`⚠️  Signal not found for mint failure update: ${signalId}`);
      return false;
    }

    console.info(`✅ Signal marked as mint failed: ${signalId}`, { error: errorMessage });
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to mark signal mint failed:`, {
      signalId,
      error: error.message || String(error),
    });
    return false;
  }
}

/**
 * Query signals by mint status
 *
 * Helper to find signals in a specific mint lifecycle state.
 * Useful for finding eligible signals to mint, or checking for failed mints.
 *
 * @param mintStatus - Mint status to filter by
 * @param limit - Maximum number of results (default: 100)
 * @returns Array of matching signal documents
 */
export async function querySignalsByMintStatus(
  mintStatus: "pending" | "eligible" | "minted" | "failed" | "ineligible",
  limit: number = 100
): Promise<TssdSignalDocument[]> {
  try {
    const collection = await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Query skipped: TSSD vault disabled");
      return [];
    }

    const results = await collection
      .find({ "receiptProvenance.mintStatus": mintStatus })
      .limit(limit)
      .toArray();

    return results as TssdSignalDocument[];
  } catch (error: any) {
    console.error(`❌ Failed to query signals by mint status:`, {
      mintStatus,
      error: error.message || String(error),
    });
    return [];
  }
}

/**
 * Check if a signal has already been minted
 *
 * Queries the vault to determine if a signal has already been minted on-chain.
 * Useful for idempotency checks before attempting to mint.
 *
 * @param signalId - Unique signal identifier
 * @returns true if signal has been minted, false otherwise
 */
export async function isSignalAlreadyMinted(signalId: string): Promise<boolean> {
  try {
    const collection = await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Query skipped: TSSD vault disabled");
      return false;
    }

    const result = await collection.findOne({
      signalId,
      "receiptProvenance.mintStatus": "minted",
    });

    return result !== null;
  } catch (error: any) {
    console.error(`❌ Failed to check if signal already minted:`, {
      signalId,
      error: error.message || String(error),
    });
    return false;
  }
}

