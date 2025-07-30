export interface VaultedSignal {
  signalId: string;
  score: number;
  timestamp: Date;
  meta: Record<string, any>;
  relatedSignals?: string[];
  lineage?: string;
  cognitiveTags?: string[];
}
