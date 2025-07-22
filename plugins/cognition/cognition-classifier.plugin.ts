// Plugin 3: cognition-classifier.plugin.ts
import { VaultedSignal } from '../types/vaultedSignal.types';

interface CognitionLevel {
  level: 'low' | 'moderate' | 'high';
  justification: string;
}

/**
 * Uses heuristics to assign a cognition level to a signal based on its metadata.
 */
export async function run(signal: VaultedSignal): Promise<VaultedSignal> {
  const { score, confidence, meta } = signal;

  let level: CognitionLevel = {
    level: 'low',
    justification: 'Defaulted to low due to insufficient metadata.'
  };

  if (score > 0.9 && confidence > 0.9 && meta?.tags?.includes('novel-pattern')) {
    level = {
      level: 'high',
      justification: 'High score + confidence + novel pattern tag.'
    };
  } else if (score > 0.75 && confidence > 0.8) {
    level = {
      level: 'moderate',
      justification: 'Strong signal but lacks novel tag context.'
    };
  }

  return {
    ...signal,
    meta: {
      ...meta,
      cognition: level
    }
  };
}