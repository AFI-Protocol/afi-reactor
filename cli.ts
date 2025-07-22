#!/usr/bin/env tsx

import { Command } from "commander";
import { afiExecuteCommand } from "./cli/afi/commands/afi-execute-command.ts";

const program = new Command();
program
  .name("afi")
  .description("AFI Command Line Interface")
  .version("0.1.0");

program
  .command("execute")
  .argument("<agent>", "Agent name from registry")
  .argument("<signalFile>", "Path to signal JSON file")
  .action(afiExecuteCommand);

program.parse(process.argv);