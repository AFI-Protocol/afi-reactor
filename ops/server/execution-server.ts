import http from "http";
import { executeSignal } from "../../tools/agents/execution-agent.js"; // removed `.ts`

const port = 8081;

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/execute") {
    let body = "";

    req.on("data", chunk => (body += chunk));

    req.on("end", async () => {
      try {
        if (!body) {
          throw new Error("Empty request body");
        }

        const signal = JSON.parse(body);
        console.log("📥 Received execution signal:", signal);

        // Minimal validation
        if (!signal.signalId || typeof signal.score !== "number" || !signal.timestamp) {
          throw new Error("Missing required signal fields");
        }

        console.log("⚙️ Executing signal...");
        const result = await executeSignal(signal);
        console.log("✅ Execution result:", result);

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ status: "executed", result }));
      } catch (err) {
        console.error("❌ Error processing signal:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: String(err) }));
      }
    });

    req.on("timeout", () => {
      console.warn("⚠️ Request timed out");
      res.writeHead(408).end("Request Timeout");
    });
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

server.listen(port, () => {
  console.log(`🚦 Execution server running at http://localhost:${port}/api/execute`);
});