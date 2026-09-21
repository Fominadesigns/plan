/* План Instagram + справи на день.
   Одна сторінка працює у двох режимах:
   — звичайний браузер: позначки лежать у пам'яті цього браузера;
   — Telegram Mini App: позначки лягають у хмару Telegram і видно їх на всіх пристроях.
   Бекенд не потрібен: сховище дає сам Telegram. */
(function(){
"use strict";

/* ===================== нерозривні пробіли ===================== */
/* Правило Каті: короткі слова не висять у кінці рядка. */
var SHORT = "і|й|а|в|у|з|о|та|на|до|за|по|від|під|над|для|про|при|без|із|зі|що|як|не|ні|чи|це|або|але|ще|вже|ж|б|бо";
var reShort = new RegExp("(^|[\\s(«\"])(" + SHORT + ")\\s+", "gi");
function nb(s){
  s = String(s == null ? "" : s);
  for(var i = 0; i < 2; i++){
    s = s.replace(reShort, function(m, pre, w){ return pre + w + " "; });
  }
  s = s.replace(/\s+—/g, " —");          // тире не починає рядок
  s = s.replace(/(\d)\s+(?=\S)/g, "$1 "); // число тримається слова після нього
  return s;
}

/* ===================== Telegram ===================== */
/* Поза Telegram бібліотека теж завантажується, але каже platform === "unknown"
   і вдає версію 6.0 — це і є ознака «ми у звичайному браузері». */
var tg = (window.Telegram && window.Telegram.WebApp &&
          window.Telegram.WebApp.platform && window.Telegram.WebApp.platform !== "unknown")
  ? window.Telegram.WebApp : null;

var cloud = null;
try{
  if(tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9")) cloud = tg.CloudStorage;
}catch(e){}

function haptic(){
  try{ tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); }catch(e){}
}
function ask(text, cb){
  try{
    if(tg && tg.showConfirm){ tg.showConfirm(text, function(ok){ cb(!!ok); }); return; }
  }catch(e){}
  cb(window.confirm(text));
}
function applyTgTheme(){
  if(!tg) return;
  var dark = tg.colorScheme === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try{ tg.setHeaderColor(dark ? "#191919" : "#3346C4"); }catch(e){}
  try{ tg.setBackgroundColor(dark ? "#191919" : "#D3D3D3"); }catch(e){}
}
if(tg){
  document.body.classList.add("in-tg");
  try{ tg.ready(); }catch(e){}
  try{ tg.expand(); }catch(e){}
  try{ tg.disableVerticalSwipes && tg.disableVerticalSwipes(); }catch(e){}
  applyTgTheme();
  try{ tg.onEvent && tg.onEvent("themeChanged", applyTgTheme); }catch(e){}
}

/* ===================== сховище ===================== */
/* Пишемо завжди і в браузер, і в хмару: браузер — щоб сторінка працювала офлайн
   і поза Telegram, хмара — щоб те саме було видно на іншому пристрої. */
var CLOUD_LIMIT = 4000; // у Telegram на один ключ 4096 символів

function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

/* Другий аргумент відповіді: "cloud" — узяли з хмари, "empty" — хмара відповіла
   й там порожньо, "local" — хмара не відповіла. Переносити нагору можна лише
   при "empty": інакше ризик затерти хмару місцевою копією. */
function get(key, cb){
  if(!cloud){ cb(lsGet(key), "local"); return; }
  var answered = false;
  var timer = setTimeout(function(){
    if(answered) return;
    answered = true;
    cb(lsGet(key), "local");         // хмара мовчить — беремо місцеву копію
  }, 5000);
  try{
    cloud.getItem(key, function(err, value){
      if(answered) return;
      answered = true; clearTimeout(timer);
      if(err){ cb(lsGet(key), "local"); }
      else if(value === null || value === undefined || value === ""){ cb(lsGet(key), "empty"); }
      else{ cb(value, "cloud"); }
    });
  }catch(e){
    if(!answered){ answered = true; clearTimeout(timer); cb(lsGet(key), "local"); }
  }
}
function set(key, value){
  lsSet(key, value);
  if(!cloud) return;
  if(value.length > CLOUD_LIMIT) return; // завелике для хмари — лишається лише тут
  try{ cloud.setItem(key, value, function(){}); }catch(e){}
}
/* Перший запуск у Telegram: хмара порожня, а в браузері вже є прогрес — піднімаємо його в хмару. */
function seedCloud(key, value, source){
  if(cloud && source === "empty" && value) set(key, value);
}
function parse(raw, fallback){
  try{
    var v = JSON.parse(raw);
    return (v && typeof v === "object") ? v : fallback;
  }catch(e){ return fallback; }
}

/* ===================== план: чек-лісти ===================== */
var KEY = "fd-ig-roadmap-v1";
var boxes = Array.prototype.slice.call(
  document.querySelectorAll("#view-roadmap .box, #view-strategy .box")
);
var views = {
  roadmap:  document.getElementById("view-roadmap"),
  strategy: document.getElementById("view-strategy"),
  day:      document.getElementById("view-day")
};
var current = "roadmap";
var planState = {};
var planLoaded = false;

var bar   = document.getElementById("bar");
var pct   = document.getElementById("pct");
var ratio = document.getElementById("ratio");
var meter = document.querySelector(".meter");

function activeBoxes(){
  if(current === "day") return [];
  return Array.prototype.slice.call(views[current].querySelectorAll(".box"));
}
function savePlan(){ set(KEY, JSON.stringify(planState)); }

function applyPlanState(){
  var touched = false;
  boxes.forEach(function(b){
    if(b.defaultChecked){
      b.checked = true;                       // позначено як зроблене в самому файлі
      if(planState[b.id] !== true){ planState[b.id] = true; touched = true; }
    }else if(Object.prototype.hasOwnProperty.call(planState, b.id)){
      b.checked = !!planState[b.id];
    }else{
      planState[b.id] = b.checked;            // перший візит: беремо позначки з розмітки
      touched = true;
    }
  });
  if(touched) savePlan();
}

function renderPlan(){
  var scope = activeBoxes();
  var done = scope.filter(function(b){ return b.checked; }).length;
  var total = scope.length;
  var p = total ? Math.round(done / total * 100) : 0;
  if(bar) bar.style.width = p + "%";
  if(pct) pct.textContent = p;
  if(ratio) ratio.textContent = done + " / " + total;

  document.querySelectorAll(".phase").forEach(function(ph){
    var local = Array.prototype.slice.call(ph.querySelectorAll(".box"));
    var d = local.filter(function(b){ return b.checked; }).length;
    var el = ph.querySelector("[data-count]");
    if(el) el.textContent = d + " / " + local.length;
  });
}

boxes.forEach(function(b){
  b.addEventListener("change", function(){
    planState[b.id] = b.checked;
    savePlan();
    renderPlan();
    haptic();
  });
});

var resetBtn = document.getElementById("reset");
if(resetBtn){
  resetBtn.addEventListener("click", function(){
    ask("Зняти всі позначки в цьому списку?", function(ok){
      if(!ok) return;
      activeBoxes().forEach(function(b){ b.checked = false; planState[b.id] = false; });
      savePlan();
      renderPlan();
    });
  });
}

document.querySelectorAll("[data-copy]").forEach(function(btn){
  btn.addEventListener("click", function(){
    var pre = btn.parentNode.querySelector("pre");
    if(!pre) return;
    var ok = function(){
      btn.textContent = "Скопійовано";
      setTimeout(function(){ btn.textContent = "Копіювати"; }, 1600);
    };
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(pre.textContent).then(ok, function(){ btn.textContent = "Виділіть вручну"; });
        return;
      }
    }catch(e){}
    btn.textContent = "Виділіть вручну";
  });
});

/* ===================== справи на день ===================== */
var MONTH = ["січня","лютого","березня","квітня","травня","червня",
             "липня","серпня","вересня","жовтня","листопада","грудня"];
var WEEK  = ["неділя","понеділок","вівторок","середа","четвер","пʼятниця","субота"];
var MAX_TASKS = 60;
var MAX_LEN = 200;

function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function shift(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function iso(d){
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}
function dayKey(d){ return "fd-day-" + iso(d); }
function daysApart(d){ return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
function whenLabel(d){
  var n = daysApart(d), w = WEEK[d.getDay()];
  if(n === 0)  return "Сьогодні · " + w;
  if(n === 1)  return "Завтра · " + w;
  if(n === -1) return "Учора · " + w;
  if(n === 2)  return "Післязавтра · " + w;
  return w;                                  // далекий день — просто день тижня
}
function dateLabel(d){ return d.getDate() + " " + MONTH[d.getMonth()]; }
function plural(n, one, few, many){
  var a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return many;
  if(b === 1) return one;
  if(b >= 2 && b <= 4) return few;
  return many;
}

/* Відкриваємо той день, який зараз потрібен: удень — сьогоднішній, після 18:00 — завтрашній. */
function defaultDay(){
  var now = new Date();
  return startOfDay(now.getHours() >= 18 ? shift(now, 1) : now);
}

var day = defaultDay();
var dayTasks = [];
var dayLoaded = false;
var prevTasks = [];

function uid(){ return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }

function saveDay(){
  var raw = JSON.stringify(dayTasks);
  set(dayKey(day), raw);
  if(cloud && raw.length > CLOUD_LIMIT) noteOverflow();
}
var overflowShown = false;
function noteOverflow(){
  if(overflowShown) return;
  overflowShown = true;
  try{
    if(tg && tg.showAlert) tg.showAlert("Справ на цей день забагато — останні зберігаються лише на цьому пристрої. Приберіть зайве.");
  }catch(e){}
}

/* — розмітка вкладки — */
var dayView = views.day;
if(dayView){
  dayView.innerHTML =
  '<section class="panel">' +
    '<div class="day-head">' +
      '<div class="day-nav">' +
        '<button class="daybtn" id="day-prev" type="button" aria-label="Попередній день">‹</button>' +
        '<button class="daybtn" id="day-next" type="button" aria-label="Наступний день">›</button>' +
      '</div>' +
      '<div class="day-caption">' +
        '<p class="day-when" id="day-when"></p>' +
        '<h2 class="day-title cond" id="day-title"></h2>' +
      '</div>' +
      '<div class="day-count" id="day-count">0 / 0</div>' +
    '</div>' +
    '<div class="bar"><i id="day-bar"></i></div>' +
    '<div class="row">' +
      '<button class="btn ghost" id="day-today" type="button">Сьогодні</button>' +
      '<button class="btn ghost" id="day-tomorrow" type="button">Завтра</button>' +
    '</div>' +
  '</section>' +

  '<section class="panel">' +
    '<h2 class="add-h">Надиктувати справи</h2>' +
    '<textarea class="dict-field" id="dict" rows="3" ' +
      'placeholder="Кожна справа — з нового рядка"></textarea>' +
    '<p class="hint">' + nb("Натисніть мікрофон на клавіатурі телефона й говоріть — кожен рядок стане окремою справою. Крапку в кінці можна не диктувати.") + '</p>' +
    '<div class="row">' +
      '<button class="btn" id="dict-add" type="button">Додати</button>' +
      '<button class="btn ghost" id="pick-toggle" type="button">Взяти крок із плану</button>' +
    '</div>' +
    '<div class="plan-pick" id="plan-pick" hidden></div>' +
  '</section>' +

  '<section class="panel">' +
    '<div class="carry" id="carry" hidden></div>' +
    '<div class="tasks day-list" id="day-list"></div>' +
  '</section>';
}

var elWhen  = document.getElementById("day-when");
var elTitle = document.getElementById("day-title");
var elCount = document.getElementById("day-count");
var elBar   = document.getElementById("day-bar");
var elList  = document.getElementById("day-list");
var elCarry = document.getElementById("carry");
var elDict  = document.getElementById("dict");
var elPick  = document.getElementById("plan-pick");

function renderDay(){
  if(!elList) return;

  elWhen.textContent  = whenLabel(day);
  elTitle.textContent = nb(dateLabel(day));

  var done = dayTasks.filter(function(t){ return t.done; }).length;
  var total = dayTasks.length;
  elCount.textContent = done + " / " + total;
  elCount.classList.toggle("full", total > 0 && done === total);
  elBar.style.width = (total ? Math.round(done / total * 100) : 0) + "%";

  if(!dayLoaded){
    elList.innerHTML = '<p class="empty">Завантаження…</p>';
    return;
  }
  if(!total){
    elList.innerHTML = '<p class="empty">' + nb("На цей день ще нічого не записано") + '</p>';
    return;
  }

  var html = "";
  dayTasks.forEach(function(t){
    var id = "d-" + t.id;
    html +=
      '<div class="task" data-id="' + t.id + '">' +
        '<input type="checkbox" class="box" id="' + id + '"' + (t.done ? " checked" : "") + '>' +
        '<div class="task-body">' +
          '<label class="task-title" for="' + id + '">' + nb(esc(t.text)) + '</label>' +
          (t.planId ? '<span class="tag act">із плану</span>' : '') +
        '</div>' +
        '<button class="tkill" type="button" data-kill="' + t.id + '" aria-label="Прибрати справу">×</button>' +
      '</div>';
  });
  elList.innerHTML = html;
}
function esc(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Справи, взяті з плану, показують стан самого плану — щоб не розходились. */
function syncFromPlan(){
  if(!planLoaded) return false;     // поки план не прочитано, нічого не звіряємо
  var changed = false;
  dayTasks.forEach(function(t){
    if(!t.planId) return;
    var v = !!planState[t.planId];
    if(t.done !== v){ t.done = v; changed = true; }
  });
  return changed;
}

function loadDay(){
  dayLoaded = false;
  renderDay();
  var want = iso(day);
  get(dayKey(day), function(raw, source){
    if(iso(day) !== want) return;            // за цей час перемкнули день
    seedCloud(dayKey(day), raw, source);
    var list = parse(raw, []);
    dayTasks = Array.isArray(list) ? list : [];
    dayLoaded = true;
    if(syncFromPlan()) saveDay();
    renderDay();
    loadCarry();
  });
}

function loadCarry(){
  if(!elCarry) return;
  elCarry.hidden = true;
  prevTasks = [];
  var prev = shift(day, -1);
  var want = iso(day);
  get(dayKey(prev), function(raw){
    if(iso(day) !== want) return;
    var list = parse(raw, []);
    if(!Array.isArray(list)) return;
    prevTasks = list.filter(function(t){ return !t.done && !t.planId; });
    if(!prevTasks.length) return;
    var n = prevTasks.length;
    var from = daysApart(prev) === 0 ? "Сьогодні" : (daysApart(prev) === -1 ? "Учора" : dateLabel(prev));
    elCarry.innerHTML =
      '<p>' + nb(from + " не зроблено: " + n + " " + plural(n, "справа", "справи", "справ")) + '</p>' +
      '<button class="btn ghost" id="carry-go" type="button">Перенести сюди</button>';
    elCarry.hidden = false;
    document.getElementById("carry-go").addEventListener("click", function(){
      carryOver(prev);
    });
  });
}

function carryOver(prev){
  var moved = prevTasks.slice(0, Math.max(0, MAX_TASKS - dayTasks.length));
  if(!moved.length) return;
  var movedIds = {};
  moved.forEach(function(t){ movedIds[t.id] = true; dayTasks.push(t); });
  saveDay();

  // з попереднього дня перенесені справи прибираємо, щоб не двоїлись
  get(dayKey(prev), function(raw){
    var list = parse(raw, []);
    if(!Array.isArray(list)) list = [];
    var rest = list.filter(function(t){ return !movedIds[t.id]; });
    set(dayKey(prev), JSON.stringify(rest));
  });

  elCarry.hidden = true;
  prevTasks = [];
  renderDay();
  haptic();
}

function addTexts(lines){
  var added = 0;
  lines.forEach(function(raw){
    var text = String(raw).replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
    if(!text) return;
    if(dayTasks.length >= MAX_TASKS) return;
    dayTasks.push({ id: uid(), text: text.slice(0, MAX_LEN), done: false, planId: null });
    added++;
  });
  if(!added) return;
  saveDay();
  renderDay();
  haptic();
}

if(elList){
  elList.addEventListener("change", function(e){
    var box = e.target;
    if(!box.classList || !box.classList.contains("box")) return;
    var host = box.closest(".task");
    if(!host) return;
    var t = find(host.getAttribute("data-id"));
    if(!t) return;
    t.done = box.checked;
    if(t.planId){                            // крок плану позначаємо і в самому плані
      planState[t.planId] = t.done;
      var planBox = document.getElementById(t.planId);
      if(planBox) planBox.checked = t.done;
      savePlan();
      renderPlan();
      refreshPick();
    }
    saveDay();
    renderDay();
    haptic();
  });

  elList.addEventListener("click", function(e){
    var btn = e.target.closest ? e.target.closest("[data-kill]") : null;
    if(!btn) return;
    var id = btn.getAttribute("data-kill");
    var t = find(id);
    if(!t) return;
    ask("Прибрати «" + t.text + "»?", function(ok){
      if(!ok) return;
      dayTasks = dayTasks.filter(function(x){ return x.id !== id; });
      saveDay();
      renderDay();
      refreshPick();
    });
  });
}
function find(id){
  for(var i = 0; i < dayTasks.length; i++){ if(dayTasks[i].id === id) return dayTasks[i]; }
  return null;
}

var addBtn = document.getElementById("dict-add");
if(addBtn){
  addBtn.addEventListener("click", function(){
    if(!elDict) return;
    var lines = elDict.value.split(/[\n\r]+/);
    addTexts(lines);
    elDict.value = "";
    elDict.blur();
  });
}

function goDay(d){
  day = startOfDay(d);
  loadDay();
}
bind("day-prev",     function(){ goDay(shift(day, -1)); });
bind("day-next",     function(){ goDay(shift(day,  1)); });
bind("day-today",    function(){ goDay(new Date()); });
bind("day-tomorrow", function(){ goDay(shift(new Date(), 1)); });
function bind(id, fn){
  var el = document.getElementById(id);
  if(el) el.addEventListener("click", fn);
}

/* — взяти крок із плану — */
var pickOpen = false;
bind("pick-toggle", function(){
  pickOpen = !pickOpen;
  if(pickOpen) refreshPick();
  if(elPick) elPick.hidden = !pickOpen;
  var b = document.getElementById("pick-toggle");
  if(b) b.textContent = pickOpen ? "Сховати план" : "Взяти крок із плану";
});

function refreshPick(){
  if(!elPick || !pickOpen) return;
  var takenPlanIds = {};
  dayTasks.forEach(function(t){ if(t.planId) takenPlanIds[t.planId] = true; });

  var html = "";
  document.querySelectorAll("#view-roadmap .phase, #view-strategy .phase").forEach(function(ph){
    var head = ph.querySelector(".phase-title h2");
    var rows = "";
    Array.prototype.slice.call(ph.querySelectorAll(".box")).forEach(function(b){
      if(b.checked) return;                  // зроблене не пропонуємо
      var label = ph.querySelector('label[for="' + b.id + '"]');
      if(!label) return;
      var used = !!takenPlanIds[b.id];
      rows +=
        '<div class="pick-row' + (used ? " used" : "") + '">' +
          '<span>' + nb(esc(label.textContent.trim())) + '</span>' +
          '<button class="pick-add" type="button" ' + (used ? "disabled" : 'data-pick="' + b.id + '"') +
            ' aria-label="Додати в день">' + (used ? "✓" : "+") + '</button>' +
        '</div>';
    });
    if(!rows || !head) return;
    var from = ph.closest("#view-strategy") ? "Стратегія" : "Дорожня карта";
    html += '<p class="pick-phase">' + from + " · " + esc(head.textContent.trim()) + '</p>' + rows;
  });

  elPick.innerHTML = html || '<p class="empty">' + nb("Усі кроки плану вже зроблені") + '</p>';
}

if(elPick){
  elPick.addEventListener("click", function(e){
    var btn = e.target.closest ? e.target.closest("[data-pick]") : null;
    if(!btn) return;
    var planId = btn.getAttribute("data-pick");
    var label = document.querySelector('label[for="' + planId + '"]');
    if(!label) return;
    if(dayTasks.length >= MAX_TASKS) return;
    dayTasks.push({
      id: uid(),
      text: label.textContent.trim().slice(0, MAX_LEN),
      done: false,
      planId: planId
    });
    saveDay();
    renderDay();
    refreshPick();
    haptic();
  });
}

/* ===================== перемикач вкладок ===================== */
function switchTo(key){
  if(!views[key]) key = "roadmap";
  current = key;
  Object.keys(views).forEach(function(k){
    if(views[k]) views[k].hidden = (k !== key);
  });
  ["roadmap","strategy","day"].forEach(function(k){
    var b = document.getElementById("tab-" + k);
    if(b) b.setAttribute("aria-selected", String(k === key));
  });
  document.querySelectorAll("[data-foot]").forEach(function(p){
    p.hidden = (p.getAttribute("data-foot") !== key);
  });
  document.querySelectorAll("[data-lede]").forEach(function(p){
    p.hidden = (p.getAttribute("data-lede") !== key);
  });
  if(meter) meter.hidden = (key === "day");   // у днях свій лічильник
  lsSet(KEY + "-tab", key);
  if(key === "day"){
    if(!dayLoaded) loadDay(); else { syncFromPlan(); renderDay(); }
  }
  renderPlan();
  window.scrollTo(0, 0);
}
bind("tab-roadmap",  function(){ switchTo("roadmap"); });
bind("tab-strategy", function(){ switchTo("strategy"); });
bind("tab-day",      function(){ switchTo("day"); });

/* ===================== старт ===================== */
get(KEY, function(raw, source){
  seedCloud(KEY, raw, source);
  planState = parse(raw, {});
  planLoaded = true;
  applyPlanState();
  renderPlan();
  if(dayLoaded){
    if(syncFromPlan()) saveDay();
    if(current === "day") renderDay();
  }
});

var savedTab = lsGet(KEY + "-tab") || "roadmap";
switchTo(views[savedTab] ? savedTab : "roadmap");
})();
