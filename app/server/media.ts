import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const getAudioDuration = async (audioPath: string): Promise<number> => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);

  const duration = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Could not determine audio duration with ffprobe.');
  }

  return duration;
};

export type MixSoundtrackOptions = {
  videoPath: string;
  musicPath: string;
  sfxPath: string;
  outputPath: string;
};

// Voice (the video's own track) ducks the music hard via sidechain
// compression; SFX sit on top at whisper gains; a limiter catches peaks.
// Voice must remain the loudest layer by a wide margin — see the
// measure-and-fix loop in jobs.ts that enforces it after every mix.
export const mixSoundtrack = async ({
  videoPath,
  musicPath,
  sfxPath,
  outputPath,
}: MixSoundtrackOptions): Promise<void> => {
  await execFileAsync('ffmpeg', [
    '-y', '-v', 'error',
    '-i', videoPath,
    '-i', musicPath,
    '-i', sfxPath,
    '-filter_complex',
    '[0:a]asplit=2[v1][v2];[1:a][v2]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=500:makeup=1[m];[v1][m][2:a]amix=inputs=3:normalize=0,alimiter=limit=0.95[a]',
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ]);
};

export type AudioStats = {
  /** Mean volume in dBFS, or null when undetectable (digital silence). */
  meanDb: number | null;
  /** Peak volume in dBFS, or null when undetectable. */
  maxDb: number | null;
};

/** Pure parser for ffmpeg volumedetect stderr (unit-tested, no ffmpeg needed). */
export const parseVolumeDetect = (stderr: string): AudioStats => {
  const num = (s: string): number | null => {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  const mean = stderr.match(/mean_volume:\s*([-\d.]+|n\/a)\s*dB/);
  const max = stderr.match(/max_volume:\s*([-\d.]+|n\/a)\s*dB/);
  return {
    meanDb: mean ? (mean[1] === 'n/a' ? null : num(mean[1])) : null,
    maxDb: max ? (max[1] === 'n/a' ? null : num(max[1])) : null,
  };
};

/** Mean + peak loudness of an audio file via ffmpeg volumedetect. */
export const measureAudioStats = async (audioPath: string): Promise<AudioStats> => {
  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-i', audioPath,
    '-af', 'volumedetect',
    '-f', 'null', '-',
  ]);
  return parseVolumeDetect(String(stderr));
};

/** Re-write an audio file with a gain offset (negative = quieter). */
export const attenuateAudio = async (
  inputPath: string,
  outputPath: string,
  db: number,
): Promise<void> => {
  await execFileAsync('ffmpeg', [
    '-y', '-v', 'error',
    '-i', inputPath,
    '-af', `volume=${db}dB`,
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
};
