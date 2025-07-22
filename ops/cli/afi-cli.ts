#!/usr/bin/env tsx

import { Command } from "commander";
import { runDAG } from "../../core/dag-engine";
import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { generateSignal } from "../../tools/signal-agent"; // fallback
import agentRegistry from "../../config/agent.registry.json" assert { type: "json" };

const program = new Command();

program
  .name("afi")
  .description("AFI Protocol CLI")
  .version("0.5.0");

//
// --- SIMULATE ---
program
  .command("simulate")
  .description("Run a full mock DAG simulation")
  .option("-o, --output <filename>", "Custom output file name")
  .option("-s, --strategy <type>", "Specify strategy type", "backtest")
  .option("-d, --debug", "Enable debug logging")
  .action(async (options) => {
    const mockSignal = {
      signalId: `mock-signal-${Date.now()}`,
      score: Math.random(),
      confidence: 0.95,
      timestamp: new Date().toISOString(),
      meta: { source: "simulator", strategy: options.strategy }
    };

    if (options.debug) {
      console.log("🔬 Debug mode ON. Signal:", mockSignal);
    }

    console.log("🚀 Simulating full AFI signal pipeline...");
    const result = await runDAG("signal-to-vault", mockSignal);
    const filename = options.output || `simulation-${Date.now()}.json`;
    const filePath = path.join("tmp", filename);
    writeFileSync(filePath, JSON.stringify(result, null, 2));
    console.log(`✅ Final signal result saved to ${filePath}`);
  });

//
// --- REPLAY ---
program
  .command("replay <file>")
  .description("Replay a previously simulated signal")
  .option("-d, --debug", "Enable debug logging")
  .action(async (file, options) => {
    const filePath = path.join("tmp", file);
    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    const raw = readFileSync(filePath, "utf-8");
    const signal = JSON.parse(raw);

    if (options.debug) {
      console.log("📂 Replaying signal from file:", filePath);
      console.log("🧾 Loaded Signal:", signal);
    }

    const result = await runDAG("signal-to-vault", signal);
    const outputPath = path.join("tmp", `replay-${Date.now()}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`🔁 Replay result saved to ${outputPath}`);
  });

//
// --- SUBMIT ---
program
  .command("submit")
  .description("Submit a custom signal JSON into the pipeline")
  .option("-f, --file <path>", "Path to signal JSON file")
  .action(async (opts) => {
    let signal;

    if (opts.file) {
      if (!existsSync(opts.file)) {
        console.error(`❌ Signal file not found: ${opts.file}`);
        process.exit(1);
      }

      signal = JSON.parse(readFileSync(opts.file, "utf-8"));
    } else {
      signal = {
        signalId: `manual-${Date.now()}`,
        score: 0.5,
        confidence: 0.9,
        timestamp: new Date().toISOString(),
        meta: { source: "cli", strategy: "manual" }
      };
    }

    console.log("📨 Submitting signal...");
    const result = await runDAG("signal-to-vault", signal);
    console.log("✅ Signal processed:");
    console.dir(result, { depth: null });
  });

//
// --- AGENT SPAWN ---
program
  .command("agent <name>")
  .description("Run a registered signal agent")
  .option("-d, --debug", "Enable debug logging")
  .action(async (name, opts) => {
    const agent = agentRegistry[name];
    if (!agent) {
      console.error(`❌ Agent not found in registry: ${name}`);
      process.exit(1);
    }

    const agentPath = path.resolve(agent.entry); // handles relative paths cleanly
    if (!existsSync(agentPath)) {
      console.error(`❌ Agent script missing: ${agentPath}`);
      process.exit(1);
    }

    try {
      const module = await import(agentPath);
      const signal = module.generateSignal();

      if (opts.debug) {
        console.log("🤖 Generated signal by agent:", signal);
      }

      const result = await runDAG("signal-to-vault", signal);
      const outputPath = path.join("tmp", `agent-${name}-${Date.now()}.json`);
      writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`✅ Agent result saved to ${outputPath}`);
    } catch (err) {
      console.error(`💥 Failed to load agent: ${err.message}`);
      process.exit(1);
    }
  });

//
// --- AGENTS LIST ---
program
  .command("agents")
  .description("List all registered signal agents")
  .action(() => {
    console.log("📋 Registered Signal Agents:\n");
    Object.entries(agentRegistry).forEach(([name, config]) => {
      console.log(`🔹 ${name}`);
      console.log(`   ↳ Strategy:    ${config.strategy}`);
      console.log(`   ↳ Version:     ${config.version || "1.0.0"}`);
      console.log(`   ↳ Path:        ${config.entry}`);
      console.log(`   ↳ Description: ${config.description || "n/a"}`);
      console.log("");
    });
  });

program.parse();