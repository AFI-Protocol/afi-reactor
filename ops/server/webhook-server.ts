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