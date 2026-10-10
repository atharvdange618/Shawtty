import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../server/config.js';

const execFileAsync = promisify(execFile);

const checkBinary = async (name) => {
  try {
    const { stdout, stderr } = await execFileAsync(name, ['-version']);
    const firstLine = `${stdout || stderr}`.split('\n')[0].trim();
    return `${name}: ${firstLine}`;
  } catch (error) {
    return `${name}: missing or not executable (${error.message})`;
  }
};

const lines = [
  `AICREDITS_API_KEY: ${config.apiKey ? 'set' : 'missing'}`,
  `AICREDITS_BASE_URL: ${config.baseUrl}`,
  `VIDEO_MODEL: ${config.videoModel}`,
  `SPEECH_MODEL: ${config.speechModel}`,
  `SPEECH_VOICE: ${config.speechVoice}`,
  await checkBinary('ffmpeg'),
  await checkBinary('ffprobe'),
];

console.log(lines.join('\n'));
