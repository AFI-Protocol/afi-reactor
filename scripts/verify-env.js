#!/usr/bin/env node
/**
 * Verify Environment Variables
 * 
 * This script verifies that dotenv is loading environment variables correctly.
 * Run with: node scripts/verify-env.js
 */

import dotenv from "dotenv";

// Load .env file
dotenv.config();

console.log("🔍 Environment Variable Check\n");

const envVars = [
  "COINALYZE_API_KEY",
  "AFI_PRICE_FEED_SOURCE",
  "AFI_REACTOR_PORT",
  "MONGODB_URI",
  "NODE_ENV",
];

let allSet = true;

envVars.forEach((varName) => {
  const value = process.env[varName];
  const status = value ? "✅ SET" : "❌ MISSING";
  const display = value 
    ? (varName === "COINALYZE_API_KEY" || varName === "MONGODB_URI" 
        ? `${value.substring(0, 8)}...` 
        : value)
    : "not set";
  
  console.log(`${status} ${varName}: ${display}`);
  
  if (!value && varName !== "NODE_ENV") {
    allSet = false;
  }
});

console.log("\n" + (allSet ? "✅ All required environment variables are set!" : "⚠️  Some environment variables are missing."));
console.log("\nTo set missing variables, add them to your .env file:");
console.log("  cp .env.example .env");
console.log("  # Then edit .env with your values\n");

