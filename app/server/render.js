import fs from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { paths } from './config.js';

let bundlePromise = null;

const getBundle = () => {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: paths.remotionEntry,
    });
  }

  return bundlePromise;
};

export const renderReel = async ({ jobId, inputProps, onProgress }) => {
  const jobDir = path.join(paths.reelDir, jobId);
  const outputLocation = path.join(jobDir, 'reel.mp4');

  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, 'input.json'),
    `${JSON.stringify(inputProps, null, 2)}\n`,
  );

  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id: 'GeneratedReel',
    inputProps,
    logLevel: 'warn',
  });

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
