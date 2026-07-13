import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const todayKey = (d=new Date()) => d.toISOString().slice(0,10);
const pad = (n) => String(n).padStart(2,'0');
const fmtTime = (sec) => `${pad(Math.floor(sec/60))}:${pad(sec%60)}`;
function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.opacity = '1'; });
  setTimeout(()=>{ el.style.opacity = '0'; setTimeout(()=> el.remove(), 300); }, 3000);
}

// ---------- state ----------
let currentUser = null;
let tasks = [];
let sessions = [];
let settings = { daily_goal: 4, theme: 'light' };
let activeFilter = 'all';
let calendarEvents = [];
let focus = null;
let pomodoro = null;
let googleAccessToken = null;
let gisTokenClient = null;

const priorityRank = { high:0, medium:1, low:2 };
const categories = ['School','Work','Personal','Other'];

// ================= AUTH =================
async function initAuth(){
  const { data: { session } } = await supabase.auth.getSession();
  if(session){ currentUser = session.user; await enterApp(); }
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if(session && (!currentUser || currentUser.id !== session.user.id)){
      currentUser = session.user;
      await enterApp();
    } else if(!session){
      currentUser = null;
      $('authScreen').style.display = 'block';
      $('app').style.display = 'none';
    }
  });
}

$('sendCodeBtn').onclick = async () => {
  const email = $('authEmail').value.trim();
  if(!email) return;
  $('authStatus').textContent = 'Sending code...';
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if(error){ $('authStatus').textContent = `Error: ${error.message}`; return; }
  $('codeStep').style.display = 'block';
  $('authStatus').textContent = 'Check your email for a sign-in code.';
};

$('verifyCodeBtn').onclick = async () => {
  const email = $('authEmail').value.trim();
  const token = $('authCode').value.trim();
  if(!email || !token) return;
  $('authStatus').textContent = 'Verifying...';
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  $('authStatus').textContent = error ? `Error: ${error.message}` : 'Signed in!';
};

$('signOutBtn').onclick = async () => { await supabase.auth.signOut(); };

async function enterApp(){
  $('authScreen').style.display = 'none';
  $('app').style.display = 'block';
  await Promise.all([fetchTasks(), fetchSessions(), fetchSettings()]);
  renderAll();
}

// ================= DATA: SUPABASE =================
async function fetchTasks(){
  const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending:true });
  tasks = data || [];
}
async function fetchSessions(){
  const { data } = await supabase.from('sessions').select('*').order('created_at', { ascending:true });
  sessions = (data || []).map(s => ({ ...s, date: s.session_date }));
}
async function fetchSettings(){
  let { data } = await supabase.from('settings').select('*').maybeSingle();
  if(!data){
    const { data: inserted } = await supabase.from('settings')
      .insert({ user_id: currentUser.id }).select().maybeSingle();
    data = inserted;
  }
  settings = data || { daily_goal:4, theme:'light' };
  document.body.setAttribute('data-theme', settings.theme || 'light');
  $('themeToggle').textContent = settings.theme === 'dark' ? '☀' : '☾';
}
async function persistSettings(){
  await supabase.from('settings').update({
    daily_goal: settings.daily_goal, theme: settings.theme, updated_at: new Date().toISOString()
  }).eq('user_id', currentUser.id);
}

async function addTask(){
  const name = $('taskName').value.trim();
  if(!name) return;
  const category = $('taskCategory').value;
  const priority = $('taskPriority').value;
  let estimate = parseInt($('taskEstimate').value, 10);
  if(!estimate || estimate < 1) estimate = 25;
  const { data, error } = await supabase.from('tasks')
    .insert({ user_id: currentUser.id, name, category, priority, estimate }).select().single();
  if(!error && data){
    tasks.push(data);
    $('taskName').value = '';
    renderTaskList(); renderPomoTaskOptions();
  }
}
async function deleteTask(id){
  await supabase.from('tasks').delete().eq('id', id);
  tasks = tasks.filter(t => t.id !== id);
  renderTaskList(); renderPomoTaskOptions();
}
async function markTaskComplete(id){
  await supabase.from('tasks').update({ completed:true }).eq('id', id);
  const t = tasks.find(x => x.id === id);
  if(t) t.completed = true;
}
async function logSession(s){
  const { data, error } = await supabase.from('sessions').insert({
    user_id: currentUser.id,
    task_id: s.taskId,
    task_name: s.taskName,
    category: s.category,
    duration: s.duration,
    distractions: s.distractions,
    completed_full: s.completedFull,
    session_date: s.date
  }).select().single();
  if(!error && data) sessions.push({ ...data, date: data.session_date });
}

// ================= GOOGLE CALENDAR (OAuth) =================
function ensureGisClient(){
  if(gisTokenClient) return gisTokenClient;
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: window.APP_CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    callback: ''
  });
  return gisTokenClient;
}
function requestGoogleToken(){
  return new Promise((resolve, reject) => {
    const client = ensureGisClient();
    client.callback = (resp) => {
      if(resp.error) reject(resp);
      else { googleAccessToken = resp.access_token; resolve(resp.access_token); }
    };
    client.requestAccessToken({ prompt: googleAccessToken ? '' : 'consent' });
  });
}
async function refreshCalendar(){
  const listEl = $('calendarList');
  listEl.innerHTML = '<span class="cal-empty">Connecting to Google Calendar…</span>';
  try{
    if(!googleAccessToken) await requestGoogleToken();
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(now); endOfDay.setHours(23,59,59,999);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startOfDay.toISOString())}&timeMax=${encodeURIComponent(endOfDay.toISOString())}&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
    if(res.status === 401){
      googleAccessToken = null;
      await requestGoogleToken();
      return refreshCalendar();
    }
    const data = await res.json();
    calendarEvents = (data.items || []).map(ev => ({
      time: ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : 'All day',
      endTime: ev.end?.dateTime ? new Date(ev.end.dateTime).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '',
      title: ev.summary || '(No title)',
      link: ev.hangoutLink || ((ev.conferenceData?.entryPoints || []).find(e => e.entryPointType === 'video') || {}).uri || '',
      location: ev.location || '',
      startISO: ev.start?.dateTime || null
    }));
    renderCalendarList();
  }catch(e){
    listEl.innerHTML = '<span class="cal-empty">Could not connect to Google Calendar — tap refresh to try again.</span>';
  }
}
function renderCalendarList(){
  const listEl = $('calendarList');
  if(!calendarEvents || calendarEvents.length === 0){
    listEl.innerHTML = '<span class="cal-empty">No meetings today — clear runway to focus.</span>';
    return;
  }
  listEl.innerHTML = calendarEvents.map(ev => {
    const timeRange = ev.endTime ? `${ev.time}–${ev.endTime}` : ev.time;
    const metaParts = [];
    if(ev.location) metaParts.push(`📍 ${escapeHtml(ev.location)}`);
    const linkHtml = ev.link ? `<a class="cal-link" href="${escapeHtml(ev.link)}" target="_blank" rel="noopener noreferrer">Join call ↗</a>` : '';
    const metaRow = (metaParts.length || linkHtml) ? `<div class="cal-meta">${metaParts.join('')}${linkHtml}</div>` : '';
    return `<div class="cal-event"><div class="cal-main"><span class="cal-time">${escapeHtml(timeRange)}</span><span class="cal-title">${escapeHtml(ev.title)}</span></div>${metaRow}</div>`;
  }).join('');
}
function checkMeetingConflict(totalSec){
  const warnEl = $('meetingWarning');
  const now = new Date();
  const sessionEnd = new Date(now.getTime() + totalSec * 1000);
  const upcoming = (calendarEvents || [])
    .map(ev => ({ ...ev, dateObj: ev.startISO ? new Date(ev.startISO) : null }))
    .filter(ev => ev.dateObj && ev.dateObj > now && ev.dateObj <= sessionEnd)
    .sort((a,b) => a.dateObj - b.dateObj);
  if(upcoming.length > 0){
    const ev = upcoming[0];
    const minsUntil = Math.max(1, Math.round((ev.dateObj - now) / 60000));
    const linkHtml = ev.link ? ` · <a href="${escapeHtml(ev.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:underline; font-weight:700;">Join</a>` : '';
    warnEl.innerHTML = `⚠ "${escapeHtml(ev.title)}" at ${escapeHtml(ev.time)} — in ${minsUntil} min${linkHtml}`;
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }
}
$('refreshCalendarBtn').onclick = refreshCalendar;

// ================= TASK LIST =================
function renderChips(){
  const wrap = $('filterChips');
  wrap.innerHTML = '';
  const all = document.createElement('div');
  all.className = 'chip' + (activeFilter === 'all' ? ' active' : '');
  all.textContent = 'All';
  all.onclick = () => { activeFilter = 'all'; renderChips(); renderTaskList(); };
  wrap.appendChild(all);
  categories.forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (activeFilter === c ? ' active' : '');
    chip.textContent = c;
    chip.onclick = () => { activeFilter = c; renderChips(); renderTaskList(); };
    wrap.appendChild(chip);
  });
}
function renderTaskList(){
  const list = $('taskList');
  list.innerHTML = '';
  let visible = tasks.filter(t => activeFilter === 'all' || t.category === activeFilter);
  visible.sort((a,b) => {
    if(a.completed !== b.completed) return a.completed ? 1 : -1;
    return priorityRank[a.priority] - priorityRank[b.priority];
  });
  if(visible.length === 0){
    list.innerHTML = '<div class="empty">Nothing here yet. Add a task above to get started.</div>';
    return;
  }
  visible.forEach(t => {
    const row = document.createElement('div');
    row.className = 'task' + (t.completed ? ' done' : '');
    row.innerHTML = `
      <div class="priority-dot p-${t.priority}"></div>
      <div class="task-info">
        <div class="task-name">${escapeHtml(t.name)}</div>
        <div class="task-meta"><span class="tag">${escapeHtml(t.category)}</span><span>${t.estimate} min</span></div>
      </div>
      <div class="task-actions">
        ${t.completed ? '' : `<button data-act="start" title="Start focus">▶</button>`}
        <button data-act="delete" title="Delete">✕</button>
      </div>`;
    row.querySelector('[data-act="delete"]').onclick = () => deleteTask(t.id);
    const startBtn = row.querySelector('[data-act="start"]');
    if(startBtn) startBtn.onclick = () => startFocus(t);
    list.appendChild(row);
  });
}
function renderPomoTaskOptions(){
  const sel = $('pomoTaskSelect');
  const openTasks = tasks.filter(t => !t.completed);
  if(openTasks.length === 0){ sel.innerHTML = '<option value="">Add a task first</option>'; return; }
  const prev = sel.value;
  sel.innerHTML = openTasks.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  if(openTasks.some(t => t.id === prev)) sel.value = prev;
}
$('addTaskBtn').onclick = addTask;
$('taskName').addEventListener('keydown', e => { if(e.key === 'Enter') addTask(); });

// ================= FOCUS MODE =================
function requestNotifyPermission(){
  try{ if(Notification && Notification.permission === 'default') Notification.requestPermission(); }catch(e){}
}
function notify(title, body){
  try{ if(Notification && Notification.permission === 'granted') new Notification(title, { body }); }catch(e){}
}
function beep(freq=660, dur=0.15){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.02);
  }catch(e){}
}
function startFocus(task){
  requestNotifyPermission();
  const totalSec = task.estimate * 60;
  focus = { taskId: task.id, taskName: task.name, category: task.category, totalSec, remainingSec: totalSec, paused:false, distractions:0, timerId:null };
  $('focusCategory').textContent = task.category;
  $('focusTaskName').textContent = task.name;
  $('pauseBtn').textContent = 'Pause';
  $('ringState').textContent = 'focusing';
  $('distractionCount').textContent = '';
  updateRing();
  checkMeetingConflict(totalSec);
  updateSetBadge();
  $('focusOverlay').style.display = 'flex';
  focus.timerId = setInterval(tick, 1000);
}
function tick(){
  if(!focus || focus.paused) return;
  focus.remainingSec--;
  updateRing();
  if(focus.remainingSec <= 0) completeFocus(true);
}
function updateRing(){
  const r = 126, circumference = 2 * Math.PI * r;
  const fg = $('ringFg');
  fg.setAttribute('stroke-dasharray', circumference);
  fg.setAttribute('stroke-dashoffset', circumference * (1 - focus.remainingSec / focus.totalSec));
  $('ringTime').textContent = fmtTime(Math.max(0, focus.remainingSec));
}
$('pauseBtn').onclick = () => {
  if(!focus) return;
  focus.paused = !focus.paused;
  $('pauseBtn').textContent = focus.paused ? 'Resume' : 'Pause';
  $('ringState').textContent = focus.paused ? 'paused' : 'focusing';
  $('ringWrap').classList.toggle('breathe', !focus.paused);
};
$('finishBtn').onclick = () => completeFocus(false);
$('distractionBtn').onclick = () => {
  if(!focus) return;
  focus.distractions++;
  $('distractionCount').textContent = `${focus.distractions} distraction${focus.distractions > 1 ? 's' : ''} logged this session`;
};
function updateSetBadge(){
  const badge = $('setBadge'); const stopBtn = $('stopPomodoroBtn');
  if(pomodoro){
    badge.textContent = `Set ${pomodoro.setIndex} of ${pomodoro.totalSets === 0 ? '∞' : pomodoro.totalSets}`;
    badge.style.display = 'inline-block'; stopBtn.style.display = 'block';
  } else {
    badge.style.display = 'none'; stopBtn.style.display = 'none';
  }
}
async function completeFocus(full){
  clearInterval(focus.timerId);
  const elapsedMin = Math.round((focus.totalSec - focus.remainingSec) / 60) || Math.round(focus.totalSec/60);
  const durationMin = full ? Math.round(focus.totalSec/60) : Math.max(1, elapsedMin);
  await logSession({ taskId: focus.taskId, taskName: focus.taskName, category: focus.category, duration: durationMin, distractions: focus.distractions, completedFull: full, date: todayKey() });
  if(full) await markTaskComplete(focus.taskId);
  beep(660, 0.18);
  notify('Session complete', `${focus.taskName} — ${durationMin} min focused.`);
  $('focusOverlay').style.display = 'none';
  focus = null;
  renderTaskList(); renderDashboard(); renderPomoTaskOptions();
  if(pomodoro) handlePomodoroBreak(); else openBreakModal();
}

// ---------- pomodoro ----------
$('startPomodoroBtn').onclick = () => {
  const taskId = $('pomoTaskSelect').value;
  const task = tasks.find(t => t.id === taskId);
  if(!task){ alert('Add a task first, then pick it here.'); return; }
  pomodoro = {
    taskId: task.id, taskName: task.name, category: task.category, setIndex: 1,
    totalSets: parseInt($('pomoTotalSets').value, 10),
    workMin: Math.max(1, parseInt($('pomoWork').value, 10) || 25),
    shortBreakMin: Math.max(1, parseInt($('pomoShortBreak').value, 10) || 5),
    longBreakMin: Math.max(1, parseInt($('pomoLongBreak').value, 10) || 15),
    setsBeforeLong: parseInt($('pomoSetsBeforeLong').value, 10) || 3
  };
  startFocusSet();
};
function startFocusSet(){
  startFocus({ id: pomodoro.taskId, name: pomodoro.taskName, category: pomodoro.category, estimate: pomodoro.workMin });
}
$('stopPomodoroBtn').onclick = () => {
  if(confirm('End the Pomodoro run after this set finishes?')){ pomodoro = null; updateSetBadge(); }
};
function handlePomodoroBreak(){
  const isLong = pomodoro.setIndex % pomodoro.setsBeforeLong === 0;
  const breakSec = (isLong ? pomodoro.longBreakMin : pomodoro.shortBreakMin) * 60;
  const label = isLong ? 'Long break — nice work' : 'Short break';
  runBreakTimer(breakSec, label, () => {
    const reachedLimit = pomodoro.totalSets !== 0 && pomodoro.setIndex >= pomodoro.totalSets;
    if(reachedLimit) showPomodoroDone();
    else { pomodoro.setIndex++; showNextSetPrompt(); }
  });
}
function showNextSetPrompt(){
  $('nextSetTitle').textContent = `Set ${pomodoro.setIndex} of ${pomodoro.totalSets === 0 ? '∞' : pomodoro.totalSets}`;
  $('nextSetSubtitle').textContent = `Ready to keep going on "${pomodoro.taskName}"?`;
  $('nextSetModal').style.display = 'flex';
}
$('startNextSetBtn').onclick = () => { $('nextSetModal').style.display = 'none'; startFocusSet(); };
$('stopPomodoroFromModalBtn').onclick = () => { $('nextSetModal').style.display = 'none'; pomodoro = null; updateSetBadge(); };
function showPomodoroDone(){
  const count = pomodoro.setIndex;
  $('pomodoroDoneText').textContent = `You completed ${count} set${count > 1 ? 's' : ''} on "${pomodoro.taskName}". Nice work.`;
  $('pomodoroDoneModal').style.display = 'flex';
  pomodoro = null; updateSetBadge();
}
$('closePomodoroDoneBtn').onclick = () => { $('pomodoroDoneModal').style.display = 'none'; };

// ---------- break ----------
function openBreakModal(){ $('breakModal').style.display = 'flex'; $('breakTime').textContent = '5:00'; }
$('skipBreakBtn').onclick = () => { $('breakModal').style.display = 'none'; };
$('startBreakBtn').onclick = () => { $('breakModal').style.display = 'none'; runBreakTimer(5*60, 'Step away for a bit'); };
function runBreakTimer(totalSec, label, onDone){
  label = label || 'Step away for a bit';
  let remaining = totalSec;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="focus-category">BREAK</div>
    <div class="focus-task">${escapeHtml(label)}</div>
    <div class="ring-wrap breathe">
      <svg viewBox="0 0 280 280"><circle class="ring-bg" cx="140" cy="140" r="126"></circle><circle class="ring-fg" id="breakRingFg" cx="140" cy="140" r="126"></circle></svg>
      <div class="ring-center"><div class="ring-time" id="breakRingTime">${fmtTime(remaining)}</div><div class="ring-state">break</div></div>
    </div>
    <div class="focus-controls"><button class="btn btn-primary" id="endBreakBtn">End break</button></div>`;
  document.body.appendChild(overlay);
  const r = 126, circumference = 2*Math.PI*r;
  const fg = overlay.querySelector('#breakRingFg');
  fg.setAttribute('stroke-dasharray', circumference);
  let finished = false;
  const finishBreak = () => { if(finished) return; finished = true; overlay.remove(); if(onDone) onDone(); };
  const id = setInterval(() => {
    remaining--;
    overlay.querySelector('#breakRingTime').textContent = fmtTime(Math.max(0, remaining));
    fg.setAttribute('stroke-dashoffset', circumference * (1 - remaining/totalSec));
    if(remaining <= 0){ clearInterval(id); beep(440, 0.18); notify('Break over', 'Ready for the next focus session.'); finishBreak(); }
  }, 1000);
  overlay.querySelector('#endBreakBtn').onclick = () => { clearInterval(id); finishBreak(); };
}

// ================= DASHBOARD =================
function sessionsForDay(dateStr){ return sessions.filter(s => s.date === dateStr); }
function computeStreak(){
  let streak = 0;
  let d = new Date();
  while(true){
    const key = todayKey(d);
    const count = sessionsForDay(key).length;
    if(count >= (settings.daily_goal || 4)){ streak++; d.setDate(d.getDate()-1); }
    else if(key === todayKey()){ d.setDate(d.getDate()-1); continue; }
    else break;
  }
  return streak;
}
function renderDashboard(){
  const today = todayKey();
  const todaySessions = sessionsForDay(today);
  $('statToday').textContent = todaySessions.length;
  $('statMinutes').textContent = todaySessions.reduce((a,s) => a+s.duration, 0);
  $('statDistractions').textContent = todaySessions.reduce((a,s) => a+s.distractions, 0);
  $('streakNum').textContent = computeStreak();
  $('goalDisplay').textContent = settings.daily_goal || 4;
  renderChart();
}
function renderChart(){
  const wrap = $('chartBars'); wrap.innerHTML = '';
  const days = [];
  for(let i=6;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); days.push(d); }
  const dayTotals = days.map(d => sessionsForDay(todayKey(d)).reduce((a,s) => a+s.duration, 0));
  const max = Math.max(...dayTotals, 25);
  days.forEach((d,i) => {
    const col = document.createElement('div'); col.className = 'bar-col';
    const heightPct = Math.round((dayTotals[i]/max)*100);
    col.innerHTML = `<div class="bar" style="height:90px;"><div class="bar-fill" style="height:${heightPct}%;"></div></div><div class="bar-day">${d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2)}</div>`;
    wrap.appendChild(col);
  });
}

// ================= TABS / THEME / GOAL =================
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $('tab-today').style.display = target === 'today' ? 'block' : 'none';
    $('tab-history').style.display = target === 'history' ? 'block' : 'none';
    if(target === 'history') renderDashboard();
  };
});
$('themeToggle').onclick = () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', settings.theme);
  $('themeToggle').textContent = settings.theme === 'dark' ? '☀' : '☾';
  persistSettings();
};
$('editGoalBtn').onclick = () => {
  const v = prompt('Daily session goal:', settings.daily_goal || 4);
  const n = parseInt(v, 10);
  if(n && n > 0){ settings.daily_goal = n; persistSettings(); renderDashboard(); }
};

// ================= BACKUP EXPORT =================
$('exportBtn').onclick = () => {
  const payload = { tasks, sessions, settings, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `focus-tracker-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded.');
};

function renderAll(){ renderChips(); renderTaskList(); renderDashboard(); renderPomoTaskOptions(); }

initAuth();
