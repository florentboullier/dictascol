/* =============================================================
   DictaScol — Application Logic
   Dictée vocale → Google Docs pour élèves dyslexiques
   ============================================================= */

// ───────────────────────────────────────────────────────────────
// CONFIGURATION — À REMPLIR AVANT UTILISATION
// ───────────────────────────────────────────────────────────────
const CONFIG = {
  // Remplace par ton Client ID Google Cloud (voir README.md)
  // Ex : '123456789-xxxxxxxxx.apps.googleusercontent.com'
  GOOGLE_CLIENT_ID: '136709625042-1tgks7qtgp531sbtqb9jrol5a415qo2g.apps.googleusercontent.com',

  // Scopes Google API
  SCOPES: 'https://www.googleapis.com/auth/drive.file',

  // Langue de reconnaissance vocale
  SPEECH_LANG: 'fr-FR',

  // Liste des professeurs de l'établissement
  // Rôle possible : 'writer' (peut corriger/éditer) ou 'commenter' (peut annoter) ou 'reader' (lecture seule)
  TEACHERS: [
    { name: 'Mme Martin',   subject: 'Français',         email: 'martin.francais@ecole.fr',    role: 'writer' },
    { name: 'M. Dupont',    subject: 'Histoire-Géo',     email: 'dupont.histgeo@ecole.fr',     role: 'writer' },
    { name: 'Mme Bernard',  subject: 'Anglais',          email: 'bernard.anglais@ecole.fr',    role: 'writer' },
    { name: 'M. Petit',     subject: 'SVT',              email: 'petit.svt@ecole.fr',          role: 'writer' },
    { name: 'Mme Leroy',    subject: 'Espagnol',         email: 'leroy.espagnol@ecole.fr',     role: 'writer' },
  ],
};

// ───────────────────────────────────────────────────────────────
// ÉTAT DE L'APPLICATION
// ───────────────────────────────────────────────────────────────
const state = {
  isRecording: false,
  recognition: null,
  tokenClient: null,
  accessToken: null,
  userName: null,
  userAvatar: null,
  timerInterval: null,
  startTime: null,
  pendingExport: false, // true if export was triggered before login
  useDyslexicFont: true,
};

// ───────────────────────────────────────────────────────────────
// DOM REFERENCES
// ───────────────────────────────────────────────────────────────
const DOM = {};

function cacheDOMRefs() {
  DOM.micBtn       = document.getElementById('mic-btn');
  DOM.micIcon      = document.getElementById('mic-icon');
  DOM.micPulse     = document.getElementById('mic-pulse');
  DOM.statusText   = document.getElementById('status-text');
  DOM.timer        = document.getElementById('timer');
  DOM.transcript   = document.getElementById('transcript');
  DOM.interimContainer = document.getElementById('interim-container');
  DOM.interimText  = document.getElementById('interim-text');
  DOM.teacherSelect = document.getElementById('teacher-select');
  DOM.docTitle     = document.getElementById('doc-title');
  DOM.wordCount    = document.getElementById('word-count');
  DOM.loginBtn     = document.getElementById('login-btn');
  DOM.userInfo     = document.getElementById('user-info');
  DOM.userName     = document.getElementById('user-name');
  DOM.userAvatar   = document.getElementById('user-avatar');
  DOM.logoutBtn    = document.getElementById('logout-btn');
  DOM.fontToggle   = document.getElementById('font-toggle');
  DOM.exportBtn    = document.getElementById('export-btn');
  DOM.copyBtn      = document.getElementById('copy-btn');
  DOM.clearBtn     = document.getElementById('clear-btn');
  DOM.listenBtn    = document.getElementById('listen-btn');
  DOM.helpBtn      = document.getElementById('help-btn');
  DOM.helpModal    = document.getElementById('help-modal');
  DOM.helpClose    = document.getElementById('help-close');
  DOM.clearModal   = document.getElementById('clear-modal');
  DOM.clearCancel  = document.getElementById('clear-cancel');
  DOM.clearConfirm = document.getElementById('clear-confirm');
  DOM.browserWarning = document.getElementById('browser-warning');
  DOM.configNotice = document.getElementById('config-notice');
  DOM.toastContainer = document.getElementById('toast-container');
}

// ───────────────────────────────────────────────────────────────
// INITIALISATION
// ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheDOMRefs();
  initTeachersList();
  checkBrowserSupport();
  initSpeechRecognition();
  initGoogleAuth();
  initUIEvents();
  loadPreferences();
  restoreDraft();
}

// ───────────────────────────────────────────────────────────────
// TEACHERS LIST
// ───────────────────────────────────────────────────────────────
function initTeachersList() {
  if (!DOM.teacherSelect || !Array.isArray(CONFIG.TEACHERS)) return;

  CONFIG.TEACHERS.forEach((teacher, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${teacher.name} (${teacher.subject})`;
    DOM.teacherSelect.appendChild(option);
  });
}

function getSelectedTeacher() {
  if (!DOM.teacherSelect || DOM.teacherSelect.value === '') return null;
  const idx = parseInt(DOM.teacherSelect.value, 10);
  return CONFIG.TEACHERS[idx] || null;
}

function updateExportButtonLabel() {
  const teacher = getSelectedTeacher();
  const labelEl = DOM.exportBtn.querySelector('.btn-label');
  if (!labelEl) return;

  if (teacher) {
    labelEl.textContent = `Envoyer à ${teacher.name}`;
  } else {
    labelEl.textContent = 'Google Docs';
  }
}

// ───────────────────────────────────────────────────────────────
// BROWSER SUPPORT CHECK
// ───────────────────────────────────────────────────────────────
function checkBrowserSupport() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    DOM.browserWarning.style.display = 'flex';
    DOM.micBtn.disabled = true;
    DOM.statusText.textContent = 'Navigateur non compatible avec la dictée vocale';
    return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────────────
// SPEECH RECOGNITION
// ───────────────────────────────────────────────────────────────
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang            = CONFIG.SPEECH_LANG;
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    DOM.statusText.textContent = '🔴 Enregistrement en cours — parle !';
    DOM.statusText.classList.add('recording');
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        finalTranscript += text;
      } else {
        interimTranscript += text;
      }
    }

    // Process and append final transcript
    if (finalTranscript) {
      let processed = processPunctuation(finalTranscript);
      processed = capitalizeAfterPunctuation(processed);

      // Smart spacing: add space before new text if needed
      const current = DOM.transcript.value;
      if (current.length > 0 && !current.endsWith('\n') && !current.endsWith(' ')) {
        processed = ' ' + processed;
      }

      // Capitalize first letter of document
      if (current.length === 0) {
        processed = processed.charAt(0).toUpperCase() + processed.slice(1);
      }

      DOM.transcript.value += processed;
      DOM.transcript.scrollTop = DOM.transcript.scrollHeight;
      updateWordCount();
      saveDraft();
    }

    // Show interim text
    if (interimTranscript) {
      DOM.interimContainer.style.display = 'block';
      DOM.interimText.textContent = interimTranscript;
    } else {
      DOM.interimContainer.style.display = 'none';
      DOM.interimText.textContent = '';
    }
  };

  recognition.onend = () => {
    DOM.interimContainer.style.display = 'none';
    DOM.interimText.textContent = '';

    // Auto-restart if still recording (browser stops after silence)
    if (state.isRecording) {
      try {
        recognition.start();
      } catch (e) {
        // Already started, ignore
      }
    }
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);

    switch (event.error) {
      case 'not-allowed':
        showToast('Autorise l\'accès au micro dans ton navigateur', 'error');
        stopRecording();
        break;
      case 'no-speech':
        // Normal timeout, will auto-restart
        break;
      case 'network':
        showToast('Erreur réseau — vérifie ta connexion internet', 'error');
        break;
      case 'aborted':
        // User stopped, do nothing
        break;
      default:
        // Other errors, try to continue
        break;
    }
  };

  state.recognition = recognition;
  DOM.micBtn.disabled = false;
  DOM.statusText.textContent = 'Appuie sur le micro pour commencer';
}

// ───────────────────────────────────────────────────────────────
// RECORDING CONTROLS
// ───────────────────────────────────────────────────────────────
function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!state.recognition) return;

  try {
    state.recognition.start();
    state.isRecording = true;
    DOM.micBtn.classList.add('recording');
    DOM.micIcon.textContent = '⏹️';
    DOM.timer.style.display = 'block';
    DOM.timer.classList.add('recording');
    DOM.listenBtn.style.display = 'none';
    startTimer();
  } catch (e) {
    console.error('Failed to start recording:', e);
    showToast('Impossible de démarrer l\'enregistrement', 'error');
  }
}

function stopRecording() {
  state.isRecording = false;

  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (e) {
      // Already stopped
    }
  }

  DOM.micBtn.classList.remove('recording');
  DOM.micIcon.textContent = '🎤';
  DOM.statusText.textContent = 'Dictée en pause — appuie pour reprendre';
  DOM.statusText.classList.remove('recording');
  DOM.timer.classList.remove('recording');
  DOM.interimContainer.style.display = 'none';
  stopTimer();

  // Show listen button if there's text
  if (DOM.transcript.value.trim()) {
    DOM.listenBtn.style.display = 'inline-flex';
  }
}

// ───────────────────────────────────────────────────────────────
// PUNCTUATION PROCESSING
// ───────────────────────────────────────────────────────────────
function processPunctuation(text) {
  // Order matters: longer patterns first to avoid partial matches
  const replacements = [
    // Multi-word patterns first
    [/\bpoints? de suspension\b/gi,      '…'],
    [/\bpoint d['']interrogation\b/gi,    '?'],
    [/\bpoint d['']exclamation\b/gi,      '!'],
    [/\bpoint[- ]virgule\b/gi,            ';'],
    [/\bdeux[- ]points?\b/gi,             ' :'],
    [/\bouvr(?:ez|ir) les? guillemets?\b/gi, '« '],
    [/\bferm(?:ez|er) les? guillemets?\b/gi, ' »'],
    [/\bentre parenthèses?\b/gi,          '('],
    [/\bfermer? la? parenthèse\b/gi,      ')'],
    [/\bnouveau paragraphe\b/gi,          '\n\n'],
    [/\bnouvelle ligne\b/gi,              '\n'],
    [/\bà la ligne\b/gi,                  '\n'],
    [/\bretour à la ligne\b/gi,           '\n'],
    // Single-word patterns last
    [/\bvirgule\b/gi,                     ','],
    [/\bpoint\b/gi,                       '.'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  // Clean up spaces around punctuation
  text = text.replace(/\s+([.,;:?!…»)])/g, '$1');   // no space before
  text = text.replace(/([«(])\s+/g, '$1');           // no space after opening
  text = text.replace(/([.,;:?!…»])\s*/g, '$1 ');    // one space after
  text = text.replace(/\s+\n/g, '\n');               // no trailing space before newline
  text = text.replace(/\n\s+/g, '\n');               // no leading space after newline

  return text;
}

function capitalizeAfterPunctuation(text) {
  return text.replace(/([.!?…]\s+)([a-zàâäéèêëïîôùûüÿç])/g,
    (match, punct, letter) => punct + letter.toUpperCase()
  );
}

// ───────────────────────────────────────────────────────────────
// TIMER
// ───────────────────────────────────────────────────────────────
function startTimer() {
  state.startTime = Date.now();
  updateTimerDisplay();
  state.timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!state.startTime) return;
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  DOM.timer.textContent = `${minutes}:${seconds}`;
}

// ───────────────────────────────────────────────────────────────
// WORD COUNT
// ───────────────────────────────────────────────────────────────
function updateWordCount() {
  const text = DOM.transcript.value.trim();
  const count = text ? text.split(/\s+/).length : 0;
  DOM.wordCount.textContent = `${count} mot${count > 1 ? 's' : ''}`;
}

// ───────────────────────────────────────────────────────────────
// GOOGLE AUTH
// ───────────────────────────────────────────────────────────────
function initGoogleAuth() {
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    DOM.configNotice.style.display = 'flex';
    DOM.exportBtn.title = 'Configuration Google requise — voir README.md';
    return;
  }

  // Wait for GIS library to load
  waitForGIS().then(() => {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: handleAuthResponse,
    });
    DOM.loginBtn.style.display = 'inline-flex';
  }).catch((err) => {
    console.warn('Google Identity Services not loaded:', err);
    DOM.configNotice.style.display = 'flex';
  });
}

function waitForGIS(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.accounts) {
      resolve();
      return;
    }
    const start = Date.now();
    const check = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) {
        clearInterval(check);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(check);
        reject(new Error('GIS timeout'));
      }
    }, 100);
  });
}

function handleAuthResponse(response) {
  if (response.error) {
    console.error('Auth error:', response);
    showToast('Erreur de connexion Google', 'error');
    return;
  }

  state.accessToken = response.access_token;
  fetchUserInfo();

  // If export was pending, do it now
  if (state.pendingExport) {
    state.pendingExport = false;
    exportToGoogleDocs();
  }
}

async function fetchUserInfo() {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    const info = await response.json();

    state.userName = info.given_name || info.name || info.email;
    state.userAvatar = info.picture;

    // Update UI
    DOM.loginBtn.style.display = 'none';
    DOM.userInfo.style.display = 'flex';
    DOM.userName.textContent = state.userName;

    if (info.picture) {
      DOM.userAvatar.innerHTML = `<img src="${info.picture}" alt="Avatar" referrerpolicy="no-referrer">`;
    } else {
      DOM.userAvatar.textContent = (state.userName || '?').charAt(0).toUpperCase();
    }

    showToast(`Bienvenue, ${state.userName} !`, 'success');
  } catch (e) {
    console.warn('Failed to fetch user info:', e);
  }
}

function logout() {
  if (state.accessToken) {
    google.accounts.oauth2.revoke(state.accessToken, () => {
      console.log('Token revoked');
    });
  }

  state.accessToken = null;
  state.userName = null;
  state.userAvatar = null;

  DOM.loginBtn.style.display = 'inline-flex';
  DOM.userInfo.style.display = 'none';
  DOM.userName.textContent = '';
  DOM.userAvatar.innerHTML = '';

  showToast('Déconnecté', 'info');
}

// ───────────────────────────────────────────────────────────────
// GOOGLE DOCS EXPORT
// ───────────────────────────────────────────────────────────────
async function exportToGoogleDocs() {
  const content = DOM.transcript.value.trim();

  if (!content) {
    showToast('Écris ou dicte du texte avant d\'exporter !', 'warning');
    return;
  }

  // If not configured, show notice
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    showToast('Configure d\'abord Google Cloud (voir README)', 'warning');
    return;
  }

  // If not logged in, trigger login then export
  if (!state.accessToken) {
    state.pendingExport = true;
    state.tokenClient.requestAccessToken();
    return;
  }

  const teacher = getSelectedTeacher();
  const baseTitle = DOM.docTitle.value.trim() ||
    `Dictée du ${new Date().toLocaleDateString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })}`;
  const studentPrefix = state.userName ? `[${state.userName}] ` : '';
  const subjectPrefix = teacher ? `[${teacher.subject}] ` : '';
  const title = `${studentPrefix}${subjectPrefix}${baseTitle}`;

  showToast('Création du document…', 'info');
  DOM.exportBtn.disabled = true;

  try {
    // Create a Google Doc via Drive API (multipart upload)
    const metadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
    };

    const boundary = '---dictascol-boundary-' + Date.now();
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: body,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Token expired
      if (response.status === 401) {
        state.accessToken = null;
        state.pendingExport = true;
        state.tokenClient.requestAccessToken();
        return;
      }

      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const file = await response.json();
    const docUrl = `https://docs.google.com/document/d/${file.id}/edit`;

    // Share with selected teacher if any
    if (teacher && teacher.email) {
      showToast(`Partage avec ${teacher.name}…`, 'info');
      const shared = await shareFileWithTeacher(file.id, teacher, title);
      if (shared) {
        showToast(`✅ Copie envoyée à ${teacher.name} !`, 'success', 4000);
      } else {
        showToast(`⚠️ Document créé, mais le partage avec ${teacher.name} a échoué`, 'warning', 4500);
      }
    } else {
      showToast('✅ Document créé dans ton Drive !', 'success');
    }

    // Open the doc
    window.open(docUrl, '_blank');

  } catch (error) {
    console.error('Export error:', error);
    showToast('Erreur lors de la création du document', 'error');
  } finally {
    DOM.exportBtn.disabled = false;
  }
}

async function shareFileWithTeacher(fileId, teacher, docTitle) {
  try {
    const emailMessage = state.userName
      ? `Bonjour ${teacher.name}, voici la copie dictée par ${state.userName} sur DictaScol : "${docTitle}".`
      : `Bonjour ${teacher.name}, voici une copie dictée sur DictaScol : "${docTitle}".`;

    const params = new URLSearchParams({
      sendNotificationEmail: 'true',
      emailMessage: emailMessage,
    });

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'user',
          role: teacher.role || 'writer',
          emailAddress: teacher.email,
        }),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.warn('Share permission error:', errData);
      return false;
    }

    return true;
  } catch (e) {
    console.warn('Failed to share with teacher:', e);
    return false;
  }
}

// ───────────────────────────────────────────────────────────────
// COPY TO CLIPBOARD
// ───────────────────────────────────────────────────────────────
async function copyToClipboard() {
  const text = DOM.transcript.value.trim();
  if (!text) {
    showToast('Rien à copier !', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ Texte copié !', 'success');
  } catch (e) {
    // Fallback
    DOM.transcript.select();
    document.execCommand('copy');
    showToast('✅ Texte copié !', 'success');
  }
}

// ───────────────────────────────────────────────────────────────
// TEXT-TO-SPEECH (Relecture)
// ───────────────────────────────────────────────────────────────
function readAloud() {
  const text = DOM.transcript.value.trim();
  if (!text) {
    showToast('Rien à lire !', 'warning');
    return;
  }

  // Stop if already speaking
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    DOM.listenBtn.textContent = '🔈';
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 0.9; // Slightly slower for clarity

  // Try to find a French voice
  const voices = speechSynthesis.getVoices();
  const frenchVoice = voices.find(v => v.lang.startsWith('fr'));
  if (frenchVoice) {
    utterance.voice = frenchVoice;
  }

  utterance.onstart = () => {
    DOM.listenBtn.textContent = '🔇';
    showToast('🔊 Lecture en cours…', 'info');
  };

  utterance.onend = () => {
    DOM.listenBtn.textContent = '🔈';
  };

  utterance.onerror = () => {
    DOM.listenBtn.textContent = '🔈';
  };

  speechSynthesis.speak(utterance);
}

// ───────────────────────────────────────────────────────────────
// CLEAR TEXT
// ───────────────────────────────────────────────────────────────
function showClearConfirmation() {
  if (!DOM.transcript.value.trim()) return;
  DOM.clearModal.style.display = 'flex';
}

function clearText() {
  DOM.transcript.value = '';
  DOM.docTitle.value = '';
  DOM.clearModal.style.display = 'none';
  updateWordCount();
  clearDraft();
  DOM.listenBtn.style.display = 'none';
  showToast('Texte effacé', 'info');
}

// ───────────────────────────────────────────────────────────────
// FONT TOGGLE
// ───────────────────────────────────────────────────────────────
function toggleFont() {
  state.useDyslexicFont = !state.useDyslexicFont;
  document.body.classList.toggle('font-standard', !state.useDyslexicFont);

  localStorage.setItem('dictascol-font', state.useDyslexicFont ? 'dyslexic' : 'standard');
  showToast(
    state.useDyslexicFont ? 'Police OpenDyslexic activée' : 'Police standard activée',
    'info'
  );
}

// ───────────────────────────────────────────────────────────────
// DRAFT PERSISTENCE (localStorage)
// ───────────────────────────────────────────────────────────────
function saveDraft() {
  try {
    localStorage.setItem('dictascol-draft', JSON.stringify({
      title: DOM.docTitle.value,
      teacher: DOM.teacherSelect ? DOM.teacherSelect.value : '',
      text: DOM.transcript.value,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // Storage full or unavailable, ignore
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem('dictascol-draft');
    if (!raw) return;

    const draft = JSON.parse(raw);

    // Only restore if less than 24 hours old
    if (Date.now() - draft.timestamp > 24 * 60 * 60 * 1000) {
      clearDraft();
      return;
    }

    if (draft.text) {
      DOM.transcript.value = draft.text;
      updateWordCount();
      DOM.listenBtn.style.display = 'inline-flex';
    }
    if (draft.title) {
      DOM.docTitle.value = draft.title;
    }
    if (draft.teacher !== undefined && DOM.teacherSelect) {
      DOM.teacherSelect.value = draft.teacher;
      updateExportButtonLabel();
    }
  } catch (e) {
    // Corrupt data, ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem('dictascol-draft');
  } catch (e) {
    // Ignore
  }
}

// ───────────────────────────────────────────────────────────────
// PREFERENCES
// ───────────────────────────────────────────────────────────────
function loadPreferences() {
  const fontPref = localStorage.getItem('dictascol-font');
  if (fontPref === 'standard') {
    state.useDyslexicFont = false;
    document.body.classList.add('font-standard');
  }
}

// ───────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ───────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');

  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ───────────────────────────────────────────────────────────────
// MODALS
// ───────────────────────────────────────────────────────────────
function openModal(modalEl) {
  modalEl.style.display = 'flex';
  // Close on overlay click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) modalEl.style.display = 'none';
  });
  // Close on Escape
  const handler = (e) => {
    if (e.key === 'Escape') {
      modalEl.style.display = 'none';
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('keydown', handler);
}

// ───────────────────────────────────────────────────────────────
// UI EVENT BINDING
// ───────────────────────────────────────────────────────────────
function initUIEvents() {
  // Microphone
  DOM.micBtn.addEventListener('click', toggleRecording);

  // Export & actions
  DOM.exportBtn.addEventListener('click', exportToGoogleDocs);
  DOM.copyBtn.addEventListener('click', copyToClipboard);
  DOM.clearBtn.addEventListener('click', showClearConfirmation);

  // Clear confirmation modal
  DOM.clearCancel.addEventListener('click', () => {
    DOM.clearModal.style.display = 'none';
  });
  DOM.clearConfirm.addEventListener('click', clearText);

  // Listen (text-to-speech)
  DOM.listenBtn.addEventListener('click', readAloud);

  // Font toggle
  DOM.fontToggle.addEventListener('click', toggleFont);

  // Auth
  DOM.loginBtn.addEventListener('click', () => {
    if (state.tokenClient) {
      state.tokenClient.requestAccessToken();
    }
  });
  DOM.logoutBtn.addEventListener('click', logout);

  // Help modal
  DOM.helpBtn.addEventListener('click', () => openModal(DOM.helpModal));
  DOM.helpClose.addEventListener('click', () => {
    DOM.helpModal.style.display = 'none';
  });

  // Word count on manual edit
  DOM.transcript.addEventListener('input', () => {
    updateWordCount();
    saveDraft();
  });

  // Save title & teacher on change
  DOM.docTitle.addEventListener('input', saveDraft);
  if (DOM.teacherSelect) {
    DOM.teacherSelect.addEventListener('change', () => {
      updateExportButtonLabel();
      saveDraft();
    });
  }

  // Keyboard shortcut: Ctrl+Enter to toggle recording
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      toggleRecording();
    }
  });

  // Ensure voices are loaded for TTS
  if (speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
}

