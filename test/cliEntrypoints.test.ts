import { afterEach, describe, expect, it, jest } from '@jest/globals';

const pipelineModule = '../../ops/runner/simulate-full-pipeline.js';

describe('CLI entrypoints', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('loads run-dag main without executing the pipeline', async () => {
    const originalArgv = process.argv;
    let capturedArgv: string[] | null = null;

    const pipelineLoader = jest.fn(async (modulePath: string) => {
      capturedArgv = [...process.argv];
      expect(modulePath).toBe(pipelineModule);
    });

    const { main } = await import('../src/cli/run-dag.js');

    expect(typeof main).toBe('function');

    await expect(main(['node', 'run-dag', '--help'], pipelineLoader)).resolves.toBeUndefined();

    expect(pipelineLoader).toHaveBeenCalledTimes(1);
    expect(capturedArgv).toEqual(['node', 'run-dag', '--help']);
    expect(process.argv).toBe(originalArgv);
  });

  it('adds replay flag and loads the pipeline for replay-signals', async () => {
    const originalArgv = process.argv;
    let capturedArgv: string[] | null = null;

    const pipelineLoader = jest.fn(async (modulePath: string) => {
      capturedArgv = [...process.argv];
      expect(modulePath).toBe(pipelineModule);
    });

    const { main } = await import('../src/cli/replay-signals.js');

    expect(typeof main).toBe('function');

    const args = ['node', 'replay-signals'];
    await expect(main(args, pipelineLoader)).resolves.toBeUndefined();

    expect(pipelineLoader).toHaveBeenCalledTimes(1);
    expect(capturedArgv).toEqual(['node', 'replay-signals', '--replay']);
    expect(process.argv).toBe(originalArgv);
  });
});
