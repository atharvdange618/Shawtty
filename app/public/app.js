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
    'Rendering Remotion reel',
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
