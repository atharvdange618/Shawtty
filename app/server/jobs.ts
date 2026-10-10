import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  TAIL_SECONDS,
  generateVoiceScript,
  choreographScenes,
  generateSpeech,
  transcribeWords,
  extractTargetSeconds,
} from './aicredits';
import { researchTopic } from './search';
import { attenuateAudio, getAudioDuration, measureAudioStats, mixSoundtrack } from './media';
import { config, paths } from './config';
import { renderReel } from './render';
import { buildCues, buildSoundtrack } from './sound';
import { buildCustomVisual, repairVisualCode } from './codegen';
import { probeEntry } from './render';
import {
  alignBeatsToScript,
  estimateWordTimings,
  groupWordsIntoBeats,
  normalizeScriptText,
  timelineFor,
  timelineFromBeats,
} from './timeline';
import { hasConcretePayload, reviewTimedPlan } from './review';
import { scorePlan } from './eval';
import type { Cue, Job, ReelInputProps, ReelPlan, TranscriptWord, Visual } from '../types';

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

type TraceStage = { t: string; stage: string; detail?: string };

/** Append-only agent trace (what the LLM/pipeline did, step by step). The UI renders it so the work is visible; logs stay terse. */
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
      step: 'Searching market insights and visual inspirations',
      progress: 5,
    });

    const research = await researchTopic(job.prompt);
    await traceStage(job, 'Research', `${research.results.length} sources on "${research.query}"`);

    // VOICE FIRST: Write punchy, creator-grade narration script
    await updateJob(job, {
      step: 'Writing creator-grade voiceover script',
      progress: 12,
      searchInsights: research.insights,
    });
    const scriptData = await generateVoiceScript(job.prompt, research.contextText);
    await traceStage(
      job,
      'Voice script',
      `"${scriptData.title}" · ${scriptData.script.split(/\s+/).filter(Boolean).length} words · theme ${scriptData.theme}`,
    );

    // VOICE FIRST: Generate real speech audio immediately and measure duration
    await updateJob(job, {
      step: 'Generating voiceover narration',
      progress: 22,
    });

    const jobDir = path.join(paths.reelDir, job.id);
    await fs.mkdir(jobDir, { recursive: true });
    const audioName = `${job.id}.${config.speechFormat}`;
    const audioPath = path.join(paths.generatedAudioDir, audioName);

    await generateSpeech({ text: scriptData.script, outputPath: audioPath });
    let speechSeconds = await getAudioDuration(audioPath);
    await traceStage(job, 'Voiceover', `${speechSeconds.toFixed(1)}s narrated (${config.speechModel})`);

    const targetSeconds = extractTargetSeconds(job.prompt);
    if (targetSeconds) {
      const desired = targetSeconds - TAIL_SECONDS;
      const speed = Math.max(0.85, Math.min(1.20, speechSeconds / desired));
      if (Math.abs(speed - 1) > 0.04) {
        await updateJob(job, { step: `Pacing narration to exact ${targetSeconds}s target` });
        await generateSpeech({
          text: scriptData.script,
          outputPath: audioPath,
          speed: Number(speed.toFixed(2)),
        });
        speechSeconds = await getAudioDuration(audioPath);
      }
    }
    const durationInSeconds = speechSeconds + TAIL_SECONDS;

    // TRANSCRIPT FIRST: force-align the recorded voice to word timestamps.
    // Everything downstream (beats, scene cuts, mouth) is grounded in
    // what is ACTUALLY spoken — never in the LLM's guesses.
    await updateJob(job, {
      step: 'Transcribing voiceover with word timestamps',
      progress: 30,
    });
    const whispered = await transcribeWords(audioPath);
    const scriptWordCount = scriptData.script.split(/\s+/).filter(Boolean).length;
    let transcriptWords: TranscriptWord[] | null = null;
    let transcribeError: string | undefined = whispered.error;
    if (whispered.words && whispered.words.length >= 3) {
      const lastEnd = whispered.words[whispered.words.length - 1].end;
      const plausible =
        whispered.words.length >= scriptWordCount * 0.7 &&
        whispered.words.length <= Math.max(scriptWordCount * 1.3, scriptWordCount + 10) &&
        lastEnd <= speechSeconds + 1 &&
        whispered.words[0].start < 2;
      if (plausible) {
        transcriptWords = whispered.words;
      } else {
        transcribeError = `rejected ${whispered.words.length} vs ${scriptWordCount} script words, end ${lastEnd.toFixed(2)}s`;
        console.warn(`[job ${job.id}] transcript ${transcribeError} — using estimated timings.`);
      }
    } else {
      transcribeError ??= 'transcription unavailable';
      console.warn(`[job ${job.id}] ${transcribeError} — using estimated word timings.`);
    }
    const transcriptTrusted = transcriptWords !== null;
    if (!transcriptWords) {
      transcriptWords = estimateWordTimings(scriptData.script, speechSeconds);
    }
    // The AUDIO is ground truth: narration is what was spoken (the transcript),
    // which may normalize punctuation/numbers vs the written script.
    const narration = normalizeScriptText(transcriptWords.map((w) => w.word).join(' '));
    const timedBeats = groupWordsIntoBeats(transcriptWords);
    await fs.writeFile(
      path.join(jobDir, 'transcript.json'),
      `${JSON.stringify({ model: transcriptTrusted ? config.transcribeModel : 'estimated', trusted: transcriptTrusted, error: transcribeError ?? null, beats: timedBeats }, null, 2)}\n`,
    );
    console.log(
      `[job ${job.id}] transcript: ${transcriptWords.length} words, ${timedBeats.length} beats (${transcriptTrusted ? 'whisper' : 'estimated'}).`,
    );
    await traceStage(
      job,
      'Transcript',
      `${transcriptWords.length} words → ${timedBeats.length} beats (${transcriptTrusted ? config.transcribeModel : 'estimated timings'})`,
    );

    // BEAT-LOCKED CHOREOGRAPHY: the LLM designs one visual per fixed
    // timestamped beat — it chooses what each cut SHOWS, never the cuts.
    await updateJob(job, {
      step: `Designing graphics for ${timedBeats.length} voice-locked beats (${durationInSeconds.toFixed(1)}s)`,
      progress: 35,
    });

    const rawScenes = await choreographScenes({
      prompt: job.prompt,
      title: scriptData.title,
      theme: scriptData.theme,
      script: narration,
      speechSeconds,
      researchContext: research.contextText,
      beats: timedBeats,
    });

    // SYSTEM REVIEW (timed): visuals/copy per beat + start/end/wordTimings
    // stamped from the transcript. Audio === visuals === cuts by construction.
    const reviewed = reviewTimedPlan(timedBeats, rawScenes, {
      theme: scriptData.theme,
      palette: scriptData.palette,
    });
    for (const w of reviewed.warnings) console.warn(`[job ${job.id}] review: ${w}`);
    // Review notes stay in server logs + review.json for debugging — they are
    // routine repairs, not user-facing errors, so the UI "Not supported yet"
    // block (plan.unsupported) stays empty.
    await fs.writeFile(
      path.join(jobDir, 'review.json'),
      `${JSON.stringify({ repaired: reviewed.repaired, warnings: reviewed.warnings }, null, 2)}\n`,
    );
    await traceStage(
      job,
      'Choreography + review',
      `${rawScenes.length} scenes designed, ${reviewed.warnings.length} repaired`,
    );

    // Creativity eval: hook / variety / motion / sound / originality.
    const evalScores = scorePlan(reviewed.scenes, hasConcretePayload);
    await fs.writeFile(
      path.join(jobDir, 'eval.json'),
      `${JSON.stringify({ version: 1, ...evalScores }, null, 2)}\n`,
    );
    await traceStage(job, 'Creativity eval', `overall ${evalScores.overall}/5`);

    const plan: ReelPlan = {
      title: scriptData.title,
      theme: scriptData.theme,
      narration: reviewed.narration,
      scenes: reviewed.scenes,
      style: {
        theme: scriptData.theme,
        mood: scriptData.mood,
        palette: scriptData.palette,
      },
      searchInsights: research.insights,
      searchQuery: research.query,
      images: research.images,
      targetSeconds,
      unsupported: [],
    };

    // Reference photos for story beats. URLs are absolutized: bespoke
    // components render <Img> directly and cannot resolve bundle statics.
    const absolutize = (u: string): string =>
      /^https?:\/\//.test(u) ? u : `http://localhost:${config.port}${u.startsWith('/') ? '' : '/'}${u}`;
    const isAot = /(?:attack on titan|eren|mikasa|yeager|ackerman)/i.test(job.prompt);
    const aotAssets = [
      '/assets/anime/aot-childhood.jpg',
      '/assets/anime/aot-bond.jpg',
      '/assets/anime/aot-conflict.jpg',
      '/assets/anime/aot-devotion.jpg',
      '/assets/anime/aot-ending.jpg',
    ];

    const isDemonSlayer = /(?:demon slayer|kimetsu no yaiba|tanjiro|nezuko|kamado|zenitsu|inosuke|rengoku|muzan)/i.test(
      job.prompt,
    );

    if (isAot) {
      plan.scenes = plan.scenes.map((scene, i) => {
        const assetIndex = Math.min(
          aotAssets.length - 1,
          Math.floor((i / plan.scenes.length) * aotAssets.length),
        );
        const img = absolutize(aotAssets[assetIndex]);
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
    } else if (isDemonSlayer) {
      plan.theme = 'storytelling';

      const archetypes = [
        {
          id: 'water_breathing',
          imageUrl: '/assets/anime/ds-water-breathing.jpg',
          visual: 'water_breathing' as Visual,
          effect: 'water_waves' as const,
          accent: '#0284C7',
          score: (text: string) => {
            let s = 0;
            if (/\b(?:water breathing|mizu no kokyu|constant flux|water dragon)\b/i.test(text)) s += 16;
            if (/\b(?:water|urokodaki|nichirin|swordsman|selection|training)\b/i.test(text)) s += 8;
            return s;
          },
        },
        {
          id: 'hinokami_kagura',
          imageUrl: '/assets/anime/ds-hinokami-kagura.jpg',
          visual: 'hinokami_kagura' as Visual,
          effect: 'solar_flames' as const,
          accent: '#EA580C',
          score: (text: string) => {
            let s = 0;
            if (/\b(?:hinokami|kagura|fire god|sun breathing|dance of the fire)\b/i.test(text)) s += 16;
            if (/\b(?:sun|solar|flame|flames|blazing|father's dance|rui)\b/i.test(text)) s += 8;
            return s;
          },
        },
        {
          id: 'hashira_battle',
          imageUrl: '/assets/anime/ds-hashira-battle.jpg',
          visual: 'hinokami_kagura' as Visual,
          effect: 'solar_flames' as const,
          accent: '#EF4444',
          score: (text: string) => {
            let s = 0;
            if (/\b(?:muzan|kibutsuji|infinity castle|hashira|rengoku|flame hashira)\b/i.test(text)) s += 16;
            if (/\b(?:upper moon|upper rank|final battle|demon king|climax|defeat muzan)\b/i.test(text)) s += 8;
            return s;
          },
        },
        {
          id: 'snow_tragedy',
          imageUrl: '/assets/anime/ds-snow-tragedy.jpg',
          visual: 'cinematic_character' as Visual,
          effect: 'snow' as const,
          accent: '#38BDF8',
          score: (text: string) => {
            let s = 0;
            if (/\b(?:slain|slaughtered|family|mother|siblings|snow|snowy|mountain)\b/i.test(text)) s += 14;
            if (/\b(?:tragedy|cold|blizzard|charcoal|home|village|peaceful|returned|found)\b/i.test(text)) s += 6;
            return s;
          },
        },
        {
          id: 'nezuko_demon',
          imageUrl: '/assets/anime/ds-nezuko-demon.jpg',
          visual: 'character_duo' as Visual,
          effect: 'petals' as const,
          accent: '#F43F5E',
          score: (text: string) => {
            let s = 0;
            if (/\b(?:nezuko|bamboo|demon sister|sister transformed|turned into a demon|transformed into a demon)\b/i.test(text)) s += 14;
            if (/\b(?:blood demon art|humanity|protect(?:s|ing)? tanjiro|sister|bonds?|love)\b/i.test(text)) s += 6;
            return s;
          },
        },
      ];

      plan.scenes = plan.scenes.map((scene, i) => {
        const text = `${scene.headline} ${scene.body} ${scene.narrationBeat || ''} ${scene.kicker}`.toLowerCase();
        const isLast = i === plan.scenes.length - 1;

        let bestArchetype = archetypes[0];
        let maxScore = -1;

        for (const arch of archetypes) {
          const sc = arch.score(text);
          if (sc > maxScore) {
            maxScore = sc;
            bestArchetype = arch;
          }
        }

        // If no decisive score (maxScore <= 0), use the natural narrative chronological progression
        if (maxScore <= 0) {
          const progression = [
            archetypes.find((a) => a.id === 'snow_tragedy')!,
            archetypes.find((a) => a.id === 'nezuko_demon')!,
            archetypes.find((a) => a.id === 'water_breathing')!,
            archetypes.find((a) => a.id === 'hinokami_kagura')!,
            archetypes.find((a) => a.id === 'hashira_battle')!,
          ];
          const actIndex = Math.min(progression.length - 1, Math.floor((i / plan.scenes.length) * progression.length));
          bestArchetype = progression[actIndex];
        }

        const finalVisual = isLast && scene.visualData?.quote ? 'cinematic_quote' : bestArchetype.visual;

        return {
          ...scene,
          visual: finalVisual,
          imageUrl: absolutize(bestArchetype.imageUrl),
          accent: bestArchetype.accent,
          visualData: {
            ...scene.visualData,
            imageUrl: absolutize(bestArchetype.imageUrl),
            effect: bestArchetype.effect,
            quote: isLast ? (scene.visualData?.quote || scene.headline) : scene.visualData?.quote,
            quoteAuthor: isLast ? (scene.visualData?.quoteAuthor || 'Tanjiro Kamado') : scene.visualData?.quoteAuthor,
          },
        };
      });
    } else if (plan.theme === 'storytelling' && research.images && research.images.length) {
      plan.scenes = plan.scenes.map((scene, i) => {
        const sceneText = `${scene.headline} ${scene.body} ${scene.narrationBeat || ''}`.toLowerCase();
        let bestImg = research.images![i % research.images!.length].url;
        let bestScore = -1;

        for (const candidate of research.images!) {
          const words = candidate.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
          const score = words.reduce((acc, word) => acc + (sceneText.includes(word) ? 1 : 0), 0);
          if (score > bestScore) {
            bestScore = score;
            bestImg = candidate.url;
          }
        }

        const isLast = i === plan.scenes.length - 1;
        const visual: Visual =
          isLast && scene.visualData?.quote
            ? 'cinematic_quote'
            : (['cinematic_character', 'landscape_canvas', 'character_duo'][i % 3] as Visual);

        return {
          ...scene,
          imageUrl: absolutize(bestImg),
          visual,
          visualData: {
            ...scene.visualData,
            imageUrl: absolutize(bestImg),
            effect: 'embers',
          },
        };
      });
    }

    // AV-sync guard: beats were already stamped from the transcript above
    // (reviewTimedPlan). Never rebuild the narration from beats here — the
    // audio on disk IS the transcript, so plan.narration must stay identical
    // to it. Image assignment below only touches visuals, never beat text.
    const joinedCheck = normalizeScriptText(
      plan.scenes.map((s) => s.narrationBeat || '').join(' '),
    );
    if (joinedCheck !== plan.narration) {
      console.warn(
        `[job ${job.id}] post-image-assignment sync drift detected ` +
          `(${joinedCheck.split(' ').length} beat words vs ${plan.narration.split(' ').length} transcript words). ` +
          `Re-aligning beats to protect AV sync (timings preserved).`,
      );
      const fixed = alignBeatsToScript(plan.narration, plan.scenes);
      plan.scenes = plan.scenes.map((s, i) => ({ ...s, narrationBeat: fixed[i] ?? s.narrationBeat }));
    }

    await fs.writeFile(path.join(jobDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);

    // BESPOKE VISUALS: the agent writes a custom Remotion component for this
    // video's beats (runtime codegen). Null = LLM/scan failure → templates.
    await updateJob(job, { step: 'Generating bespoke motion graphics code', progress: 42 });
    const customEntry = await buildCustomVisual({ jobId: job.id, plan });
    if (!customEntry) {
      // No silent filler: without bespoke visuals there is nothing honest to
      // render. The concrete reason is in codegen.json + server log.
      let reason = 'unknown error';
      try {
        const record = JSON.parse(await fs.readFile(path.join(jobDir, 'codegen.json'), 'utf8')) as {
          error?: string;
        };
        if (record.error) reason = record.error;
      } catch {
        // Keep the default reason.
      }
      await traceStage(job, 'Bespoke code', `FAILED: ${reason}`);
      throw new Error(`Bespoke visual codegen failed (${reason}). Resubmit to retry — the voice, transcript, and plan are intact.`);
    }
    await traceStage(job, 'Bespoke code', 'custom GeneratedVisual written');

    const audioFile = `http://localhost:${config.port}/generated/${audioName}`;

    const inputProps = createInputProps({
      job,
      plan,
      durationInSeconds,
      audioFile,
    });

    await updateJob(job, {
      plan,
      audioUrl: `/generated/${audioName}`,
      step: 'Rendering bespoke reel',
      progress: 45,
    });

    // Probe first (seconds, not minutes): on probe failure, ONE repair round
    // regenerates with the exact probe error fed back, then re-probes. The
    // winning bundle is reused for the full render — no triple bundling.
    await updateJob(job, { step: 'Probing bespoke visual (frame 5)', progress: 45 });
    let entryPath: string = customEntry;
    let serveUrl: string | null = null;
    let probeError: string | null = null;
    for (let attempt = 1; attempt <= 2 && !serveUrl; attempt += 1) {
      try {
        ({ serveUrl } = await probeEntry({ jobId: job.id, entryPath, inputProps }));
      } catch (error) {
        probeError = error instanceof Error ? error.message : String(error);
        if (attempt === 1) {
          console.warn(`[job ${job.id}] probe failed — one repair round with the error fed back.`);
          await updateJob(job, { step: 'Probe failed — repairing bespoke visual', progress: 45 });
          const repaired = await repairVisualCode({ jobId: job.id, plan, error: probeError });
          if (repaired) {
            entryPath = repaired;
            await traceStage(job, 'Bespoke repair', 'regenerated after probe failure');
          }
        }
      }
    }
    if (!serveUrl) {
      await traceStage(job, 'Bespoke probe', `FAILED: ${(probeError || 'unknown').slice(0, 200)}`);
      throw new Error(
        `Bespoke render failed (${(probeError || 'unknown').slice(0, 300)}). Probe + repair both failed — see server log.`,
      );
    }
    await traceStage(job, 'Bespoke probe', 'frame 5 clean');

    const videoPath = await renderReel({
      jobId: job.id,
      inputProps,
      customEntry: entryPath,
      serveUrl,
      onProgress: (renderProgress) => {
        const progress = 45 + Math.round(renderProgress * 0.5);
        Object.assign(job, {
          step: `Rendering bespoke reel (${renderProgress}%)`,
          progress,
          updatedAt: new Date().toISOString(),
        });
      },
    });

    await updateJob(job, { step: 'Mixing music and sound effects', progress: 96 });

    // Same frame math as timeline.ts + GeneratedReel so cues land on the handoffs.
    // Timed scenes cut on real transcript times; untimed fall back to weights.
    // buildCues emits ONE subtle cue per scene (transition XOR title hit).
    const totalFrames = Math.ceil(Math.max(5, Math.min(180, durationInSeconds)) * FPS);
    const timed = plan.scenes.length > 0 && plan.scenes.every((s) => typeof s.start === 'number' && typeof s.end === 'number');
    const cueTimeline = timed ? timelineFromBeats(plan.scenes, totalFrames, FPS) : timelineFor(plan.scenes, totalFrames);
    const cues: Cue[] = buildCues(cueTimeline);

    const musicPath = path.join(jobDir, 'music.wav');
    const sfxPath = path.join(jobDir, 'sfx.wav');
    const mixedPath = path.join(jobDir, 'reel.mixed.mp4');
    await buildSoundtrack({ durationInSeconds, cues, musicPath, sfxPath, theme: plan.theme });
    await mixSoundtrack({ videoPath, musicPath, sfxPath, outputPath: mixedPath });

    // AGENTIC RECHECK (measure → fix that portion → regenerate the mix):
    // voice must stay clearly loudest. If a stem runs hot, attenuate just
    // that stem and re-mix — no re-render needed. One correction pass max.
    const [voiceStats, musicStats, sfxStats] = await Promise.all([
      measureAudioStats(videoPath),
      measureAudioStats(musicPath),
      measureAudioStats(sfxPath),
    ]);
    let remixNeeded = false;
    let musicStem = musicPath;
    let sfxStem = sfxPath;
    if (
      voiceStats.maxDb !== null && sfxStats.maxDb !== null &&
      sfxStats.maxDb > voiceStats.maxDb - 6
    ) {
      const cut = Math.min(12, sfxStats.maxDb - (voiceStats.maxDb - 6) + 3);
      console.warn(`[job ${job.id}] SFX too hot (peak ${sfxStats.maxDb}dB vs voice ${voiceStats.maxDb}dB) — attenuating SFX by ${cut.toFixed(1)}dB and re-mixing.`);
      sfxStem = path.join(jobDir, 'sfx.quiet.wav');
      await attenuateAudio(sfxPath, sfxStem, -cut);
      remixNeeded = true;
    }
    if (
      voiceStats.meanDb !== null && musicStats.meanDb !== null &&
      musicStats.meanDb > voiceStats.meanDb - 9
    ) {
      const cut = Math.min(12, musicStats.meanDb - (voiceStats.meanDb - 9) + 3);
      console.warn(`[job ${job.id}] music too hot (mean ${musicStats.meanDb}dB vs voice ${voiceStats.meanDb}dB) — attenuating music by ${cut.toFixed(1)}dB and re-mixing.`);
      musicStem = path.join(jobDir, 'music.quiet.wav');
      await attenuateAudio(musicPath, musicStem, -cut);
      remixNeeded = true;
    }
    if (remixNeeded) {
      await mixSoundtrack({ videoPath, musicPath: musicStem, sfxPath: sfxStem, outputPath: mixedPath });
      await traceStage(job, 'Mix recheck', 'hot stem attenuated, mix regenerated');
    } else {
      await traceStage(job, 'Mix recheck', 'levels clean, voice loudest');
    }
    await fs.rename(mixedPath, videoPath);

    await updateJob(job, {
      status: 'complete',
      step: 'Complete',
      progress: 100,
      videoUrl: `/reel/${job.id}/reel.mp4`,
    });
    await traceStage(job, 'Complete', 'video ready');
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
