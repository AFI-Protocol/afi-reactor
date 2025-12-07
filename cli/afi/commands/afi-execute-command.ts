#!/usr/bin/env tsx
/**
 * Local/dev CLI helper to execute a single registered execution agent against a signal JSON file.
 * NOT protocol-critical runtime logic; MUST NOT perform on-chain calls directly.
 * Uses config/execution-agent.registry.json as the source of truth for agent entries.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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

  if (!agent.entry || typeof agent.entry !== "string" || agent.entry.trim().length === 0) {
    console.error(
      `❌ Invalid or missing agent entry for ${agentName} in ${registryPath}. Expected a non-empty string.`
    );
    process.exit(1);
  }

  const agentPath = path.resolve(agent.entry);
  if (!fs.existsSync(agentPath)) {
    console.error(
      `❌ Agent entry file not found for ${agentName}: ${agentPath} (check ${registryPath})`
    );
    process.exit(1);
  }

  if (agent.auth === "env") {
    if (!process.env.API_KEY || !process.env.API_SECRET) {
      console.warn("⚠️ This agent requires API keys. Have you set your .env file securely?");
    }
  }

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
