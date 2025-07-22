#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const registryPath = "config/execution-agent.registry.json";

async function main() {
  const args = process.argv.slice(2);
  const [agentName, signalFile] = args;

  if (!agentName || !signalFile) {
    console.error("❌ Usage: npx tsx cli/afi/commands/afi-execute-command.ts <agent> <signalFile>");
    process.exit(1);
  }

  if (!fs.existsSync(registryPath)) {
    console.error(`❌ Registry not found at ${registryPath}`);
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const agent = registry[agentName];

  if (!agent) {
    console.error(`❌ No agent found in registry for: ${agentName}`);
    process.exit(1);
  }

  if (agent.auth === "env") {
    if (!process.env.API_KEY || !process.env.API_SECRET) {
      console.warn("⚠️ This agent requires API keys. Have you set your .env file securely?");
    }
  }

  const agentPath = path.resolve(agent.entry);
  const { execute } = await import(agentPath);

  if (!fs.existsSync(signalFile)) {
    console.error(`❌ Signal file not found: ${signalFile}`);
    process.exit(1);
  }

  const signal = JSON.parse(fs.readFileSync(signalFile, "utf-8"));
  console.log("📡 Dispatching to agent:", agentName);
  const result = await execute(signal);
  console.log("✅ Execution result:", result);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
