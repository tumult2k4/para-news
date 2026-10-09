// Press Room (admin) page. Talks to /admin/login, /admin/logout and /admin/api/*.

const $ = (sel) => document.querySelector(sel);
const api = (path, opts = {}) =>
  fetch(`/admin${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

let pollTimer = null;
let settingsDirty = false;

function showLogin() {
  clearTimeout(pollTimer);
  $('#dash-view').hidden = true;
  $('#logout').hidden = true;
  $('#login-view').hidden = false;
  $('#password').focus();
}

function showDashboard() {
  $('#login-view').hidden = true;
  $('#dash-view').hidden = false;
  $('#logout').hidden = false;
}

function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  if (text instanceof Node) td.append(text);
  else td.textContent = text;
  return td;
}

function render(s) {
  const rolling = s.running;
  const state = $('#press-state');
  state.textContent = rolling ? 'Presses rolling…' : 'Idle';
  state.classList.toggle('rolling', rolling);
  $('#print-now').disabled = rolling;

  const result = s.lastRunAt ? `${fmtDateTime(s.lastRunAt)} · ${s.lastRunOk ? 'printed' : 'FAILED'}` : 'never';
  $('#last-run').textContent = rolling && s.startedAt ? `started ${fmtDateTime(s.startedAt)}` : result;
  $('#last-error').hidden = rolling || s.lastRunOk !== false;
  $('#last-error').textContent = s.lastError || '';

  if (!settingsDirty) {
    $('#auto').checked = s.settings.autoGenerate;
    $('#print-time').value = s.settings.printTime;
  }
  $('#next-run').textContent = s.settings.autoGenerate ? `${fmtDateTime(s.nextRun)} (${s.timezone})` : 'Auto-print is off';

  $('#model').textContent = s.aiEnabled ? s.model : `${s.model} (AI switched off)`;
  $('#api-key').textContent = s.hasApiKey ? 'Set' : 'Missing: articles print as raw wire copy';
  $('#api-key').className = s.hasApiKey ? '' : 'bad';
  $('#sources').textContent = `${s.sources} sources enabled`;
  $('#storage').textContent = s.storage;

  const log = $('#log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 20;
  log.textContent = s.log.join('\n') || 'Nothing logged since the server started.';
  if (atBottom) log.scrollTop = log.scrollHeight;

  $('#editions').replaceChildren(
    ...s.editions.map((e) => {
      const tr = document.createElement('tr');
      const link = document.createElement('a');
      link.href = `/?date=${e.date}`;
      link.textContent = e.lead || '(no lead)';
      tr.append(
        cell(fmtDate(e.date), 'num'),
        cell(String(e.issue ?? '—'), 'num'),
        cell(`${e.articles} articles, ${e.briefs} briefs`, 'num'),
        cell(link),
        cell(e.ai ? e.model : 'wire copy'),
        cell(e.ai ? `$${Number(e.cost).toFixed(2)}` : '—', 'num'),
      );
      return tr;
    }),
  );
}

async function refresh() {
  clearTimeout(pollTimer);
  const res = await api('/api/status').catch(() => null);
  if (!res) {
    pollTimer = setTimeout(refresh, 10000);
    return;
  }
  if (res.status === 401) return showLogin();
  const s = await res.json();
  showDashboard();
  render(s);
  pollTimer = setTimeout(refresh, s.running ? 2500 : 15000);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const res = await api('/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
  if (!res.ok) {
    $('#login-error').textContent = (await res.json().catch(() => ({}))).error || 'Could not sign in.';
    $('#password').select();
    return;
  }
  $('#password').value = '';
  refresh();
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  showLogin();
});

$('#print-now').addEventListener('click', async () => {
  const ok = confirm(
    "Print a new edition now?\n\nThis scrapes every source again and has Claude write fresh articles. If today's edition already exists it is replaced. Takes a few minutes.",
  );
  if (!ok) return;
  const res = await api('/api/run', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return showLogin();
  $('#print-msg').textContent = res.ok ? 'Started. Follow along in the press log below.' : body.error || 'Could not start the presses.';
  refresh();
});

$('#settings-form').addEventListener('input', () => {
  settingsDirty = true;
  $('#settings-msg').textContent = 'Unsaved changes.';
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ autoGenerate: $('#auto').checked, printTime: $('#print-time').value }),
  });
  if (res.status === 401) return showLogin();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    $('#settings-msg').textContent = body.error || 'Could not save.';
    return;
  }
  settingsDirty = false;
  $('#settings-msg').textContent = body.settings.autoGenerate ? `Saved. Printing daily at ${body.settings.printTime}.` : 'Saved. Auto-print is off.';
  refresh();
});

// Saving the checkbox immediately is what people expect from a switch.
$('#auto').addEventListener('change', () => $('#settings-form').requestSubmit());

refresh();
