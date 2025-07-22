import express from "express";
import bodyParser from "body-parser";
import { submitSignal } from "./submit-signal.js"; // Adjust path as needed

const app = express();
app.use(bodyParser.json());

// Optional: log all incoming requests
app.use((req, res, next) => {
  console.log(`🔥 ${req.method} ${req.url}`);
  next();
});

app.post("/api/signal", submitSignal);

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Webhook listening on http://localhost:${PORT}/api/signal`);
});