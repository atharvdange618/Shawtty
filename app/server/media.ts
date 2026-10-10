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

// Voice (the video's own track) ducks the music via sidechain compression;
// SFX sit on top undimmed; a limiter catches peaks. Filter from reel-studio's render.sh.
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
    '[0:a]asplit=2[v1][v2];[1:a][v2]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[m];[v1][m][2:a]amix=inputs=3:normalize=0,alimiter=limit=0.95[a]',
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ]);
};
