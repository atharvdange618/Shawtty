import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config, paths } from './config';
import type { Job } from '../types';

const jobs = new Map<string, Job>();

const makeJobId = (): string => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
};

const publicJob = (job: Job): Job => ({
  id: job.id,
  prompt: job.prompt,
  status: job.status,
  step: job.step,
  progress: job.progress,
  error: job.error,
  trace: job.trace || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  plan: job.plan,
  videoUrl: job.videoUrl,
  audioUrl: job.audioUrl,
  searchInsights: job.searchInsights || null,
});

const writeJob = async (job: Job): Promise<void> => {
  const jobDir = path.join(paths.reelDir, job.id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, 'job.json'), `${JSON.stringify(publicJob(job), null, 2)}\n`);
};

const updateJob = async (job: Job, patch: Partial<Job>): Promise<void> => {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  await writeJob(job);
};

type TraceStage = { t: string; stage: string; detail?: string };

const traceStage = async (job: Job, stage: string, detail?: string): Promise<void> => {
  const jobDir = path.join(paths.reelDir, job.id);
  const file = path.join(jobDir, 'trace.json');
  let stages: TraceStage[];
  try {
    stages = JSON.parse(await fs.readFile(file, 'utf8')) as TraceStage[];
  } catch {
    stages = [];
  }
  stages.push({ t: new Date().toISOString(), stage, ...(detail ? { detail } : {}) });
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(stages, null, 2)}\n`);
};

/**
 * Execute job via the Manim microservice (pure Python Manim, self-healing code repair, 1080p render).
 */
const runJob = async (job: Job): Promise<void> => {
  try {
    await updateJob(job, {
      status: 'running',
      step: 'Connecting to Manim Community Service',
      progress: 5,
    });
    await traceStage(job, 'Manim Service', `Target: ${config.manimServiceUrl}`);

    // Create job on Manim service
    const createRes = await fetch(`${config.manimServiceUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: job.prompt,
        quality: 'h',
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Manim service rejected job request (${createRes.status}): ${errText}`);
    }

    const { job: remoteJob } = (await createRes.json()) as { job: { id: string } };
    const remoteId = remoteJob.id;
    await traceStage(job, 'Manim Job Created', `Remote ID: ${remoteId}`);

    // Poll until complete or failed
    let finished = false;
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      let pollRes;
      try {
        pollRes = await fetch(`${config.manimServiceUrl}/api/jobs/${remoteId}`);
      } catch (pollErr) {
        console.warn(`[job ${job.id}] Transient fetch error from Manim service:`, pollErr);
        continue;
      }

      if (!pollRes.ok) {
        console.warn(`[job ${job.id}] Polling error (${pollRes.status}) from Manim service`);
        continue;
      }

      const { job: current } = (await pollRes.json()) as {
        job: {
          id: string;
          status: string;
          step: string;
          progress: number;
          error?: string | null;
          video_url?: string | null;
          title?: string | null;
          narration?: string | null;
          current_attempt?: number;
        };
      };

      const stepText = current.current_attempt && current.current_attempt > 1
        ? `${current.step} (Self-healing repair attempt ${current.current_attempt})`
        : current.step;

      await updateJob(job, {
        step: stepText,
        progress: Math.min(95, Math.max(job.progress, current.progress)),
      });

      if (current.status === 'completed') {
        finished = true;
        await traceStage(job, 'Manim Render Complete', 'Downloading 1080p MP4');
        await updateJob(job, { step: 'Downloading final 1080p reel', progress: 96 });

        const jobDir = path.join(paths.reelDir, job.id);
        await fs.mkdir(jobDir, { recursive: true });
        const localVideoPath = path.join(jobDir, 'reel.mp4');

        // Download video from Manim service
        const videoRes = await fetch(`${config.manimServiceUrl}/output/${remoteId}.mp4`);
        if (!videoRes.ok) {
          throw new Error(`Failed to download rendered video from Manim service (${videoRes.status})`);
        }

        if (!videoRes.body) {
          throw new Error('Video response stream is empty');
        }

        const fileStream = createWriteStream(localVideoPath);
        // @ts-expect-error Node fetch Readable stream pipeline
        await pipeline(Readable.fromWeb(videoRes.body), fileStream);

        await updateJob(job, {
          status: 'complete',
          step: 'Complete! 1080p Manim Reel ready.',
          progress: 100,
          videoUrl: `/reel/${job.id}/reel.mp4`,
        });
        await traceStage(job, 'Complete', '1080p video ready');
      } else if (current.status === 'failed') {
        finished = true;
        throw new Error(current.error || 'Manim render failed after repair attempts');
      }
    }
  } catch (error) {
    console.error(`[job ${job.id}] failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    const trace = error instanceof Error ? error.stack || String(error) : String(error);
    await traceStage(job, 'Failed', message.slice(0, 200));
    await updateJob(job, {
      status: 'failed',
      step: 'Failed',
      progress: 100,
      error: message,
      trace,
    });
  }
};

export const createJob = async (prompt: string): Promise<Job> => {
  const job: Job = {
    id: makeJobId(),
    prompt,
    status: 'queued',
    step: 'Queued',
    progress: 0,
    error: null,
    trace: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: null,
    videoUrl: null,
    audioUrl: null,
  };

  jobs.set(job.id, job);
  await writeJob(job);
  void runJob(job);
  return publicJob(job);
};

export const getJob = async (id: string): Promise<Job | null> => {
  const cached = jobs.get(id);
  if (cached) {
    return publicJob(cached);
  }

  const jobPath = path.join(paths.reelDir, id, 'job.json');
  try {
    const content = await fs.readFile(jobPath, 'utf8');
    return JSON.parse(content) as Job;
  } catch {
    return null;
  }
};

export const listJobs = async (): Promise<Job[]> => {
  const fromMemory = [...jobs.values()].map(publicJob);
  return fromMemory.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
