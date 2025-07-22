export async function executeSignal(signal: any): Promise<any> {
  const action = decideAction(signal);

  console.log("📡 Execution Agent engaged...");
  console.log(`📈 Action: ${action.type.toUpperCase()} ${action.amount} of ${action.asset}`);
  console.log("✅ Order simulated (real execution coming soon)");

  // Simulated async delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    status: "simulated",
    ...action,
    timestamp: new Date().toISOString()
  };
}

function decideAction(signal: any) {
  const score = signal.score;
  const asset = signal.meta?.asset || "BTCUSDT";

  if (score > 0.6) {
    return { type: "buy", asset, amount: 100 };
  } else if (score < 0.4) {
    return { type: "sell", asset, amount: 100 };
  } else {
    return { type: "hold", asset, amount: 0 };
  }
}