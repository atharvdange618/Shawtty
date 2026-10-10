import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths, ROOT_DIR } from './config';
import { createJob, getJob, listJobs } from './jobs';

const app = express();

await fs.mkdir(paths.reelDir, { recursive: true });
await fs.mkdir(paths.generatedAudioDir, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use('/reel', express.static(paths.reelDir));
app.use(express.static(paths.publicDir));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    fallbackBaseUrl: config.fallbackBaseUrl,
    videoModel: config.videoModel,
    speechModel: config.speechModel,
    speechVoice: config.speechVoice,
    promptMaxChars: config.promptMaxChars,
  });
});

app.get('/api/jobs', async (_req, res) => {
  res.json({ jobs: await listJobs() });
});

app.post('/api/jobs', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required.' });
    return;
  }

  if (prompt.length > config.promptMaxChars) {
    res.status(400).json({
      error: `Prompt must be under ${config.promptMaxChars} characters.`,
    });
    return;
  }

  const job = await createJob(prompt);
  res.status(202).json({ job });
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }

  res.json({ job });
});

app.use((_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`AI Reel Agent running at http://localhost:${config.port}`);
  console.log(`Workspace: ${ROOT_DIR}`);
});
