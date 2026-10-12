let currentJobId = null;
let pollTimer = null;

const form = document.getElementById('reel-form');
const promptInput = document.getElementById('prompt-input');
const qualitySelect = document.getElementById('quality-select');
const generateBtn = document.getElementById('generate-btn');
const monitorSection = document.getElementById('monitor-section');
const jobTitleDisplay = document.getElementById('job-title-display');
const jobIdDisplay = document.getElementById('job-id-display');
const jobStatusBadge = document.getElementById('job-status-badge');
const progressBarFill = document.getElementById('progress-bar-fill');
const stepDescription = document.getElementById('step-description');
const progressPercent = document.getElementById('progress-percent');
const codeContent = document.getElementById('code-content');
const attemptIndicator = document.getElementById('attempt-indicator');
const repairBox = document.getElementById('repair-box');
const repairDiagnosis = document.getElementById('repair-diagnosis');
const repairTraceback = document.getElementById('repair-traceback');
const videoPlaceholder = document.getElementById('video-placeholder');
const reelVideo = document.getElementById('reel-video');
const downloadBtn = document.getElementById('download-btn');
const narrationCard = document.getElementById('narration-card');
const narrationText = document.getElementById('narration-text');
const jobsListContainer = document.getElementById('jobs-list');

// Quick example chips
document.querySelectorAll('.btn-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    promptInput.value = btn.dataset.prompt;
    promptInput.focus();
  });
});

// Form submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  const quality = qualitySelect.value;
  setLoading(true);

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, quality }),
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    currentJobId = data.job.id;

    monitorSection.style.display = 'block';
    monitorSection.scrollIntoView({ behavior: 'smooth' });
    startPolling(currentJobId);
  } catch (err) {
    alert(`Failed to start job: ${err.message}`);
    setLoading(false);
  }
});

function setLoading(loading) {
  generateBtn.disabled = loading;
  generateBtn.querySelector('.spinner').style.display = loading ? 'inline-block' : 'none';
  generateBtn.querySelector('.btn-text').textContent = loading ? 'Generating...' : 'Generate Manim Reel';
}

function startPolling(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  updateJobView(jobId);
  pollTimer = setInterval(() => updateJobView(jobId), 1500);
}

async function updateJobView(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const { job } = await res.json();

    jobTitleDisplay.textContent = job.title || job.prompt;
    jobIdDisplay.textContent = `#${job.id}`;
    jobStatusBadge.textContent = job.status;
    jobStatusBadge.className = `status-badge ${job.status}`;

    progressBarFill.style.width = `${job.progress || 5}%`;
    progressPercent.textContent = `${job.progress || 5}%`;
    stepDescription.textContent = job.step || 'Processing...';

    // Update pipeline stage badges
    updateStages(job.status, job.progress);

    // Code view
    if (job.current_code) {
      codeContent.textContent = job.current_code;
    }
    attemptIndicator.textContent = `Attempt ${job.current_attempt || 1}`;

    // Repair feedback inspection
    const attempts = job.attempts || [];
    const failedAttempts = attempts.filter(a => !a.success);
    if (failedAttempts.length > 0) {
      const latestFail = failedAttempts[failedAttempts.length - 1];
      repairBox.style.display = 'block';
      repairDiagnosis.textContent = latestFail.diagnosis || `Diagnosing ${latestFail.error_summary}...`;
      repairTraceback.textContent = latestFail.traceback || latestFail.error_summary || '';
    } else {
      repairBox.style.display = 'none';
    }

    // Narration text
    if (job.narration) {
      narrationCard.style.display = 'block';
      narrationText.textContent = job.narration;
    }

    // Video completion
    if (job.status === 'completed' && job.video_url) {
      videoPlaceholder.style.display = 'none';
      reelVideo.style.display = 'block';
      if (reelVideo.src !== window.location.origin + job.video_url) {
        reelVideo.src = job.video_url;
        reelVideo.load();
        reelVideo.play().catch(() => {});
      }
      downloadBtn.href = job.video_url;
      downloadBtn.style.display = 'inline-block';
      clearInterval(pollTimer);
      setLoading(false);
      loadRecentJobs();
    } else if (job.status === 'failed') {
      videoPlaceholder.style.display = 'block';
      videoPlaceholder.innerHTML = `<div class="placeholder-icon">❌</div><p style="color: #FF3366;">Render Failed</p><span class="sub-placeholder">${job.error || 'Check traceback'}</span>`;
      clearInterval(pollTimer);
      setLoading(false);
      loadRecentJobs();
    }
  } catch (e) {
    console.error('Poll error', e);
  }
}

function updateStages(status, progress) {
  const stageScript = document.getElementById('stage-script');
  const stageCode = document.getElementById('stage-code');
  const stageRender = document.getElementById('stage-render');
  const stageRepair = document.getElementById('stage-repair');
  const stageMix = document.getElementById('stage-mix');

  const setClass = (el, state) => {
    el.className = `stage-step ${state}`;
  };

  if (progress >= 15) setClass(stageScript, progress > 25 ? 'completed' : 'active');
  if (progress >= 30) setClass(stageCode, progress > 40 ? 'completed' : 'active');
  if (progress >= 45) setClass(stageRender, progress > 80 ? 'completed' : 'active');
  if (status === 'repairing') setClass(stageRepair, 'active');
  else if (progress > 85) setClass(stageRepair, 'completed');
  if (progress >= 90) setClass(stageMix, progress === 100 ? 'completed' : 'active');
}

async function loadRecentJobs() {
  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) return;
    const { jobs } = await res.json();
    if (!jobs || jobs.length === 0) return;

    jobsListContainer.innerHTML = jobs.map(j => `
      <div class="job-card" onclick="viewJob('${j.id}')">
        <div class="job-card-header">
          <span class="job-id-tag">#${j.id.slice(0, 8)}</span>
          <span class="status-badge ${j.status}">${j.status}</span>
        </div>
        <div class="job-card-title">${j.title || j.prompt}</div>
        <div class="job-card-meta">Attempts: ${j.attempts ? j.attempts.length : 1} · ${j.created_at ? new Date(j.created_at).toLocaleTimeString() : ''}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Failed to load recent jobs', e);
  }
}

window.viewJob = function(jobId) {
  currentJobId = jobId;
  monitorSection.style.display = 'block';
  monitorSection.scrollIntoView({ behavior: 'smooth' });
  startPolling(jobId);
};

// Initial load
loadRecentJobs();
