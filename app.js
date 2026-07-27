/* ════════════════════════════════════════════════════════════
   DECK — app logic
   ════════════════════════════════════════════════════════════ */

const S = {
  notes: [],
  projects: [],
  collections: [
    { id: 'work',     name: 'Work',     color: 'plan' },
    { id: 'personal', name: 'Personal', color: 'idea' },
  ],
  nextSeq:    1,
  col:        'all',
  typeFilter: new Set(),
  tagFilter:  null,
  query:      '',
  capType:    'idea',
  firstRun:   true,
  view:       'catalog',
  studioNoteId: null,
  studioProjectId: null,
  studioLanguage: 'auto',
  activeRunId: null,
  codexStatus: null,
  studioNotice: null,
  pendingInventory: null,
  studioIdeaDraft: '',
  studioResult: null,
  studioProgress: '',
};

const MODEL_CONFIG = {
  context:  { model: 'gpt-5.6-luna', reasoning: 'high' },
  prompt:   { model: 'gpt-5.6-luna', reasoning: 'high' },
};

const GUIDE_COPY = {
  en: {
    label: 'English',
    short: [
      'State the user outcome before implementation details.',
      'Use verified project context and name relevant files or modules.',
      'Separate constraints, acceptance criteria, and verification commands.',
      'Mark uncertainty explicitly; do not invent repository facts.',
      'Define the agent boundary: inspect first, ask about risky ambiguity, and keep changes in scope.',
    ],
    tips: [
      ['01', 'Outcome first', 'Say what should be true when the work is finished.'],
      ['02', 'Context that matters', 'Point to the stack, architecture, conventions, and likely files.'],
      ['03', 'A clean finish line', 'Give acceptance criteria and the exact checks that prove them.'],
      ['04', 'Boundaries', 'Tell the agent what is safe to change and when it must ask.'],
    ],
  },
  tr: {
    label: 'Türkçe',
    short: [
      'Uygulama detaylarından önce kullanıcıya sağlayacağı sonucu söyle.',
      'Doğrulanmış proje context’ini kullan ve ilgili dosya/modülleri belirt.',
      'Kısıtları, kabul kriterlerini ve doğrulama komutlarını ayrı yaz.',
      'Belirsizliği açıkça işaretle; repository bilgisi uydurma.',
      'Agent sınırını tanımla: önce incele, riskli belirsizlikte soru sor ve kapsam içinde kal.',
    ],
    tips: [
      ['01', 'Sonuçla başla', 'İş bittiğinde neyin doğru olması gerektiğini söyle.'],
      ['02', 'İşe yarayan context', 'Stack’i, mimariyi, kuralları ve muhtemel dosyaları göster.'],
      ['03', 'Net bitiş çizgisi', 'Kabul kriterlerini ve bunları kanıtlayan kontrolleri ver.'],
      ['04', 'Sınırlar', 'Agent’ın neyi değiştirebileceğini ve ne zaman soru soracağını belirt.'],
    ],
  },
};

// ─────────────────────────────────────────────────
// PERSISTENCE
// Desktop app (Electron): saves to a real JSON file on disk via the
// preload bridge (window.deckStorage). Plain browser tab: falls back
// to localStorage. Same S shape either way.
// ─────────────────────────────────────────────────
function hasDesktopBridge() {
  return typeof window !== 'undefined' && !!window.deckStorage;
}

async function loadState() {
  let raw = null;
  try {
    raw = hasDesktopBridge() ? await window.deckStorage.load() : localStorage.getItem('deck_v3');
  } catch (_) {}
  if (!raw) return; // firstRun stays true
  S.firstRun = false;
  try {
    const d = JSON.parse(raw);
    if (d.notes)       S.notes       = d.notes;
    if (d.collections) S.collections = d.collections;
    if (d.nextSeq)     S.nextSeq     = d.nextSeq;
    if (Array.isArray(d.projects)) S.projects = d.projects.map(normalizeProject);
    S.notes = S.notes.map(n => ({ ...n, promptHistory: Array.isArray(n.promptHistory) ? n.promptHistory : [] }));
    if (!S.studioProjectId && S.projects[0]) S.studioProjectId = S.projects[0].id;
  } catch (_) {}
}

function persist() {
  const json = JSON.stringify({
    notes: S.notes,
    projects: S.projects,
    collections: S.collections,
    nextSeq: S.nextSeq,
  });
  if (hasDesktopBridge()) {
    window.deckStorage.save(json).catch(() => {});
  } else {
    try { localStorage.setItem('deck_v3', json); } catch (_) {}
  }
}

function normalizeProject(project) {
  const p = project || {};
  return {
    id: p.id || uid(),
    name: p.name || 'Untitled project',
    rootPath: p.rootPath || '',
    trustedAt: p.trustedAt || null,
    includedFiles: Array.isArray(p.includedFiles) ? p.includedFiles : [],
    excludedFiles: Array.isArray(p.excludedFiles) ? p.excludedFiles : [],
    truncated: !!p.truncated,
    includedCount: p.includedCount || 0,
    excludedCount: p.excludedCount || 0,
    includedBytes: p.includedBytes || 0,
    context: p.context || null,
    contextVersion: p.contextVersion || 0,
    contextGeneratedAt: p.contextGeneratedAt || null,
    contextStatus: p.contextStatus || 'idle',
    contextError: p.contextError || '',
  };
}

function isDesktopCodex() {
  return typeof window !== 'undefined' && !!window.deckCodex;
}

// Day / Night theme handling lives in theme.js (shared with landing.html)

// ─────────────────────────────────────────────────
// NOTE OPS
// ─────────────────────────────────────────────────
function addNote() {
  const ta   = q('#capture-ta');
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }

  const colSel = q('#cap-col');
  const note = {
    id:           uid(),
    seq:          S.nextSeq++,
    content:      text,
    type:         S.capType,
    tags:         extractTags(text),
    collectionId: colSel.value || null,
    pinned:       false,
    done:         false,
    promptHistory: [],
    createdAt:    Date.now(),
    updatedAt:    Date.now(),
  };

  S.notes.unshift(note);
  S.firstRun = false;
  persist();

  ta.value = '';
  ta.style.height = '';
  ta.focus();
  render();
}

function togglePin(id) {
  const n = S.notes.find(x => x.id === id);
  if (n) { n.pinned = !n.pinned; persist(); render(); }
}

function toggleDone(id) {
  const n = S.notes.find(x => x.id === id);
  if (n) { n.done = !n.done; n.updatedAt = Date.now(); persist(); render(); }
}

function deleteNote(id) {
  S.notes = S.notes.filter(x => x.id !== id);
  persist(); render();
}

function commitEdit(id, text) {
  const n = S.notes.find(x => x.id === id);
  if (!n || !text || text === n.content) return;
  n.content   = text;
  n.tags      = extractTags(text);
  n.updatedAt = Date.now();
  persist(); render();
}

// ─────────────────────────────────────────────────
// FILTER + VIEW STATE
// ─────────────────────────────────────────────────
function setCol(id) {
  S.col = id; S.tagFilter = null; S.view = 'catalog';
  closeRail();
  render();
}

function openPromptStudio(noteId = S.studioNoteId) {
  S.view = 'studio';
  if (noteId) {
    S.studioNoteId = noteId;
    const note = selectedStudioNote();
    if (note) S.studioIdeaDraft = note.content;
  }
  if (!S.studioProjectId && S.projects[0]) S.studioProjectId = S.projects[0].id;
  closeRail();
  render();
}

function openCatalog() {
  S.view = 'catalog';
  render();
}

function toggleTF(type) {
  S.typeFilter.has(type) ? S.typeFilter.delete(type) : S.typeFilter.add(type);
  qAll('.type-chip').forEach(el =>
    el.classList.toggle('active', S.typeFilter.has(el.dataset.t))
  );
  render();
}

function filterByTag(tag) {
  S.tagFilter = S.tagFilter === tag ? null : tag;
  render();
}

function getFiltered() {
  let ns = [...S.notes];

  if (S.col === 'pinned')
    ns = ns.filter(n => n.pinned);
  else if (S.col !== 'all')
    ns = ns.filter(n => n.collectionId === S.col);

  if (S.typeFilter.size > 0)
    ns = ns.filter(n => S.typeFilter.has(n.type));

  if (S.tagFilter)
    ns = ns.filter(n => n.tags.includes(S.tagFilter));

  if (S.query) {
    const query = S.query.toLowerCase();
    const tagQuery = query.replace(/^#/, '');
    ns = ns.filter(n =>
      n.content.toLowerCase().includes(query) ||
      n.tags.some(t => t.includes(tagQuery))
    );
  }

  return ns;
}

// ─────────────────────────────────────────────────
// CAPTURE TYPE
// ─────────────────────────────────────────────────
function setType(t) {
  S.capType = t;
  qAll('#type-row .stamp-btn').forEach(el =>
    el.classList.toggle('active', el.dataset.t === t)
  );
}

// ─────────────────────────────────────────────────
// COLLECTIONS
// ─────────────────────────────────────────────────
const COL_COLORS = ['idea', 'plan', 'task', 'done', 'note'];

function showColForm() {
  q('#add-col-btn').style.display = 'none';
  q('#new-col-form').classList.add('show');
  q('#new-col-input').focus();
}

function hideColForm() {
  q('#add-col-btn').style.display = '';
  q('#new-col-form').classList.remove('show');
  q('#new-col-input').value = '';
}

function createCol() {
  const input = q('#new-col-input');
  const name  = input.value.trim();
  if (!name) return;
  const id    = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + uid();
  const color = COL_COLORS[S.collections.length % COL_COLORS.length];
  S.collections.push({ id, name, color });
  persist();
  hideColForm();
  renderCols();
  renderCapCol();
  setCol(id);
}

function deleteCol(id) {
  const col = S.collections.find(c => c.id === id);
  if (!confirm(`Remove the "${col?.name}" drawer? Its cards return to the main catalog.`)) return;
  S.collections = S.collections.filter(c => c.id !== id);
  S.notes       = S.notes.map(n => n.collectionId === id ? { ...n, collectionId: null } : n);
  persist();
  if (S.col === id) setCol('all');
  else { renderCols(); renderCapCol(); }
}

// ─────────────────────────────────────────────────
// PROMPT STUDIO + CODEX PIPELINE
// ─────────────────────────────────────────────────
function activeProject() {
  return S.projects.find(project => project.id === S.studioProjectId) || S.projects[0] || null;
}

function selectedStudioNote() {
  return S.notes.find(note => note.id === S.studioNoteId) || null;
}

function chooseProject() {
  if (!isDesktopCodex()) {
    S.studioNotice = 'Prompt Studio needs the Electron desktop app to choose a folder and run Codex.';
    renderStudio();
    return;
  }
  window.deckCodex.pickProjectDirectory().then(inventory => {
    if (!inventory) return;
    S.pendingInventory = inventory;
    S.studioNotice = null;
    renderStudio();
  }).catch(err => {
    S.studioNotice = err.message || 'The project folder could not be inspected.';
    renderStudio();
  });
}

function cancelPendingProject() {
  S.pendingInventory = null;
  renderStudio();
}

function trustPendingProject() {
  const inventory = S.pendingInventory;
  if (!inventory) return;
  const existing = S.projects.find(project => project.rootPath === inventory.rootPath);
  if (existing) {
    existing.trustedAt = existing.trustedAt || Date.now();
    existing.includedFiles = inventory.includedFiles;
    existing.excludedFiles = inventory.excludedFiles;
    existing.includedCount = inventory.includedCount;
    existing.excludedCount = inventory.excludedCount;
    existing.includedBytes = inventory.includedBytes;
    existing.truncated = inventory.truncated;
    S.studioProjectId = existing.id;
    S.pendingInventory = null;
    S.studioNotice = 'Project inventory refreshed. Your existing context is still available.';
    persist();
    render();
    return;
  }
  const project = normalizeProject({
    id: uid(),
    name: inventory.name,
    rootPath: inventory.rootPath,
    trustedAt: Date.now(),
    includedFiles: inventory.includedFiles,
    excludedFiles: inventory.excludedFiles,
    truncated: inventory.truncated,
    includedCount: inventory.includedCount,
    excludedCount: inventory.excludedCount,
    includedBytes: inventory.includedBytes,
    contextStatus: 'idle',
  });
  S.projects.unshift(project);
  S.studioProjectId = project.id;
  S.pendingInventory = null;
  S.studioNotice = 'Project trusted locally. Run the first context pass when you are ready.';
  persist();
  render();
}

function selectStudioProject(id) {
  if (!S.projects.some(project => project.id === id)) return;
  S.studioProjectId = id;
  S.studioResult = null;
  S.studioNotice = null;
  persist();
  renderStudio();
}

function deleteProject(id) {
  const project = S.projects.find(item => item.id === id);
  if (!project) return;
  if (!confirm('Remove the "' + project.name + '" project context? Cards and their drawers will stay intact.')) return;
  S.projects = S.projects.filter(item => item.id !== id);
  if (S.studioProjectId === id) S.studioProjectId = S.projects[0]?.id || null;
  S.studioResult = null;
  persist();
  render();
}

function extractProjectContext() {
  const project = activeProject();
  if (!project || !isDesktopCodex() || S.activeRunId) return;
  project.contextStatus = 'running';
  project.contextError = '';
  S.studioNotice = null;
  S.studioProgress = 'Starting the read-only context pass…';
  persist();
  renderStudio();

  window.deckCodex.extractContext({
    rootPath: project.rootPath,
    model: MODEL_CONFIG.context.model,
    reasoning: MODEL_CONFIG.context.reasoning,
  }).then(result => {
    project.context = normalizeContext(result.result);
    project.contextVersion = (project.contextVersion || 0) + 1;
    project.contextGeneratedAt = Date.now();
    project.contextStatus = 'review';
    project.includedFiles = result.inventory.includedFiles;
    project.excludedFiles = result.inventory.excludedFiles;
    project.includedCount = result.inventory.includedCount;
    project.excludedCount = result.inventory.excludedCount;
    project.includedBytes = result.inventory.includedBytes;
    project.truncated = result.inventory.truncated;
    S.activeRunId = null;
    S.studioProgress = '';
    S.studioNotice = 'Context ready for review. Check the facts before handing it to the prompt editor.';
    persist();
    render();
  }).catch(err => {
    const cancelled = /cancelled/i.test(err.message || '');
    project.contextStatus = cancelled ? 'idle' : 'error';
    project.contextError = cancelled ? '' : (err.message || 'Context extraction failed.');
    S.activeRunId = null;
    S.studioProgress = '';
    persist();
    renderStudio();
  });
}

function normalizeContext(context) {
  const c = context || {};
  return {
    summary: String(c.summary || ''),
    technologies: Array.isArray(c.technologies) ? c.technologies : [],
    architecture: String(c.architecture || ''),
    entryPoints: Array.isArray(c.entryPoints) ? c.entryPoints : [],
    keyFiles: Array.isArray(c.keyFiles) ? c.keyFiles : [],
    conventions: Array.isArray(c.conventions) ? c.conventions : [],
    commands: {
      install: String(c.commands?.install || ''),
      dev: String(c.commands?.dev || ''),
      test: String(c.commands?.test || ''),
      lint: String(c.commands?.lint || ''),
      build: String(c.commands?.build || ''),
    },
    risks: Array.isArray(c.risks) ? c.risks : [],
    openQuestions: Array.isArray(c.openQuestions) ? c.openQuestions : [],
  };
}

function contextEditorValue(project) {
  return JSON.stringify(project?.context || {}, null, 2);
}

function saveContextEdits(approve = false) {
  const project = activeProject();
  const editor = q('#context-editor');
  if (!project || !editor) return;
  try {
    project.context = normalizeContext(JSON.parse(editor.value));
    project.contextStatus = approve ? 'ready' : project.contextStatus;
    project.contextError = '';
    S.studioNotice = approve
      ? 'Context approved. Choose a card below to shape the prompt.'
      : 'Context edits saved locally.';
    persist();
    render();
  } catch (_) {
    S.studioNotice = 'Context must be valid JSON before it can be saved.';
    renderStudio();
  }
}

function approveContext() {
  saveContextEdits(true);
}

function setStudioLanguage(language) {
  S.studioLanguage = ['auto', 'en', 'tr'].includes(language) ? language : 'auto';
  renderStudio();
}

function detectLanguage(text) {
  const value = String(text || '').toLowerCase();
  if (/[çğıöşü]/i.test(value)) return 'tr';
  const trWords = (value.match(/\b(ve|ile|için|bir|bu|şu|geliştir|ekle|düzelt|kullanıcı)\b/g) || []).length;
  return trWords >= 2 ? 'tr' : 'en';
}

function currentGuideLanguage() {
  if (S.studioLanguage !== 'auto') return S.studioLanguage;
  const note = selectedStudioNote();
  return detectLanguage(note?.content || activeProject()?.context?.summary || '');
}

function localizedGuide(language) {
  const copy = GUIDE_COPY[language] || GUIDE_COPY.en;
  return copy.short.map(item => '- ' + item).join('\n');
}

function selectStudioNote(id) {
  S.studioNoteId = id || null;
  const note = selectedStudioNote();
  S.studioIdeaDraft = note?.content || '';
  S.studioResult = null;
  renderStudio();
}

function generateStudioPrompt() {
  const project = activeProject();
  const idea = String(q('#studio-idea')?.value || S.studioIdeaDraft || '').trim();
  if (!project || project.contextStatus !== 'ready') {
    S.studioNotice = 'Approve a project context before generating a prompt.';
    renderStudio();
    return;
  }
  if (!idea) {
    S.studioNotice = 'Choose a card or write the idea you want to shape.';
    q('#studio-idea')?.focus();
    renderStudio();
    return;
  }
  if (!isDesktopCodex()) {
    S.studioNotice = 'Prompt generation needs the Electron desktop app and a logged-in Codex CLI.';
    renderStudio();
    return;
  }

  S.studioIdeaDraft = idea;
  S.studioResult = { status: 'running' };
  S.studioProgress = 'The prompt editor is reading the approved context…';
  S.studioNotice = null;
  renderStudio();

  const language = currentGuideLanguage();
  window.deckCodex.generatePrompt({
    rootPath: project.rootPath,
    idea,
    context: project.context,
    guide: localizedGuide(language),
    language,
    model: MODEL_CONFIG.prompt.model,
    reasoning: MODEL_CONFIG.prompt.reasoning,
  }).then(result => {
    S.studioResult = {
      status: 'ready',
      ...result.result,
      language,
      model: MODEL_CONFIG.prompt.model,
      reasoning: MODEL_CONFIG.prompt.reasoning,
      generatedAt: Date.now(),
      saved: false,
    };
    S.activeRunId = null;
    S.studioProgress = '';
    S.studioNotice = 'Prompt ready. Edit it if you want, then copy it to your coding agent.';
    renderStudio();
  }).catch(err => {
    S.studioResult = null;
    S.activeRunId = null;
    S.studioProgress = '';
    S.studioNotice = /cancelled/i.test(err.message || '') ? 'Prompt generation cancelled.' : (err.message || 'Prompt generation failed.');
    renderStudio();
  });
}

function savePromptHistory() {
  const project = activeProject();
  const note = selectedStudioNote();
  const result = S.studioResult;
  const output = q('#studio-output');
  if (!project || !result || result.status !== 'ready' || !output) return false;
  if (!note) {
    S.studioNotice = 'Choose an existing card before saving this prompt history.';
    return false;
  }
  if (result.saved) return true;
  result.prompt = output.value;
  note.promptHistory = Array.isArray(note.promptHistory) ? note.promptHistory : [];
  note.promptHistory.unshift({
    id: uid(),
    projectId: project.id,
    contextVersion: project.contextVersion,
    language: result.language,
    model: result.model,
    reasoning: result.reasoning,
    prompt: output.value,
    title: result.title || 'Untitled prompt',
    assumptions: result.assumptions || [],
    verificationSteps: result.verificationSteps || [],
    createdAt: Date.now(),
  });
  result.saved = true;
  persist();
  return true;
}

async function copyStudioPrompt() {
  const output = q('#studio-output');
  if (!output?.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
  } catch (_) {
    output.focus();
    output.select();
    try { document.execCommand('copy'); } catch (_) {}
  }
  const saved = savePromptHistory();
  S.studioNotice = saved
    ? 'Prompt copied and saved to this card’s history.'
    : 'Prompt copied. Choose a source card if you want to keep a history entry.';
  renderStudio();
}

function saveStudioPrompt() {
  if (savePromptHistory()) {
    S.studioNotice = 'Prompt version saved to the selected card.';
    renderStudio();
  }
}

function cancelCodexRun() {
  if (!S.activeRunId || !isDesktopCodex()) return;
  window.deckCodex.cancelRun(S.activeRunId).catch(() => {});
  S.activeRunId = null;
  S.studioProgress = '';
  const project = activeProject();
  if (project?.contextStatus === 'running') project.contextStatus = 'idle';
  S.studioResult = null;
  renderStudio();
}

function formatBytes(bytes) {
  if (!bytes) return '0 bytes';
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function studioDate(ts) {
  return ts ? new Date(ts).toLocaleString() : 'Not generated yet';
}

function studioNoticeHTML() {
  if (!S.studioNotice) return '';
  return '<div class="studio-notice" role="status"><span class="studio-notice-dot"></span>' +
    esc(S.studioNotice) + '</div>';
}

function filePreviewHTML(files, limit = 8) {
  const list = (files || []).slice(0, limit);
  if (!list.length) return '<p class="studio-muted">No files in this group.</p>';
  return '<ul class="file-preview">' + list.map(file => {
    const label = typeof file === 'string' ? file : file.path;
    const meta = typeof file === 'string' ? '' : ' <small>' + formatBytes(file.bytes) + '</small>';
    return '<li><code>' + esc(label) + '</code>' + meta + '</li>';
  }).join('') + ((files || []).length > limit ? '<li class="file-preview-more">+' + ((files || []).length - limit) + ' more</li>' : '') + '</ul>';
}

function guideTipsHTML(language) {
  const copy = GUIDE_COPY[language] || GUIDE_COPY.en;
  return '<div class="guide-tips">' + copy.tips.map(item =>
    '<div class="guide-tip"><span>' + item[0] + '</span><div><strong>' + esc(item[1]) + '</strong><p>' + esc(item[2]) + '</p></div></div>'
  ).join('') + '</div>';
}

function contextStatusLabel(status) {
  const labels = {
    idle: 'Not mapped',
    running: 'Reading project',
    review: 'Needs review',
    ready: 'Approved',
    error: 'Needs retry',
  };
  return labels[status] || 'Not mapped';
}

function renderContextPanel(project) {
  const status = project.contextStatus || 'idle';
  const running = status === 'running';
  let body = '';

  if (running) {
    body = '<div class="studio-running"><span class="studio-spinner"></span><div><strong>Codex is mapping the project.</strong><p>' +
      esc(S.studioProgress || 'Reading files in read-only mode…') + '</p></div><button class="btn btn-line" onclick="cancelCodexRun()">Cancel</button></div>';
  } else if (status === 'review' || status === 'ready') {
    body = '<div class="context-review-copy"><p>Review the generated brief before the prompt editor sees it. You can correct the JSON locally without sending another request.</p></div>' +
      '<textarea class="context-editor" id="context-editor" spellcheck="false" aria-label="Project context JSON">' +
      esc(contextEditorValue(project)) + '</textarea>' +
      '<div class="studio-inline-actions">' +
      '<button class="btn btn-fill" onclick="' + (status === 'review' ? 'approveContext()' : 'saveContextEdits(false)') + '">' +
      (status === 'review' ? 'Approve context' : 'Save context edits') + '</button>' +
      '<button class="btn btn-line" onclick="extractProjectContext()">Refresh</button>' +
      '</div>';
  } else {
    body = '<div class="context-empty"><div class="context-mark">⌁</div><strong>Map this codebase first.</strong><p>Codex will read the selected project in read-only mode and return a compact, editable brief.</p>' +
      '<button class="btn btn-fill" onclick="extractProjectContext()">Run context pass</button></div>';
    if (status === 'error') {
      body = '<div class="studio-error"><strong>Context pass failed.</strong><p>' + esc(project.contextError) + '</p>' +
        '<button class="btn btn-line" onclick="extractProjectContext()">Retry</button></div>';
    }
  }

  return '<section class="studio-sheet context-sheet">' +
    '<div class="sheet-heading"><div><p class="sheet-step">01 · CONTEXT</p><h3>Project context</h3></div><span class="status-stamp status-' + status + '">' + contextStatusLabel(status) + '</span></div>' +
    '<p class="sheet-sub">The smaller pass maps the repo once. The next pass only receives what you approve.</p>' +
    '<div class="project-facts"><span><b>' + project.includedCount + '</b> included</span><span><b>' + project.excludedCount + '</b> excluded</span><span><b>' + formatBytes(project.includedBytes) + '</b> scanned</span></div>' +
    body +
    '<p class="studio-source-line">Last generated: ' + studioDate(project.contextGeneratedAt) + '</p>' +
    '</section>';
}

function renderStudio() {
  const stage = q('#studio-stage');
  if (!stage) return;

  if (!isDesktopCodex()) {
    stage.innerHTML = '<div class="studio-unavailable">' +
      '<div class="studio-unavailable-mark">↗</div><p class="studio-overline">DESKTOP BRIDGE REQUIRED</p>' +
      '<h3>Prompt Studio lives beside your project folder.</h3>' +
      '<p>The browser catalog still works here. Open Deck as an Electron app to choose a repo and run your local Codex CLI session.</p>' +
      '<button class="btn btn-fill" onclick="openCatalog()">Back to catalog</button></div>' + studioNoticeHTML();
    return;
  }

  if (S.pendingInventory) {
    const inventory = S.pendingInventory;
    stage.innerHTML = '<div class="studio-sheet trust-sheet">' +
      '<div class="sheet-heading"><div><p class="sheet-step">01 · CONTEXT</p><h3>Trust a project folder</h3></div><span class="status-stamp status-review">Review access</span></div>' +
      '<p class="sheet-sub">Deck will ask Codex to read this folder in read-only mode. This approval is remembered for this project.</p>' +
      '<div class="trust-project"><span class="folder-glyph">⌂</span><div><strong>' + esc(inventory.name) + '</strong><code>' + esc(inventory.rootPath) + '</code></div></div>' +
      '<div class="project-facts"><span><b>' + inventory.includedCount + '</b> included</span><span><b>' + inventory.excludedCount + '</b> excluded</span><span><b>' + formatBytes(inventory.includedBytes) + '</b> scanned</span></div>' +
      '<div class="trust-columns"><div><p class="block-label">Will be available</p>' + filePreviewHTML(inventory.includedFiles) + '</div><div><p class="block-label">Excluded by default</p>' + filePreviewHTML(inventory.excludedFiles) + '</div></div>' +
      '<div class="studio-inline-actions"><button class="btn btn-fill" onclick="trustPendingProject()">Trust and continue</button><button class="btn btn-line" onclick="cancelPendingProject()">Cancel</button></div>' +
      '</div>' + studioNoticeHTML();
    return;
  }

  if (!S.projects.length) {
    stage.innerHTML = '<div class="studio-empty-state">' +
      '<div class="studio-empty-mark"><span></span><span></span><span></span></div>' +
      '<p class="studio-overline">01 · CONTEXT</p><h3>Start with a project, not a blank prompt.</h3>' +
      '<p>Choose the folder you are building in. Deck will make the first context brief with your existing Codex login, then keep the result on this machine.</p>' +
      '<button class="btn btn-fill" onclick="chooseProject()">Choose project folder</button></div>' + studioNoticeHTML();
    return;
  }

  const project = activeProject();
  const language = currentGuideLanguage();
  const copy = GUIDE_COPY[language] || GUIDE_COPY.en;
  const note = selectedStudioNote();
  const result = S.studioResult;
  const projectOptions = S.projects.map(item => '<option value="' + esc(item.id) + '"' + (item.id === project.id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('');
  const noteOptions = '<option value="">Write a new idea…</option>' + S.notes.map(item =>
    '<option value="' + esc(item.id) + '"' + (item.id === S.studioNoteId ? ' selected' : '') + '>' +
    esc(item.type.toUpperCase() + ' · ' + item.content.replace(/\s+/g, ' ').slice(0, 72)) + '</option>'
  ).join('');
  const history = (note?.promptHistory || []).filter(item => item.projectId === project.id).slice(0, 4);
  const historyHTML = history.length ? '<div class="prompt-history"><p class="block-label">Recent versions</p>' + history.map(item =>
    '<div class="history-row"><span>' + esc(item.title || 'Prompt') + '</span><small>' + studioDate(item.createdAt) + ' · ' + esc(item.language) + '</small></div>'
  ).join('') + '</div>' : '';
  const output = result?.status === 'ready' ? result.prompt : '';
  const codexWarning = S.codexStatus && !S.codexStatus.available
    ? '<div class="studio-warning">Codex CLI unavailable: ' + esc(S.codexStatus.error || 'check your installation') + '</div>'
    : '';

  stage.innerHTML = '<div class="studio-toolbar">' +
    '<div class="studio-project-picker"><label for="studio-project-select">Working project</label><select id="studio-project-select">' + projectOptions + '</select></div>' +
    '<div class="studio-toolbar-actions"><button class="btn btn-line" onclick="chooseProject()">Add project</button><button class="btn btn-quiet" onclick="deleteProject(\'' + project.id + '\')">Remove</button></div>' +
    '</div>' + codexWarning + studioNoticeHTML() +
    '<div class="studio-grid">' +
    renderContextPanel(project) +
    '<section class="studio-sheet guide-sheet"><div class="sheet-heading"><div><p class="sheet-step">02 · GUIDE</p><h3>Prompt guide</h3></div><div class="language-toggle" role="group" aria-label="Prompt language">' +
    '<button class="' + (S.studioLanguage === 'auto' ? 'active' : '') + '" onclick="setStudioLanguage(\'auto\')">Auto</button>' +
    '<button class="' + (S.studioLanguage === 'en' ? 'active' : '') + '" onclick="setStudioLanguage(\'en\')">EN</button>' +
    '<button class="' + (S.studioLanguage === 'tr' ? 'active' : '') + '" onclick="setStudioLanguage(\'tr\')">TR</button></div></div>' +
    '<p class="sheet-sub">A short set of rules keeps the final brief concrete without turning it into a wall of instructions.</p>' +
    guideTipsHTML(language) +
    '<div class="guide-language-note"><span class="guide-language-mark">A</span><span>Prompt language: <b>' + copy.label + '</b>' + (S.studioLanguage === 'auto' ? ' · detected' : '') + '</span></div>' +
    '</section></div>' +
    '<section class="prompt-deck"><div class="prompt-deck-heading"><div><p class="sheet-step">03 · PROMPT</p><h3>Shape a card for this project</h3></div><span class="model-stamp">gpt-5.6-luna · high</span></div>' +
    '<div class="prompt-source-row"><label for="studio-note-select">Source card</label><select id="studio-note-select">' + noteOptions + '</select></div>' +
    '<textarea class="studio-idea" id="studio-idea" placeholder="Choose a card or write the idea you want to turn into an implementation brief…">' + esc(S.studioIdeaDraft || note?.content || '') + '</textarea>' +
    '<div class="prompt-actions"><span class="studio-progress" id="studio-progress">' + esc(S.studioProgress) + '</span><button class="file-btn prompt-generate-btn" onclick="generateStudioPrompt()"' + (project.contextStatus !== 'ready' || result?.status === 'running' ? ' disabled' : '') + '>Generate prompt <kbd>↗</kbd></button></div>' +
    '<div class="generated-prompt"><div class="generated-prompt-head"><span>Generated brief</span><span class="generated-meta">' + (result?.status === 'ready' ? esc(result.title || 'Ready to copy') : 'Awaiting an approved context') + '</span></div>' +
    '<textarea class="studio-output" id="studio-output" spellcheck="false" placeholder="Your project-aware prompt will appear here…">' + esc(output) + '</textarea>' +
    '<div class="prompt-output-actions"><button class="btn btn-fill" onclick="copyStudioPrompt()"' + (!output ? ' disabled' : '') + '>Copy to agent</button><button class="btn btn-line" onclick="saveStudioPrompt()"' + (!output ? ' disabled' : '') + '>Save version</button></div></div>' +
    historyHTML + '</section>';

  bindStudioEvents();
}

function bindStudioEvents() {
  q('#studio-project-select')?.addEventListener('change', e => selectStudioProject(e.target.value));
  q('#studio-note-select')?.addEventListener('change', e => selectStudioNote(e.target.value));
  q('#studio-idea')?.addEventListener('input', e => { S.studioIdeaDraft = e.target.value; });
  const progress = q('#studio-progress');
  if (progress && S.studioProgress) progress.textContent = S.studioProgress;
}

// ─────────────────────────────────────────────────
// INLINE EDIT
// ─────────────────────────────────────────────────
function startEdit(e) {
  const el = e.currentTarget;
  if (el.isContentEditable) return;
  const note = S.notes.find(n => n.id === el.dataset.id);
  if (!note) return;

  el.contentEditable = 'true';
  el.textContent      = note.content;
  el.focus();

  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (_) {}
}

function finishEdit(e) {
  const el = e.currentTarget;
  if (!el.isContentEditable) return;
  el.contentEditable = 'false';

  const id   = el.dataset.id;
  const note = S.notes.find(n => n.id === id);
  if (!note) return;
  const newText = el.textContent.trim();

  if (newText && newText !== note.content) commitEdit(id, newText);
  else el.innerHTML = hlTags(note.content);
}

function editKey(e) {
  e.stopPropagation();
  const el = e.currentTarget;
  if (e.key === 'Escape') {
    const note = S.notes.find(n => n.id === el.dataset.id);
    if (note) el.innerHTML = hlTags(note.content);
    el.contentEditable = 'false';
    el.blur();
    e.preventDefault();
  }
}

// ─────────────────────────────────────────────────
// MOBILE RAIL
// ─────────────────────────────────────────────────
function openRail() {
  q('.rail').classList.add('open');
  q('#rail-backdrop').classList.add('show');
}
function closeRail() {
  q('.rail').classList.remove('open');
  q('#rail-backdrop').classList.remove('show');
}
function toggleRail() {
  q('.rail').classList.contains('open') ? closeRail() : openRail();
}

// ─────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────
function q(sel)    { return document.querySelector(sel); }
function qAll(sel) { return document.querySelectorAll(sel); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function extractTags(text) {
  const m = text.match(/#(\w+)/g);
  if (!m) return [];
  return [...new Set(m.map(t => t.slice(1).toLowerCase()))];
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)   return `${days}d`;
  if (days < 30)  return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hlTags(content) {
  return esc(content).replace(/#\w+/g, m => `<span class="tag-ink">${m}</span>`);
}

// Deterministic tiny rotation per card id, gives the "hand-filed" feel
function rotationFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const t = (h % 1000) / 1000;             // 0..1
  return (t * 1.2 - 0.6).toFixed(2) + 'deg'; // -0.6deg .. 0.6deg
}

function catalogNumber(seq) {
  return 'No. ' + String(seq).padStart(3, '0');
}

// ─────────────────────────────────────────────────
// CARD HTML
// ─────────────────────────────────────────────────
function cardHTML(note) {
  const col    = note.collectionId ? S.collections.find(c => c.id === note.collectionId) : null;
  const isTask = note.type === 'task';
  const dateStr = new Date(note.createdAt).toLocaleString();

  return `
  <div class="cat-card ${note.pinned ? 'pinned' : ''}" data-id="${note.id}" style="--r:${rotationFor(note.id)}">
    <div class="cat-head">
      <span class="cat-stamp" data-t="${note.type}">${note.type.toUpperCase()}</span>
      <div class="cat-actions">
        <button class="cat-act prompt-act" onclick="openPromptStudio('${note.id}')" title="Shape prompt" aria-label="Shape prompt">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 10.8 10.8 3M7.8 2.8h3.4v3.4M3.2 3.2h3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        ${isTask ? `
        <button class="cat-act ${note.done ? 'done-on' : ''}"
                onclick="toggleDone('${note.id}')"
                title="${note.done ? 'Mark undone' : 'Mark done'}"
                aria-pressed="${note.done}">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5.3" stroke="currentColor" stroke-width="1.3"/>
            ${note.done ? '<path d="M4.5 7.2l2 2 3-3.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' : ''}
          </svg>
        </button>` : ''}
        <button class="cat-act ${note.pinned ? 'on' : ''}"
                onclick="togglePin('${note.id}')"
                title="${note.pinned ? 'Unpin' : 'Pin'}"
                aria-pressed="${note.pinned}">
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M8 1.5l3.5 3.5L9 7.5 8 6.5 4.5 10l-2-2L6 4.5 5 3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M1.5 11.5l2.8-2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="cat-act del" onclick="deleteNote('${note.id}')" title="Delete">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="cat-body ${note.done ? 'is-done' : ''}"
         data-id="${note.id}"
         contenteditable="false"
         onclick="startEdit(event)"
         onblur="finishEdit(event)"
         onkeydown="editKey(event)"
         title="Click to edit"
         role="textbox"
         aria-multiline="true"
         aria-label="Card content">${hlTags(note.content)}</div>

    <div class="cat-foot">
      <div class="cat-tags">
        ${note.tags.map(t =>
          `<button class="cat-tag" onclick="filterByTag('${t}')" title="Filter by #${t}">#${t}</button>`
        ).join('')}
      </div>
      <div class="cat-meta">
        ${col ? `<span class="cat-col-label">${esc(col.name)}</span>` : ''}
        <span class="cat-num" title="${dateStr} · ${timeAgo(note.createdAt)} ago">${catalogNumber(note.seq)}</span>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────
// RENDER HELPERS
// ─────────────────────────────────────────────────
function renderCols() {
  const nav = q('#col-tabs');
  if (!S.collections.length) { nav.innerHTML = ''; return; }

  let h = '<div class="rail-label">Drawers</div>';
  for (const col of S.collections) {
    const cnt = S.notes.filter(n => n.collectionId === col.id).length;
    h += `
    <div class="tab-wrap">
      <button class="tab ${S.col === col.id ? 'active' : ''}" data-col="${col.id}" onclick="setCol('${col.id}')">
        <span class="tab-chip" style="background:var(--${col.color})"></span>
        <span class="tab-name">${esc(col.name)}</span>
        <span class="tab-count">${cnt}</span>
      </button>
      <button class="tab-del" onclick="deleteCol('${col.id}')" title="Remove drawer" aria-label="Remove ${esc(col.name)}">×</button>
    </div>`;
  }
  nav.innerHTML = h;
}

function renderCapCol() {
  const sel = q('#cap-col');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Inbox</option>';
  for (const col of S.collections) {
    const opt = document.createElement('option');
    opt.value = col.id;
    opt.textContent = col.name;
    if (col.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

// ─────────────────────────────────────────────────
// MAIN RENDER
// ─────────────────────────────────────────────────
function render() {
  const studio = S.view === 'studio';
  const ns      = getFiltered();
  const pinned  = ns.filter(n => n.pinned);
  const regular = ns.filter(n => !n.pinned);

  const pinnedSec  = q('#pinned-sec');
  const pinnedGrid = q('#pinned-grid');
  if (pinned.length) {
    pinnedSec.hidden = false;
    pinnedGrid.innerHTML = pinned.map(cardHTML).join('');
  } else {
    pinnedSec.hidden = true;
  }

  q('#notes-grid').innerHTML = regular.map(cardHTML).join('');

  // Empty / welcome states
  const emptyEl   = q('#empty-st');
  const welcomeEl = q('#welcome-st');
  const isTrulyEmpty = S.notes.length === 0;

  if (!ns.length) {
    if (isTrulyEmpty && S.firstRun && S.col === 'all' && !S.query && !S.tagFilter) {
      emptyEl.hidden = true;
      welcomeEl.hidden = false;
    } else {
      welcomeEl.hidden = true;
      emptyEl.hidden = false;
      const t = q('#empty-title');
      const s = q('#empty-sub');
      if (S.query) {
        t.textContent = 'No matches';
        s.textContent = `Nothing in the catalog matches "${S.query}".`;
      } else if (S.tagFilter) {
        t.textContent = `No cards tagged #${S.tagFilter}`;
        s.textContent = 'Tag cards inline using #hashtags as you write them.';
      } else if (S.col === 'pinned') {
        t.textContent = 'Nothing pinned';
        s.textContent = 'Hover a card and press the pin to keep it at the front of the drawer.';
      } else if (S.col !== 'all') {
        const col = S.collections.find(c => c.id === S.col);
        t.textContent = 'This drawer is empty';
        s.textContent = `Cards you file into ${col ? col.name : 'this drawer'} will appear here.`;
      } else {
        t.textContent = 'The catalog is empty';
        s.textContent = 'Write a card above and press ⌘↵ to file it.';
      }
    }
  } else {
    emptyEl.hidden = true;
    welcomeEl.hidden = true;
  }

  // Header and view visibility
  const titles = { all: S.tagFilter ? `#${S.tagFilter}` : 'All cards', pinned: 'Pinned' };
  const colName = S.collections.find(c => c.id === S.col)?.name ?? 'Drawer';
  q('#view-title').textContent = studio ? 'Prompt studio' : (titles[S.col] ?? colName);
  q('#view-count').textContent = studio
    ? `${S.projects.length} project${S.projects.length === 1 ? '' : 's'}`
    : (ns.length ? `${ns.length} card${ns.length === 1 ? '' : 's'}` : '');
  q('#capture-view').hidden = studio;
  q('#catalog-view').hidden = studio;
  q('#studio-view').hidden = !studio;
  q('#type-filters').hidden = studio;
  q('#desk-search').hidden = studio;
  q('#studio-head-label').textContent = studio ? 'Back to catalog' : 'Prompt studio';
  q('#studio-head-btn').classList.toggle('is-back', studio);

  // Rail counts
  q('#cnt-all').textContent    = S.notes.length;
  q('#cnt-pinned').textContent = S.notes.filter(n => n.pinned).length;
  q('#cnt-projects').textContent = S.projects.length;
  qAll('.tab[data-col]').forEach(el => el.classList.toggle('active', !studio && el.dataset.col === S.col));
  q('#studio-tab').classList.toggle('active', studio);

  // Active tag pill
  const af = q('#active-filters');
  if (studio) {
    af.hidden = true;
  } else if (S.tagFilter) {
    af.hidden = false;
    af.innerHTML = `
      <span class="tag-pill-active">
        #${S.tagFilter}
        <button onclick="filterByTag('${S.tagFilter}')" aria-label="Clear tag filter">×</button>
      </span>`;
  } else {
    af.hidden = true;
  }

  renderCols();
  renderCapCol();
  renderStudio();
}

function bindCodexEvents() {
  if (!isDesktopCodex()) return;
  window.deckCodex.onStarted(payload => {
    S.activeRunId = payload.runId;
    S.studioProgress = 'Codex is working in read-only mode…';
    const progress = q('#studio-progress');
    if (progress) progress.textContent = S.studioProgress;
  });
  window.deckCodex.onProgress(payload => {
    if (payload.runId !== S.activeRunId) return;
    const text = String(payload.text || '').split('\n').map(line => line.trim()).filter(Boolean).pop();
    if (!text) return;
    S.studioProgress = text.slice(0, 180);
    const progress = q('#studio-progress');
    if (progress) progress.textContent = S.studioProgress;
  });
  window.deckCodex.checkCodex().then(status => {
    S.codexStatus = status;
    if (S.view === 'studio') renderStudio();
  }).catch(err => {
    S.codexStatus = { available: false, error: err.message || 'Codex check failed.' };
    if (S.view === 'studio') renderStudio();
  });
}

// ─────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const mac = /mac/i.test(navigator.platform);
  const mod = mac ? e.metaKey : e.ctrlKey;
  const ta  = q('#capture-ta');
  const si  = q('#search-in');

  if (mod && e.key === 'Enter') {
    if (document.activeElement === ta) { e.preventDefault(); addNote(); }
    return;
  }
  if (mod && e.key === 'k') { e.preventDefault(); si.focus(); si.select(); return; }
  if (mod && e.key === 'n') { e.preventDefault(); ta.focus(); return; }

  if (e.key === 'Escape') {
    if (S.query) { si.value = ''; S.query = ''; render(); }
    else if (S.tagFilter) { S.tagFilter = null; render(); }
    else if (S.view === 'studio') { openCatalog(); }
    else closeRail();
    return;
  }

  if (document.activeElement === ta) {
    const map = { '1': 'idea', '2': 'plan', '3': 'task', '4': 'note' };
    if (map[e.key]) setType(map[e.key]);
  }
});

// ─────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();

  const mac = /mac/i.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  q('#cap-hint').textContent = `1–4 type · ${mod}↵ file · ${mod}K search`;
  q('#file-kbd').textContent = mac ? '⌘↵' : 'Ctrl+↵';

  const ta = q('#capture-ta');
  ta.focus();

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
  });

  q('#search-in').addEventListener('input', function () {
    S.query = this.value;
    render();
  });

  q('#new-col-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  createCol();
    if (e.key === 'Escape') hideColForm();
  });

  q('#rail-open-btn').addEventListener('click', toggleRail);
  q('#rail-backdrop').addEventListener('click', closeRail);

  bindCodexEvents();
  render();
});
