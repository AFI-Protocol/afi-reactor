import type { Request, Response } from "express";
import { runDAG } from "../../core/dag-engine.js";

interface IncomingSignal {
  signalId?: string;
  score?: number;
  confidence?: number;
  timestamp?: string;
  meta?: Record<string, any>;
}

export async function submitSignal(req: Request, res: Response) {
  try {
    const body = req.body as IncomingSignal;

    if (!body || typeof body !== "object") {
      return (res as any).status(400).json({ error: "Invalid signal payload" });
    }

    const signal = {
      signalId: body.signalId ?? `api-signal-${Date.now()}`,
      score: body.score ?? Math.random(),
      confidence: body.confidence ?? 0.9,
      timestamp: new Date().toISOString(),
      meta: body.meta ?? { source: "webhook" },
    };

    console.log(`📨 Incoming Signal:\n`, signal);

    const result = await runDAG("signal-to-vault", signal);

    console.log(`✅ DAG execution complete. Signal enriched:\n`, result);

    return (res as any).status(200).json({
      status: "ok",
      enrichedSignal: result,
    });
  } catch (err: any) {
    console.error(`❌ Error in signal submission: ${err.message}`);
    return (res as any).status(500).json({ error: "Internal server error" });
  }
}