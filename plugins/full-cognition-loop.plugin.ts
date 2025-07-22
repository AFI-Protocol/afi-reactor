import { run as lineager } from './signal-lineager.plugin';
import { run as propagator } from './tag-propagator.plugin';
import { run as classifier } from './cognition-classifier.plugin';

export async function run(signal: any) {
  console.log('🧬 Running full cognition loop...');

  // Step 1: Lineage
  const withLineage = await lineager(signal);

  // Step 2: Tag Propagation
  const withTags = await propagator(withLineage);

  // Step 3: Cognition Classification
  const withCognition = await classifier(withTags);

  console.log('🧠 Cognition loop complete.');
  return withCognition;
}

// Optional CLI test runner
if (require.main === module) {
  const mockSignal = {
    signalId: 'test-signal',
    score: 0.92,
    confidence: 0.88,
    tags: ['momentum', 'breakout'],
    timestamp: new Date(),
    meta: { source: 'test', strategy: 'demo' }
  };

  run(mockSignal).then(result => {
    console.log('🔁 Final Result:', JSON.stringify(result, null, 2));
  }).catch(console.error);
}
