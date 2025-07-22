import { runDAG } from "../../core/dag-engine";
import type { IncomingMessage, ServerResponse } from "http";

export async function submitSignalHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  let body = "";
  req.on("data", chunk => (body += chunk));
  req.on("end", async () => {
    try {
      const signal = JSON.parse(body);
      const result = await runDAG("signal-to-vault", signal);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "success", result }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}