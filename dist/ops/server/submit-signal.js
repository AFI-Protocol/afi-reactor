import { runDAG } from "../../core/dag-engine.js";
export async function submitSignal(req, res) {
    try {
        const body = req.body;
        if (!body || typeof body !== "object") {
            return res.status(400).json({ error: "Invalid signal payload" });
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
        return res.status(200).json({
            status: "ok",
            enrichedSignal: result,
        });
    }
    catch (err) {
        console.error(`❌ Error in signal submission: ${err.message}`);
        return res.status(500).json({ error: "Internal server error" });
    }
}
//# sourceMappingURL=submit-signal.js.map