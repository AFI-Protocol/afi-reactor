// 🏷️ AFI-Reactor DAG plugin (tag propagator) — tag/metadata propagation only.
// No tokenomics, scoring logic, PoI/PoInsight, or vault semantics belong here.

export async function run(signal: any) {
  if (!signal) throw new Error('Signal is undefined or null.');

  const propagatedTags = Array.isArray(signal.tags) ? signal.tags : [];
  const strategy = signal.meta?.strategy || 'unspecified';
  const origin = signal.meta?.origin || 'unknown';

  const updatedMeta = {
    ...(signal.meta || {}),
    propagatedBy: [...(signal.meta?.propagatedBy || []), 'tag-propagator'],
    strategy,
    origin
  };

  const updatedSignal = {
    ...signal,
    tags: propagatedTags,
    meta: updatedMeta
  };

  console.log(`🏷️ [tag-propagator] Tags & strategy metadata propagated for signal: ${signal.signalId}`);
  return updatedSignal;
}
