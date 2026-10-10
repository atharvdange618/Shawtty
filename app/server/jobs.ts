import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TAIL_SECONDS, generateReelPlan, generateSpeech } from './aicredits';
import { researchTopic } from './search';
import { getAudioDuration, mixSoundtrack } from './media';
import { config, paths } from './config';
import { renderReel } from './render';
import { buildSoundtrack } from './sound';
import { OVERLAP, timelineFor } from '../remotion/timeline';
import type { Cue, Job, ReelInputProps, ReelPlan, Visual } from '../types';

const FPS = 30;

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

type CreateInputPropsOptions = {
  job: Job;
  plan: ReelPlan;
  durationInSeconds: number;
  audioFile: string;
};

const createInputProps = ({
  job,
  plan,
  durationInSeconds,
  audioFile,
}: CreateInputPropsOptions): ReelInputProps => ({
  jobId: job.id,
  title: plan.title,
  theme: plan.theme,
  prompt: job.prompt,
  narration: plan.narration,
  scenes: plan.scenes,
  style: plan.style,
  audioFile,
  durationInSeconds,
  createdAt: job.createdAt,
  images: plan.images,
});

const runJob = async (job: Job): Promise<void> => {
  try {
    await updateJob(job, {
      status: 'running',
      step: 'Searching the web for topic insights',
      progress: 5,
    });

    const research = await researchTopic(job.prompt);

    await updateJob(job, {
      step: 'Planning Google-grade motion graphics',
      progress: 15,
      searchInsights: research.insights,
    });

    const plan = await generateReelPlan(job.prompt, research.contextText);
    plan.searchInsights = research.insights;
    plan.searchQuery = research.query;
    plan.images = research.images;

    // Dynamically assign real character and landscape assets for stories
    const isAot = /(?:attack on titan|eren|mikasa|yeager|ackerman)/i.test(job.prompt);
    const aotAssets = [
      '/assets/anime/aot-childhood.jpg',
      '/assets/anime/aot-bond.jpg',
      '/assets/anime/aot-conflict.jpg',
      '/assets/anime/aot-devotion.jpg',
      '/assets/anime/aot-ending.jpg',
    ];

    if (isAot) {
      plan.scenes = plan.scenes.map((scene, i) => {
        const assetIndex = Math.min(
          aotAssets.length - 1,
          Math.floor((i / plan.scenes.length) * aotAssets.length),
        );
        const img = aotAssets[assetIndex];
        const isLast = i === plan.scenes.length - 1;
        const visual: Visual = isLast
          ? 'cinematic_quote'
          : assetIndex === 4
          ? 'scarf_wind'
          : assetIndex === 1
          ? 'character_duo'
          : 'cinematic_character';

        return {
          ...scene,
          visual,
          imageUrl: img,
          visualData: {
            ...scene.visualData,
            imageUrl: img,
            effect: assetIndex === 4 ? 'red_scarf_wind' : 'embers',
            quote: isLast
              ? 'Some love stories are not meant to have a happy ending. Some are meant to live forever in the hearts of those who remember them.'
              : scene.visualData?.quote,
            quoteAuthor: isLast ? 'Eren & Mikasa' : scene.visualData?.quoteAuthor,
          },
        };
      });
    } else if (plan.theme === 'storytelling' && research.images && research.images.length) {
      plan.scenes = plan.scenes.map((scene, i) => {
        const img = research.images![i % research.images!.length].url;
        const isLast = i === plan.scenes.length - 1;
        const visual: Visual =
          isLast && scene.visualData?.quote
            ? 'cinematic_quote'
            : (['cinematic_character', 'landscape_canvas', 'character_duo'][i % 3] as Visual);

        return {
          ...scene,
          imageUrl: img,
          visual,
          visualData: {
            ...scene.visualData,
            imageUrl: img,
          },
        };
      });
    }

    // Ensure every scene has a clean, unique spoken narrationBeat, and that plan.narration
    // is the 100% exact, word-for-word sequential join of every scene's spoken line!
    // This eliminates any possibility of audio-caption desync or repeated sentences.
    const uniqueScenes: typeof plan.scenes = [];
    for (let i = 0; i < plan.scenes.length; i++) {
      const scene = plan.scenes[i];
      let beat = (scene.narrationBeat || scene.body || '').trim();
      const prevBeat =
        uniqueScenes.length > 0
          ? (uniqueScenes[uniqueScenes.length - 1].narrationBeat || '').trim()
          : '';

      // If the model repeated the exact same or substring narrationBeat from the previous scene,
      // differentiate it using the scene's body or headline so each scene represents a distinct spoken beat.
      if (prevBeat && (beat === prevBeat || prevBeat.includes(beat) || beat.includes(prevBeat))) {
        if (scene.body && scene.body.trim() !== prevBeat) {
          beat = scene.body.trim();
        } else if (scene.headline && scene.headline.trim() !== prevBeat) {
          beat = `${scene.headline.trim()}.`;
        }
      }
      scene.narrationBeat = beat;
      uniqueScenes.push(scene);
    }
    plan.scenes = uniqueScenes;

    // Construct the speech script from the exact sequence of scene narration beats
    const spokenBeats = plan.scenes
      .map((s) => (s.narrationBeat || s.body || '').trim())
      .filter(Boolean);
    if (spokenBeats.length > 0) {
      plan.narration = spokenBeats.join(' ');
    }

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

    // Same frame math as timeline.ts + GeneratedReel so cues land on the handoffs.
    // `from` is the frame the incoming scene starts being visible (the cross-fade
    // runs for OVERLAP frames after it), so the swish sits at the fade's centre.
    const totalFrames = Math.ceil(Math.max(5, Math.min(90, durationInSeconds)) * FPS);
    const cues: Cue[] = timelineFor(plan.scenes, totalFrames).flatMap((scene, index): Cue[] => {
      const start = scene.from / FPS;
      const pop: Cue = { sfx: 'pop', t: start + 0.2, db: -22 }; // headline slam
      if (index === 0) return [pop];
      const swish: Cue = { sfx: 'swish', t: start + OVERLAP / 2 / FPS, db: -17 };
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
    const message = error instanceof Error ? error.message : String(error);
    const trace = error instanceof Error ? error.stack || String(error) : String(error);
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
