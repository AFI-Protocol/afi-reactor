// AFI-REACTOR DEV WEBHOOK SERVER (LOCAL ONLY)
// This Express server is for local testing of DAG execution via HTTP.
// It is NOT part of the canonical orchestrator runtime, is not used by CI,
// and must not be treated as production infra or token/mint logic.
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { submitSignal } from "./submit-signal.js";

const app = express();
app.use(bodyParser.json());

app.use((req: Request, res: Response, next) => {
  console.log(`🔥 ${req.method} ${req.url}`);
  next();
});

app.post("/api/signal", submitSignal);

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Webhook listening on http://localhost:${PORT}/api/signal`);
});

export {};
