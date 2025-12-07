import path from 'path';

type PipelineImporter = (modulePath: string) => Promise<unknown>;

const PIPELINE_MODULE = '../../ops/runner/simulate-full-pipeline.js';

export async function main(
  argv: string[] = process.argv,
  importer: PipelineImporter = modulePath => import(modulePath)
): Promise<void> {
  const originalArgv = process.argv;
  const args = [...argv];

  if (!args.includes('--replay')) {
    args.push('--replay');
  }

  process.argv = args;

  try {
    await importer(PIPELINE_MODULE);
  } finally {
    process.argv = originalArgv;
  }
}

const invokedFile = process.argv[1] ? path.basename(process.argv[1]) : '';
const isDirectRun = invokedFile === 'replay-signals.ts' || invokedFile === 'replay-signals.js';

if (isDirectRun) {
  void main();
}
