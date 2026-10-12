import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, initAuth } from './auth';
import { config, paths, ROOT_DIR } from './config';
import { createJob, getJob, listJobs } from './jobs';

const app = express();

await fs.mkdir(paths.reelDir, { recursive: true });
await fs.mkdir(paths.generatedAudioDir, { recursive: true });
await initAuth();

// Route to check current user session
app.get('/api/auth/me', async (req, res) => {
  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json({
      session: sessionData?.session || null,
      user: sessionData?.user || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// 1. Mount Better Auth catch-all route using Express 5 syntax BEFORE body parsers
app.all('/api/auth/*splat', toNodeHandler(auth));

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

app.get('/api/jobs', async (req, res) => {
  res.json({ jobs: await listJobs() });
});

// Protected: Only authenticated users can trigger reel generation jobs (No Guest Mode)
app.post('/api/jobs', async (req, res) => {
  const sessionData = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!sessionData?.user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

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

// Auth Pages
app.get(['/login', '/signin'], (_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'login.html'));
});

app.get('/signup', (_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'signup.html'));
});

app.get('/forgot-password', (_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'forgot-password.html'));
});

app.get('/reset-password', (_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'reset-password.html'));
});

// Protected App & Studio Routes: Enforce Authentication (No Guest Mode)
app.get(['/app', '/studio'], async (req, res) => {
  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!sessionData?.user) {
      res.redirect('/login');
      return;
    }
  } catch {
    res.redirect('/login');
    return;
  }
  res.sendFile(path.join(paths.publicDir, 'studio.html'));
});

// Landing Page
app.get('/', (_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'index.html'));
});

app.use((_req, res) => {
  res.sendFile(path.join(paths.publicDir, 'index.html'));
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

app.listen(config.port, () => {
  console.log(`AI Reel Agent running at http://localhost:${config.port}`);
  console.log(`Workspace: ${ROOT_DIR}`);
});
