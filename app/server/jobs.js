import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TAIL_SECONDS, generateReelPlan, generateSpeech } from './aicredits.js';
import { getAudioDuration, mixSoundtrack } from './media.js';
import { config, paths } from './config.js';
import { renderReel } from './render.js';
import { buildSoundtrack } from './sound.js';
import { OVERLAP, timelineFor } from '../remotion/timeline.js';

const FPS = 30;

const jobs = new Map();

const makeJobId = () => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
};

const publicJob = (job) => ({
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
});

const writeJob = async (job) => {
  const jobDir = path.join(paths.reelDir, job.id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, 'job.json'), `${JSON.stringify(publicJob(job), null, 2)}\n`);
};

const updateJob = async (job, patch) => {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  await writeJob(job);
};

const createInputProps = ({ job, plan, durationInSeconds, audioFile }) => ({
  jobId: job.id,
  title: plan.title,
  prompt: job.prompt,
  narration: plan.narration,
  scenes: plan.scenes,
  style: plan.style,
  audioFile,
  durationInSeconds,
  createdAt: job.createdAt,
});

const runJob = async (job) => {
  try {
    await updateJob(job, {
      status: 'running',
      step: 'Planning motion graphics',
      progress: 8,
    });

    const plan = await generateReelPlan(job.prompt);
    const jobDir = path.join(paths.reelDir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);

    await updateJob(job, {
      plan,
      step: 'Generating narration',
      progress: 28,
    });

    const audioName = `${job.id}.${config.speechFormat}`;
    const audioPath = path.join(paths.generatedAudioDir, audioName);
    await generateSpeech({ text: plan.narration, outputPath: audioPath });
    let speechSeconds = await getAudioDuration(audioPath);

    // The planner only roughly hits its word budget (models miscount words), so
    // fix the remaining gap with speaking rate. Clamped so the voice stays natural.
    if (plan.targetSeconds) {
      const desired = plan.targetSeconds - TAIL_SECONDS;
      const speed = Math.max(0.85, Math.min(1.15, speechSeconds / desired));
      if (Math.abs(speed - 1) > 0.05) {
        await updateJob(job, { step: `Generating narration (retiming to ${plan.targetSeconds}s)` });
        await generateSpeech({ text: plan.narration, outputPath: audioPath, speed: Number(speed.toFixed(2)) });
        speechSeconds = await getAudioDuration(audioPath);
      }
    }
    // Short tail so the last word isn't clipped by the final frame.
    const durationInSeconds = speechSeconds + TAIL_SECONDS;
    // Served over HTTP, not staticFile(): the Remotion bundle snapshots public/
    // once per process, so audio written after the first render isn't in it.
    const audioFile = `http://localhost:${config.port}/generated/${audioName}`;

    const inputProps = createInputProps({
      job,
      plan,
      durationInSeconds,
      audioFile,
    });

    await updateJob(job, {
      audioUrl: `/generated/${audioName}`,
      step: 'Rendering Remotion reel',
      progress: 45,
    });

    const videoPath = await renderReel({
      jobId: job.id,
      inputProps,
      onProgress: (renderProgress) => {
        const progress = 45 + Math.round(renderProgress * 0.5);
        Object.assign(job, {
          step: `Rendering Remotion reel (${renderProgress}%)`,
          progress,
          updatedAt: new Date().toISOString(),
        });
      },
    });

    await updateJob(job, { step: 'Mixing music and sound effects', progress: 96 });

    // Same frame math as timeline.js + GeneratedReel so cues land on the handoffs.
    // `from` is the frame the incoming scene starts being visible (the cross-fade
    // runs for OVERLAP frames after it), so the swish sits at the fade's centre.
    const totalFrames = Math.ceil(Math.max(5, Math.min(90, durationInSeconds)) * FPS);
    const cues = timelineFor(plan.scenes, totalFrames).flatMap((scene, index) => {
      const start = scene.from / FPS;
      const pop = { sfx: 'pop', t: start + 0.2, db: -22 }; // headline slam
      if (index === 0) return [pop];
      const swish = { sfx: 'swish', t: start + OVERLAP / 2 / FPS, db: -17 };
      return [swish, pop];
    });
    const musicPath = path.join(jobDir, 'music.wav');
    const sfxPath = path.join(jobDir, 'sfx.wav');
    const mixedPath = path.join(jobDir, 'reel.mixed.mp4');
    await buildSoundtrack({ durationInSeconds, cues, musicPath, sfxPath });
    await mixSoundtrack({ videoPath, musicPath, sfxPath, outputPath: mixedPath });
    await fs.rename(mixedPath, videoPath);

    await updateJob(job, {
      status: 'complete',
      step: 'Complete',
      progress: 100,
      videoUrl: `/reel/${job.id}/reel.mp4`,
    });
  } catch (error) {
    console.error(`[job ${job.id}] failed:`, error);
    await updateJob(job, {
      status: 'failed',
      step: 'Failed',
      progress: 100,
      error: error.message || String(error),
      trace: error.stack || String(error),
    });
  }
};

export const createJob = async (prompt) => {
  const job = {
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
  runJob(job);
  return publicJob(job);
};

export const getJob = async (id) => {
  if (jobs.has(id)) {
    return publicJob(jobs.get(id));
  }

  const jobPath = path.join(paths.reelDir, id, 'job.json');
  try {
    const content = await fs.readFile(jobPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const listJobs = async () => {
  const fromMemory = [...jobs.values()].map(publicJob);
  return fromMemory.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
