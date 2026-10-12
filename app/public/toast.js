// toast.js — react-hot-toast style notification system with Tabler icons
(function () {
  const CONTAINER_ID = 'react-hot-toast-container';

  function getContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.style.cssText = `
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        pointer-events: none;
        max-width: 90vw;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  function createToast(message, type = 'default', duration = 3500) {
    const container = getContainer();
    const toast = document.createElement('div');
    const id = 'toast-' + Math.random().toString(36).substring(2, 9);
    toast.id = id;

    let iconHtml = '';
    let accentBorder = '#232836';
    if (type === 'success') {
      iconHtml = '<i class="ti ti-circle-check text-mgreen" style="font-size: 18px; color: #83c167;"></i>';
      accentBorder = 'rgba(131, 193, 103, 0.35)';
    } else if (type === 'error') {
      iconHtml = '<i class="ti ti-alert-triangle text-mred" style="font-size: 18px; color: #fc6255;"></i>';
      accentBorder = 'rgba(252, 98, 85, 0.35)';
    } else if (type === 'loading') {
      iconHtml = '<i class="ti ti-loader-2 animate-spin" style="font-size: 18px; color: #f2d45c; display: inline-block;"></i>';
      accentBorder = 'rgba(242, 212, 92, 0.35)';
    } else if (type === 'warning') {
      iconHtml = '<i class="ti ti-alert-circle text-myellow" style="font-size: 18px; color: #f2d45c;"></i>';
      accentBorder = 'rgba(242, 212, 92, 0.35)';
    } else {
      iconHtml = '<i class="ti ti-info-circle text-mblue" style="font-size: 18px; color: #58c4dd;"></i>';
      accentBorder = 'rgba(88, 196, 221, 0.35)';
    }

    toast.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 18px;
      background: #11141b;
      color: #eceef3;
      border: 1px solid ${accentBorder};
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.65), 0 8px 10px -6px rgba(0, 0, 0, 0.45);
      font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.01em;
      pointer-events: auto;
      transform: translateY(-20px) scale(0.92);
      opacity: 0;
      transition: all 0.28s cubic-bezier(0.21, 1.02, 0.73, 1);
    `;

    toast.innerHTML = `
      <span style="display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${iconHtml}</span>
      <span style="line-height: 1.4; word-break: break-word;">${message}</span>
    `;

    container.appendChild(toast);

    // Trigger smooth entrance animation
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0) scale(1)';
      toast.style.opacity = '1';
    });

    const dismiss = () => {
      toast.style.transform = 'translateY(-16px) scale(0.92)';
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
      }, 280);
    };

    let timer = null;
    if (duration > 0) {
      timer = setTimeout(dismiss, duration);
    }

    return {
      id,
      dismiss,
    };
  }

  window.toast = function (message, opts = {}) {
    return createToast(message, opts.type || 'default', opts.duration || 3500);
  };
  window.toast.success = (msg, opts = {}) => createToast(msg, 'success', opts.duration || 3500);
  window.toast.error = (msg, opts = {}) => createToast(msg, 'error', opts.duration || 4500);
  window.toast.warning = (msg, opts = {}) => createToast(msg, 'warning', opts.duration || 4000);
  window.toast.loading = (msg) => createToast(msg, 'loading', 0);
  window.toast.dismiss = (toastObj) => {
    if (toastObj && typeof toastObj.dismiss === 'function') {
      toastObj.dismiss();
    } else {
      const container = document.getElementById(CONTAINER_ID);
      if (container) container.innerHTML = '';
    }
  };
})();
