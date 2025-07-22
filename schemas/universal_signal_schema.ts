
import { z } from 'zod';

export const SignalSchema = z.object({
  id: z.string(),
  source: z.string(),
  timestamp: z.string(),
  data: z.any(),
});
