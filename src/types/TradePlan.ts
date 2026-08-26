/**
 * afi.trade-plan.v1 — the governed trade-plan contract
 * (afi-config/schemas/provenance/v1/trade-plan.schema.json), as carried on the
 * canonical USS signal at `uss.plan` by the CPJ→USS mapper (DEM-GOV §9
 * DEM-PRODUCER-PLAN, owner-authorized 2026-08-25; determination D-4).
 *
 * NUMBER POLICY: every price/quantity is a DECIMAL STRING (`^[0-9]+(\.[0-9]+)?$`),
 * never a float — the afi.hash.v1 input-hash law rejects raw non-integers, and
 * the contract fixes strings. The runtime validates the block against the
 * governed schema (validateTradePlanV1) at ingest; the technical lane verifies
 * the LEVELS against the candles it fetched before any of them becomes a fact
 * (D-DEM-5(6)).
 */
export interface TradePlanTakeProfitV1 {
  price: string;
  sizePct?: string;
}

export interface TradePlanPriceRangeV1 {
  min: string;
  max: string;
}

export interface TradePlanLevelsV1 {
  entry: string | TradePlanPriceRangeV1;
  stopLoss?: string;
  takeProfits?: TradePlanTakeProfitV1[];
}

export interface TradePlanV1 {
  schema: "afi.trade-plan.v1";
  signalId?: string;
  levels: TradePlanLevelsV1;
  leverageHint?: string;
  venueHint?: string;
  marketTypeHint?: "spot" | "perp" | "futures";
  notes?: string;
}

/**
 * The technical lane's VERIFIED plan facts (`technical.plan` on the lens
 * payload; projected verbatim into the enriched view). Every price here was
 * checked against the fetched candle window (tradePlanVerification.ts); a
 * plan that cannot be checked never produces this block — the determination
 * refuses instead (D-DEM-5(6)).
 *
 * Declared producer absences (D-DEM-5(4)(b), recorded in the technical
 * plugin manifest's description): the whole block is absent when the signal
 * carries no plan; `stopPrice` / `firstTargetPrice` / `rrToFirstTarget` are
 * absent when the plan carries no stop or no target (no R:R claim to
 * verify); `entryPrice` is absent for an entry RANGE whose conservative bound
 * cannot be chosen (no stop/target geometry).
 */
export interface TechnicalPlanFacts {
  /** Lower / upper submitted entry bound (equal for a single entry price). */
  entryLow: number;
  entryHigh: number;
  /** The entry price the R:R is computed at: the submitted price, or for a
   *  range the CONSERVATIVE bound (nearest the targets — smallest reward,
   *  largest risk). */
  entryPrice?: number;
  stopPrice?: number;
  /** The submitted target nearest the entry. */
  firstTargetPrice?: number;
  /** Number of submitted take-profit targets. */
  targetCount: number;
  /** |firstTarget − entry| / |entry − stop|, rounded half-up to 4 decimals. */
  rrToFirstTarget?: number;
  /** The verification band's source: the fetched window's extreme low/high. */
  envelopeLow: number;
  envelopeHigh: number;
  /** Fetched candles the envelope was computed over. */
  barCount: number;
}
