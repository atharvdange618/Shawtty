document.addEventListener('DOMContentLoaded', async () => {
  const form = document.querySelector('#magicLinkForm');
  const emailInput = document.querySelector('#magicEmail');
  const submitBtn = document.querySelector('#magicSubmitBtn');
  const feedback = document.querySelector('#magicFeedback');
  const loggedInView = document.querySelector('#loggedInView');
  const userEmailSpan = document.querySelector('#userEmailSpan');
  const navAuthArea = document.querySelector('#navAuthArea');
  const heroSignOutBtn = document.querySelector('#heroSignOutBtn');

  // Check current session
  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      
      if (data?.user?.email) {
        showLoggedIn(data.user.email);
      } else {
        showLoggedOut();
      }
    } catch (err) {
      console.warn('Session check warning:', err);
      showLoggedOut();
    }
  };

  const showLoggedIn = (email) => {
    if (form) form.hidden = true;
    if (feedback) feedback.hidden = true;
    if (loggedInView) {
      loggedInView.hidden = false;
      userEmailSpan.textContent = email;
    }
    if (navAuthArea) {
      navAuthArea.innerHTML = `
        <div class="user-chip">
          <span class="user-avatar">${email[0].toUpperCase()}</span>
          <span class="user-email-text">${email}</span>
        </div>
        <a href="/app" class="btn-primary-sm">Open Studio →</a>
        <button id="navSignOutBtn" class="btn-ghost-sm">Sign Out</button>
      `;
      document.querySelector('#navSignOutBtn')?.addEventListener('click', handleSignOut);
    }
  };

  const showLoggedOut = () => {
    if (form) form.hidden = false;
    if (loggedInView) loggedInView.hidden = true;
    if (navAuthArea) {
      navAuthArea.innerHTML = `
        <a href="/app" class="btn-ghost-sm">Studio</a>
        <button id="navSignInBtn" class="btn-primary-sm">Sign In</button>
      `;
      document.querySelector('#navSignInBtn')?.addEventListener('click', () => {
        emailInput?.focus();
        emailInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
      showLoggedOut();
      if (feedback) {
        feedback.hidden = false;
        feedback.className = 'feedback-card info';
        feedback.innerHTML = '<p>You have signed out.</p>';
      }
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  if (heroSignOutBtn) {
    heroSignOutBtn.addEventListener('click', handleSignOut);
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) return;

      const submitText = submitBtn.querySelector('.btn-text');
      const submitSpinner = submitBtn.querySelector('.spinner');

      submitBtn.disabled = true;
      if (submitText) submitText.textContent = 'Sending Magic Link...';
      if (submitSpinner) submitSpinner.hidden = false;

      feedback.hidden = true;
      feedback.className = 'feedback-card';

      try {
        const callbackURL = `${window.location.origin}/app`;
        const res = await fetch('/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, callbackURL }),
        });

        const data = await res.json();

        if (res.ok) {
          form.hidden = true;
          feedback.hidden = false;
          feedback.className = 'feedback-card success';
          feedback.innerHTML = `
            <div class="feedback-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <div class="feedback-content">
              <h3>Check your inbox!</h3>
              <p>We sent a magic sign-in link to <strong>${email}</strong>.</p>
              <p class="feedback-sub">Click the link in your email to instantly enter Shawtty Studio.</p>
              <button type="button" id="resendBtn" class="btn-link">Send another link</button>
            </div>
          `;

          document.querySelector('#resendBtn')?.addEventListener('click', () => {
            form.hidden = false;
            feedback.hidden = true;
            emailInput.focus();
          });
        } else {
          throw new Error(data?.message || data?.error || 'Failed to send magic link');
        }
      } catch (err) {
        feedback.hidden = false;
        feedback.className = 'feedback-card error';
        feedback.innerHTML = `
          <div class="feedback-icon error-icon">⚠️</div>
          <div class="feedback-content">
            <p><strong>Failed to send email:</strong> ${err.message}</p>
            <p class="feedback-sub">Please verify your email address and try again.</p>
          </div>
        `;
      } finally {
        submitBtn.disabled = false;
        if (submitText) submitText.textContent = 'Send Magic Link ⚡';
        if (submitSpinner) submitSpinner.hidden = true;
      }
    });
  }

  await checkSession();
});
