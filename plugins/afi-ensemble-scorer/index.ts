import { z } from 'zod';
import { SignalSchema } from '../../schemas/universal_signal_schema';
import { PoIValidator } from '../../validators/PoIValidator';
import { SignalScorer } from '../../validators/SignalScorer';

const signalInputSchema = SignalSchema;

export const metadata = {
  name: 'afi-ensemble-scorer',
  version: '0.1.0',
  description: 'Combines PoI and Insight scores into a weighted ensemble',
  author: 'AFI Protocol',
  tags: ['validator', 'scorer', 'ensemble'],
};

export const configSchema = z.object({
  poiWeight: z.number().default(0.6),
  insightWeight: z.number().default(0.4),
});

export type Config = z.infer<typeof configSchema>;

export function evaluate(params: { signal: z.infer<typeof SignalSchema>; config?: Config }) {
  const { signal, config } = params;

  const poiScore = PoIValidator.evaluate(signal).score;
  const insightScore = SignalScorer.evaluate(signal).insightScore;

  const weights = {
    poi: config?.poiWeight ?? 0.6,
    insight: config?.insightWeight ?? 0.4,
  };

  const composite = poiScore * weights.poi + insightScore * weights.insight;

  return {
    score: Number(composite.toFixed(2)),
    tags: ['ensemble', 'weighted'],
    breakdown: {
      poi: poiScore,
      insight: insightScore,
    },
  };
}

// 👇 This export is required by ElizaOS plugin loader
export default {
  metadata,
  configSchema,
  evaluate,
};