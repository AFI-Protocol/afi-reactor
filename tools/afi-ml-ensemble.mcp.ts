import { Signal } from "../types/Signal";

const modelPool = ["XGBoost", "LightGBM", "RandomForest", "NeuralNet (v2.3)", "EnsembleStackerXL"];

export async function analyze(
  signal: Signal
): Promise<
  Signal & {
    prediction: number;
    confidenceLevel: number;
    modelUsed: string;
  }
> {
  const prediction = parseFloat(Math.random().toFixed(3)); // 0 to 1
  const confidenceLevel = parseFloat((Math.random() * (1 - prediction) + prediction).toFixed(3)); // Always ≥ prediction
  const modelUsed = modelPool[Math.floor(Math.random() * modelPool.length)];

  console.log(
    `🤖 [${modelUsed}] predicts ${prediction} (confidence: ${confidenceLevel})`
  );

  return {
    ...signal,
    prediction,
    confidenceLevel,
    modelUsed
  };
}

export default { analyze };