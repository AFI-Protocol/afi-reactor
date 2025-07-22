export async function execute(signal: any): Promise<any> {
  console.log("📦 [Binance-Local] Execution agent loaded...");
  console.log("🔐 Using environment variables for authentication...");

  const { score, meta } = signal;
  const asset = meta?.asset || "BTCUSDT";

  let action = "HOLD";
  if (score > 0.6) action = "BUY";
  else if (score < 0.4) action = "SELL";

  console.log(`📈 Action: ${action} ${asset}`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    status: "simulated",
    type: action.toLowerCase(),
    asset,
    amount: 100,
    timestamp: new Date().toISOString()
  };
}