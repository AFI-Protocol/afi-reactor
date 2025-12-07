import path from 'path';

type PipelineImporter = (modulePath: string) => Promise<unknown>;

const PIPELINE_MODULE = '../../ops/runner/simulate-full-pipeline.js';

/**
 * Load the DAG simulation pipeline. Kept minimal so importing this module
 * doesn't trigger a pipeline run.
 */
export async function main(
  argv: string[] = process.argv,
  importer: PipelineImporter = modulePath => import(modulePath)
): Promise<void> {
  const originalArgv = process.argv;
  const args = [...argv];

  process.argv = args;

  try {
    await importer(PIPELINE_MODULE);
  } finally {
    process.argv = originalArgv;
  }
}

const invokedFile = process.argv[1] ? path.basename(process.argv[1]) : '';
const isDirectRun = invokedFile === 'run-dag.ts' || invokedFile === 'run-dag.js';

if (isDirectRun) {
  void main();
}
