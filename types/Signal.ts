export interface Signal {
  signalId: string;
  score?: number;
  timestamp: Date;
  meta: Record<string, any>;
  tags?: string[];
}
