// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyAszFGDs1J92_53jHvj5aABmeiKZdc-mf0",
  authDomain: "gen-lang-client-0501601606.firebaseapp.com",
  projectId: "gen-lang-client-0501601606",
  storageBucket: "gen-lang-client-0501601606.firebasestorage.app",
  messagingSenderId: "1079712784218",
  appId: "1:1079712784218:web:598465155aa70938a6dd63"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// State
let notes = [];
let currentId = null;
let filterLang = 'all';
let searchTerm = '';
let isPreview = false;

// Undo/Redo
let undoStack = [];
let redoStack = [];
let lastSavedState = '';

function pushUndo() {
  const t = document.getElementById('codeTextarea');
  if (t && t.value !== lastSavedState) {
    undoStack.push(lastSavedState);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    lastSavedState = t.value;
    updateUR();
  }
}

function applyState(s) {
  document.getElementById('codeTextarea').value = s;
  lastSavedState = s;
  refreshHighlight();
  updateStats();
  drawLineNumbers();
  updateUR();
}

function performUndo() {
  if (!undoStack.length) return;
  redoStack.push(document.getElementById('codeTextarea').value);
  applyState(undoStack.pop());
  autosave();
}

function performRedo() {
  if (!redoStack.length) return;
  undoStack.push(document.getElementById('codeTextarea').value);
  applyState(redoStack.pop());
  autosave();
}

function updateUR() {
  document.getElementById('undoBtn').disabled = !undoStack.length;
  document.getElementById('redoBtn').disabled = !redoStack.length;
}

// Auth
auth.onAuthStateChanged(async (user) => {
  if (user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('homeView').style.display = 'flex';
    await loadNotes();
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('editorView').classList.remove('active');
  }
});

document.getElementById('loginBtn').onclick = async () => {
  try {
    await auth.signInWithEmailAndPassword(
      document.getElementById('emailInput').value,
      document.getElementById('passwordInput').value
    );
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
};

document.getElementById('registerBtn').onclick = async () => {
  try {
    await auth.createUserWithEmailAndPassword(
      document.getElementById('emailInput').value,
      document.getElementById('passwordInput').value
    );
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
};

// Firestore
async function loadNotes() {
  if (!auth.currentUser) return;
  const snap = await db.collection('users').doc(auth.currentUser.uid)
    .collection('notes').orderBy('updated', 'desc').get();
  notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderHome();
}

async function saveNote(note) {
  if (!auth.currentUser) return;
  await db.collection('users').doc(auth.currentUser.uid)
    .collection('notes').doc(note.id).set(note, { merge: true });
}

async function deleteNote(id) {
  if (!auth.currentUser) return;
  await db.collection('users').doc(auth.currentUser.uid)
    .collection('notes').doc(id).delete();
}

// Home
function renderHome() {
  let filtered = [...notes];
  if (filterLang !== 'all') filtered = filtered.filter(n => n.lang === filterLang);
  if (searchTerm.trim()) {
    const q = searchTerm.toLowerCase();
    filtered = filtered.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => b.updated - a.updated);

  const grid = document.getElementById('notesGrid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="padding:60px;text-align:center;color:var(--secondary);grid-column:1/-1">No notes yet.<br>Tap + to create.</div>';
  } else {
    grid.innerHTML = filtered.map(n => `
      <div class="note-card" data-id="${n.id}">
        <div class="title">${esc(n.title || 'Untitled')}</div>
        <span class="lang">${n.lang || 'txt'}</span>
        <button class="del-btn" data-del="${n.id}">Delete</button>
      </div>
    `).join('');
  }

  // Click to open
  grid.querySelectorAll('.note-card').forEach(card => {
    card.onclick = (e) => {
      if (!e.target.closest('[data-del]')) openNote(card.dataset.id);
    };
  });

  // Delete button
  grid.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (confirm('Delete this note?')) {
        notes = notes.filter(n => n.id !== id);
        deleteNote(id);
        renderHome();
        toast('Deleted');
      }
    };
  });
}

// Editor
function openNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  currentId = id;
  document.getElementById('noteTitle').value = note.title || '';
  document.getElementById('codeTextarea').value = note.content || '';
  document.getElementById('langPicker').value = note.lang || 'plaintext';
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('editorView').classList.add('active');
  switchToCode();
  refreshHighlight();
  updateStats();
  drawLineNumbers();
  undoStack = [];
  redoStack = [];
  lastSavedState = note.content || '';
  updateUR();
}

async function createNote() {
  if (!auth.currentUser) {
    toast('Please sign in first');
    return;
  }
  const note = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 7),
    title: '',
    content: '',
    lang: 'html',
    updated: Date.now()
  };
  const ref = await db.collection('users').doc(auth.currentUser.uid).collection('notes').add(note);
  note.id = ref.id;
  notes.unshift(note);
  openNote(note.id);
  toast('New note created');
}

function closeEditor() {
  if (currentId) {
    const note = notes.find(n => n.id === currentId);
    if (note) {
      note.title = document.getElementById('noteTitle').value.trim();
      note.content = document.getElementById('codeTextarea').value;
      note.lang = document.getElementById('langPicker').value;
      note.updated = Date.now();
      saveNote(note);
    }
  }
  currentId = null;
  document.getElementById('editorView').classList.remove('active');
  document.getElementById('homeView').style.display = 'flex';
  document.getElementById('noteTitle').value = '';
  document.getElementById('codeTextarea').value = '';
  document.getElementById('codeHighlight').textContent = '';
  switchToCode();
  renderHome();
}

function saveAndClose() {
  if (!currentId) {
    toast('Saving…');
    setTimeout(() => {
      if (currentId) {
        const note = notes.find(n => n.id === currentId);
        if (note) {
          note.title = document.getElementById('noteTitle').value.trim();
          note.content = document.getElementById('codeTextarea').value;
          note.lang = document.getElementById('langPicker').value;
          note.updated = Date.now();
          saveNote(note);
        }
      }
      closeEditor();
    }, 300);
    return;
  }
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  note.title = document.getElementById('noteTitle').value.trim();
  note.content = document.getElementById('codeTextarea').value;
  note.lang = document.getElementById('langPicker').value;
  note.updated = Date.now();
  saveNote(note);
  toast('Saved');
  closeEditor();
}

async function deleteCurrent() {
  if (!currentId || !confirm('Delete this note?')) return;
  await deleteNote(currentId);
  notes = notes.filter(n => n.id !== currentId);
  closeEditor();
}

// Preview
function switchToPreview() {
  isPreview = true;
  document.getElementById('codeStage').style.display = 'none';
  document.getElementById('livePreview').classList.add('active');
  updatePreview();
}

function switchToCode() {
  isPreview = false;
  document.getElementById('codeStage').style.display = 'flex';
  document.getElementById('livePreview').classList.remove('active');
}

function updatePreview() {
  if (!isPreview) return;
  const code = document.getElementById('codeTextarea').value;
  const lang = document.getElementById('langPicker').value;
  let html = code;
  if (lang === 'css') html = `<!DOCTYPE html><html><head><style>${code}</style></head><body></body></html>`;
  else if (lang === 'javascript') html = `<!DOCTYPE html><html><body><script>${code}<\/script></body></html>`;
  else if (lang === 'html' && !code.includes('<!DOCTYPE')) html = `<!DOCTYPE html><html>${code}</html>`;
  document.getElementById('livePreview').srcdoc = html;
}

// Highlight
function refreshHighlight() {
  const code = document.getElementById('codeTextarea').value;
  const lang = document.getElementById('langPicker').value;
  let out;
  try {
    out = lang === 'plaintext' ? esc(code) : hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch (e) { out = esc(code); }
  document.getElementById('codeHighlight').innerHTML = out;
  syncScroll();
}

function syncScroll() {
  const pre = document.getElementById('codeHighlight').parentElement;
  const ta = document.getElementById('codeTextarea');
  if (!pre || !ta) return;
  pre.scrollTop = ta.scrollTop;
  pre.scrollLeft = ta.scrollLeft;
}

function drawLineNumbers() {
  const lines = document.getElementById('codeTextarea').value.split('\n');
  document.getElementById('lineNums').innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join('');
  document.getElementById('lineNums').scrollTop = document.getElementById('codeTextarea').scrollTop;
}

function updateStats() {
  const code = document.getElementById('codeTextarea').value;
  document.getElementById('charCount').textContent = code.length + ' chars';
  document.getElementById('lineCount').textContent = 'Ln ' + code.split('\n').length;
}

function autosave() {
  if (!currentId) return;
  const note = notes.find(n => n.id === currentId);
  if (note) {
    note.content = document.getElementById('codeTextarea').value;
    saveNote(note);
  }
}

// Helpers
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toastPanel').appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// Event Binding
document.addEventListener('DOMContentLoaded', () => {
  // Home buttons
  document.getElementById('homeNewBtn').addEventListener('click', createNote);
  document.getElementById('editorBackBtn').addEventListener('click', closeEditor);
  document.getElementById('saveBtn').addEventListener('click', saveAndClose);
  document.getElementById('deleteBtn').addEventListener('click', deleteCurrent);
  document.getElementById('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('codeTextarea').value);
      toast('Copied!');
    } catch (e) { toast('Copy failed'); }
  });
  document.getElementById('previewBtn').addEventListener('click', () => isPreview ? switchToCode() : switchToPreview());
  document.getElementById('undoBtn').addEventListener('click', performUndo);
  document.getElementById('redoBtn').addEventListener('click', performRedo);

  // Code input
  const codeArea = document.getElementById('codeTextarea');
  codeArea.addEventListener('input', () => {
    refreshHighlight();
    updateStats();
    drawLineNumbers();
    autosave();
    if (isPreview) updatePreview();
    clearTimeout(window._undoDebounce);
    window._undoDebounce = setTimeout(pushUndo, 500);
  });
  codeArea.addEventListener('scroll', () => {
    syncScroll();
    drawLineNumbers();
  });

  // Search & Filter
  document.getElementById('homeSearch').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderHome();
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterLang = chip.dataset.lang;
      renderHome();
    });
  });

  // Title & Language
  document.getElementById('noteTitle').addEventListener('input', () => {
    if (!currentId) return;
    const note = notes.find(n => n.id === currentId);
    if (note) {
      note.title = document.getElementById('noteTitle').value;
      saveNote(note);
    }
  });

  document.getElementById('langPicker').addEventListener('change', () => {
    refreshHighlight();
    if (currentId) {
      const note = notes.find(n => n.id === currentId);
      if (note) {
        note.lang = document.getElementById('langPicker').value;
        saveNote(note);
      }
    }
    if (isPreview) updatePreview();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAndClose(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); createNote(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); performRedo(); }
  });

  // Tab & Auto-pairs in editor
  codeArea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      pushUndo();
      const s = this.selectionStart;
      this.setRangeText('  ', s, this.selectionEnd, 'end');
      this.selectionStart = this.selectionEnd = s + 2;
      refreshHighlight();
      updateStats();
      lastSavedState = this.value;
      return;
    }
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    if (pairs[e.key]) {
      e.preventDefault();
      pushUndo();
      const s = this.selectionStart;
      this.setRangeText(e.key + pairs[e.key], s, this.selectionEnd, 'end');
      this.selectionStart = this.selectionEnd = s + 1;
      refreshHighlight();
      updateStats();
      lastSavedState = this.value;
    }
  });

  // Initial render
  renderHome();
});