const form = document.querySelector('#promptForm');
const input = document.querySelector('#promptInput');
const sampleButton = document.querySelector('#sampleButton');
const generateButton = document.querySelector('#generateButton');
const keyStatus = document.querySelector('#keyStatus');
const modelChip = document.querySelector('#modelChip');
const runTitle = document.querySelector('#runTitle');
const progressRing = document.querySelector('#progressRing');
const progressBar = document.querySelector('#progressBar');
const steps = document.querySelector('#steps');
const output = document.querySelector('#output');
const outputVideo = document.querySelector('#outputVideo');
const videoLink = document.querySelector('#videoLink');
const audioLink = document.querySelector('#audioLink');
const planNotes = document.querySelector('#planNotes');
const planLength = document.querySelector('#planLength');
const unsupportedBlock = document.querySelector('#unsupportedBlock');
const unsupportedList = document.querySelector('#unsupportedList');
const trace = document.querySelector('#trace');
const traceSteps = document.querySelector('#traceSteps');
const evalScores = document.querySelector('#evalScores');
const beatsWrap = document.querySelector('#beatsWrap');
const beatsTable = document.querySelector('#beatsTable');
const probeWrap = document.querySelector('#probeWrap');
const probeLink = document.querySelector('#probeLink');
const probeImg = document.querySelector('#probeImg');

let pollTimer = null;
let promptMaxChars = 20000;

const samplePrompt =
  'Create a 20-second vertical reel explaining how a voice AI agent helps a dental clinic answer missed calls, book appointments, and send reminders. Make it energetic, modern, and easy for a business owner to understand.';

const setProgress = (value) => {
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  progressRing.textContent = `${progress}%`;
  progressBar.style.width = `${progress}%`;
};

const renderSteps = (job) => {
  const base = [
    'Searching the web for topic insights',
    'Planning Google-grade motion graphics',
    'Generating narration',
    'Rendering 1080p Manim reel',
    'Mixing music and sound effects',
    'Complete',
  ];

  steps.innerHTML = '';

  if (job.status === 'failed') {
    const item = document.createElement('li');
    item.className = 'error';
    item.textContent = job.error || 'Job failed';
    steps.append(item);
    return;
  }

  const activeIndex = base.findIndex((step) => job.step?.startsWith(step));
  const complete = job.status === 'complete';

  base.forEach((label, index) => {
    const item = document.createElement('li');
    if (complete || index < activeIndex) item.className = 'done';
    if (!complete && (index === activeIndex || (activeIndex === -1 && index === 0))) {
      item.className = 'active';
    }
    item.textContent = index === activeIndex && job.step ? job.step : label;
    steps.append(item);
  });
};

const showOutput = (job) => {
  if (!job.videoUrl) return;

  output.hidden = false;
  outputVideo.src = `${job.videoUrl}?t=${Date.now()}`;
  videoLink.href = job.videoUrl;

  if (job.audioUrl) {
    audioLink.href = job.audioUrl;
    audioLink.hidden = false;
  } else {
    audioLink.hidden = true;
  }
};

let currentPlan = null;
let extrasLoadedFor = null;

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`missing ${url}`);
  return response.json();
};

const fmtClock = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false });
  } catch {
    return '';
  }
};

// Agent trace: stages, creativity scores, voice-locked beats, render probe.
// All static per-job files — fetched once the plan exists, refreshed never.
const renderExtras = async (job) => {
  if (!job.id || extrasLoadedFor === job.id) return;
  const hasPlan = job.plan && job.plan.scenes && job.plan.scenes.length > 0;
  if (!hasPlan && job.status !== 'complete') return;
  extrasLoadedFor = job.id;

  const base = `/reel/${job.id}`;
  const [stages, evalJson, transcript] = await Promise.all([
    fetchJson(`${base}/trace.json`).catch(() => null),
    fetchJson(`${base}/eval.json`).catch(() => null),
    fetchJson(`${base}/transcript.json`).catch(() => null),
  ]);

  trace.hidden = !stages && !evalJson && !transcript;
  if (trace.hidden) return;

  traceSteps.replaceChildren(
    ...(stages || []).map((entry) => {
      const item = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = fmtClock(entry.t);
      item.append(time, document.createTextNode(entry.detail ? `${entry.stage} — ${entry.detail}` : entry.stage));
      return item;
    }),
  );

  if (evalJson && typeof evalJson.overall === 'number') {
    evalScores.hidden = false;
    const chips = [
      ['hook', evalJson.hook],
      ['variety', evalJson.variety],
      ['motion', evalJson.motion],
      ['sound', evalJson.sound],
      ['originality', evalJson.originality],
    ];
    evalScores.replaceChildren(
      ...chips.map(([label, value]) => {
        const chip = document.createElement('span');
        chip.textContent = `${label} ${value}`;
        return chip;
      }),
      (() => {
        const chip = document.createElement('span');
        chip.className = 'overall';
        chip.textContent = `overall ${evalJson.overall}/5`;
        return chip;
      })(),
    );
  } else {
    evalScores.hidden = true;
  }

  const beats = transcript && Array.isArray(transcript.beats) ? transcript.beats : [];
  beatsWrap.hidden = beats.length === 0;
  if (beats.length > 0) {
    const trusted = transcript.trusted ? 'whisper' : 'estimated';
    beatsTable.replaceChildren(
      ...beats.map((beat, i) => {
        const row = document.createElement('tr');
        const num = document.createElement('td');
        num.textContent = `${i + 1}`;
        const time = document.createElement('td');
        time.className = 'time';
        time.textContent = `${Number(beat.start).toFixed(1)}–${Number(beat.end).toFixed(1)}s ${trusted}`;
        const text = document.createElement('td');
        text.textContent = beat.text;
        row.append(num, time, text);
        return row;
      }),
    );
  }

  probeImg.onerror = () => {
    probeWrap.hidden = true;
  };
  probeImg.src = `${base}/probe.png?t=${Date.now()}`;
  probeLink.href = `${base}/probe.png`;
  probeWrap.hidden = false;
};

const lengthText = (plan) => {
  const actual = !output.hidden && Number.isFinite(outputVideo.duration)
    ? ` · got ${outputVideo.duration.toFixed(1)}s`
    : '';
  return plan.targetSeconds
    ? `Requested ${plan.targetSeconds}s${actual}`
    : `No length in prompt, sized to the narration${actual}`;
};

const renderPlanNotes = (job) => {
  const plan = job.plan;
  currentPlan = plan;
  planNotes.hidden = !plan;
  if (!plan) return;

  planLength.textContent = lengthText(plan);
  const unsupported = plan.unsupported || [];
  unsupportedBlock.hidden = unsupported.length === 0;
  // Model output: textContent only, never innerHTML.
  unsupportedList.replaceChildren(
    ...unsupported.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }),
  );
};

const updateJob = (job) => {
  runTitle.textContent = job.plan?.title || job.step || 'Running';
  setProgress(job.progress);
  renderSteps(job);
  renderPlanNotes(job);
  renderExtras(job).catch(console.error);

  if (job.status === 'complete') {
    clearInterval(pollTimer);
    pollTimer = null;
    generateButton.disabled = false;
    generateButton.querySelector('span').textContent = 'Generate';
    showOutput(job);
  }

  if (job.status === 'failed') {
    clearInterval(pollTimer);
    pollTimer = null;
    generateButton.disabled = false;
    generateButton.querySelector('span').textContent = 'Generate';
  }
};

const pollJob = async (id) => {
  const response = await fetch(`/api/jobs/${id}`);
  if (!response.ok) {
    throw new Error('Could not read job status.');
  }

  const { job } = await response.json();
  updateJob(job);
};

const startPolling = (id) => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => pollJob(id).catch(console.error), 1800);
  pollJob(id).catch(console.error);
};

const boot = async () => {
  try {
    const response = await fetch('/api/health');
    const health = await response.json();

    keyStatus.textContent = health.hasApiKey ? 'Key ready' : 'Missing .env key';
    keyStatus.classList.toggle('ready', health.hasApiKey);
    keyStatus.classList.toggle('missing', !health.hasApiKey);
    modelChip.textContent = `${health.videoModel} + ${health.speechModel}`;
    promptMaxChars = Number(health.promptMaxChars) || promptMaxChars;
  } catch {
    keyStatus.textContent = 'Server offline';
    keyStatus.classList.add('missing');
    modelChip.textContent = 'Models unavailable';
  }
};

outputVideo.addEventListener('loadedmetadata', () => {
  if (currentPlan) planLength.textContent = lengthText(currentPlan);
});

sampleButton.addEventListener('click', () => {
  input.value = samplePrompt;
  input.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const prompt = input.value.trim();
  if (!prompt) return;

  if (prompt.length > promptMaxChars) {
    runTitle.textContent = 'Prompt too long';
    setProgress(100);
    steps.innerHTML = `<li class="error">Prompt must be under ${promptMaxChars} characters.</li>`;
    return;
  }

  output.hidden = true;
  trace.hidden = true;
  extrasLoadedFor = null;
  generateButton.disabled = true;
  generateButton.querySelector('span').textContent = 'Running';
  runTitle.textContent = 'Queued';
  setProgress(0);
  steps.innerHTML = '<li class="active">Starting job</li>';

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Could not start job.');
    }

    updateJob(payload.job);
    startPolling(payload.job.id);
  } catch (error) {
    generateButton.disabled = false;
    generateButton.querySelector('span').textContent = 'Generate';
    runTitle.textContent = 'Failed';
    setProgress(100);
    steps.innerHTML = `<li class="error">${error.message}</li>`;
  }
});

boot();
