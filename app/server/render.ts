import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { paths } from './config';
import { JOB_COMPOSITION_ID } from './codegen';
import type { ReelInputProps } from '../types';

let bundlePromise: Promise<string> | null = null;

const getBundle = (): Promise<string> => {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: paths.remotionEntry,
    });
  }

  return bundlePromise;
};

export type RenderReelOptions = {
  jobId: string;
  inputProps: ReelInputProps;
  onProgress?: (progress: number) => void;
  /** Per-job Remotion entry for LLM-written visuals (null = template renderer). */
  customEntry?: string | null;
  /** Pre-probed bundle: skips rebundling + reprobing (probeEntry already ran). */
  serveUrl?: string | null;
};

export type ProbedBundle = { serveUrl: string };

/**
 * Bundle a custom entry + select its composition + render one still frame.
 * Catches runtime errors in generated components in seconds instead of
 * minutes into a full render. Returns the bundle URL for renderReel to
 * reuse (no triple bundling). Throws on any failure.
 */
export const probeEntry = async ({
  jobId,
  entryPath,
  inputProps,
}: {
  jobId: string;
  entryPath: string;
  inputProps: ReelInputProps;
}): Promise<ProbedBundle> => {
  const jobDir = path.join(paths.reelDir, jobId);
  const serveUrl = await bundle({ entryPoint: entryPath });
  const composition = await selectComposition({
    serveUrl,
    id: JOB_COMPOSITION_ID,
    inputProps,
    logLevel: 'warn',
  });
  await renderStill({
    composition,
    serveUrl,
    frame: 5,
    output: path.join(jobDir, 'probe.png'),
    inputProps,
    logLevel: 'warn',
    overwrite: true,
  });
  return { serveUrl };
};

export const renderReel = async ({
  jobId,
  inputProps,
  onProgress,
  customEntry = null,
  serveUrl: prebuiltServeUrl = null,
}: RenderReelOptions): Promise<string> => {
  const jobDir = path.join(paths.reelDir, jobId);
  const outputLocation = path.join(jobDir, 'reel.mp4');

  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, 'input.json'),
    `${JSON.stringify(inputProps, null, 2)}\n`,
  );

  // Custom entries bundle per job (never cached — the code is unique); the
  // template entry stays cached across jobs as before. A pre-probed bundle
  // is reused as-is (probe already ran — see probeEntry).
  const serveUrl = prebuiltServeUrl ?? (customEntry ? await bundle({ entryPoint: customEntry }) : await getBundle());
  const composition = await selectComposition({
    serveUrl,
    id: customEntry ? JOB_COMPOSITION_ID : 'GeneratedReel',
    inputProps,
    logLevel: 'warn',
  });

  if (customEntry && !prebuiltServeUrl) {
    // Still-frame probe: catches runtime errors in generated components in
    // seconds instead of minutes into a full render.
    await renderStill({
      composition,
      serveUrl,
      frame: 5,
      output: path.join(jobDir, 'probe.png'),
      inputProps,
      logLevel: 'warn',
      overwrite: true,
    });
  }

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    outputLocation,
    inputProps,
    overwrite: true,
    logLevel: 'warn',
    concurrency: '50%',
    onProgress: ({ progress }) => {
      if (typeof onProgress === 'function') {
        onProgress(Math.round(progress * 100));
      }
    },
  });

  return outputLocation;
};
