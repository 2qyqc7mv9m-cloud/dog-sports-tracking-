// Dog Sports Tracking - Full App (offline, localStorage)
// Features: dogs (add/edit/photo), record runs (timer + manual), PB trophy, leaderboard, charts, export/import.

const STORE_KEY = "dst_store_v2";

// ---------- Utilities ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function nowISO(){ return new Date().toISOString(); }
function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function formatTime(ms){
  const total = Math.max(0, Math.floor(ms));
  const s = Math.floor(total/1000);
  const m = Math.floor(s/60);
  const sec = s % 60;
  const cs = Math.floor((total % 1000)/10); // centiseconds
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function parseTimeString(str){
  // supports: mm:ss.xx  OR ss.xx OR ss
  const t = (str||"").trim();
  if(!t) return null;
  if(t.includes(":")){
    const [mm, rest] = t.split(":");
    const ss = parseFloat(rest);
    const m = parseInt(mm, 10);
    if(Number.isNaN(m) || Number.isNaN(ss)) return null;
    return (m*60 + ss) * 1000;
  }
  const s = parseFloat(t);
  if(Number.isNaN(s)) return null;
  return s*1000;
}

function speedKmh(distanceM, timeMs){
  const t = timeMs/1000;
  if(t <= 0) return 0;
  return (distanceM * 3.6) / t;
}

function round(n, d=2){
  const p = Math.pow(10,d);
  return Math.round(n*p)/p;
}

function safeJSONParse(x, fallback){
  try{ return JSON.parse(x); } catch { return fallback; }
}

// ---------- Storage ----------
function defaultStore(){
  return {
    version: 2,
    activeTab: "dogs",
    distances: [100, 200, 50],
    dogs: [],
    runs: [], // {id, dogId, distanceM, timeMs, speedKmh, sport, notes, createdAt}
    settings: {
      defaultDistanceM: 100,
      defaultSport: "Sprint",
      units: "kmh"
    }
  };
}

function loadStore(){
  const raw = localStorage.getItem(STORE_KEY);
  if(!raw) return defaultStore();
  const s = safeJSONParse(raw, defaultStore());
  // minimal migration guard
  if(!s.version) return defaultStore();
  return s;
}

function saveStore(store){
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let store = loadStore();

// ---------- Modal ----------
const modal = {
  open(title, bodyHTML, actionsHTML=""){
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHTML;
    $("#modalActions").innerHTML = actionsHTML;
    $("#modalBackdrop").classList.remove("hidden");
  },
  close(){
    $("#modalBackdrop").classList.add("hidden");
    $("#modalActions").innerHTML = "";
  }
};

$("#modalClose").addEventListener("click", modal.close);
$("#modalBackdrop").addEventListener("click", (e)=>{
  if(e.target.id === "modalBackdrop") modal.close();
});

$("#helpBtn").addEventListener("click", ()=>{
  modal.open(
    "How this app works",
    `
      <p><strong>Dogs</strong>: Add your dogs (optionally with a photo). </p>
      <p><strong>Record</strong>: Pick a dog + distance, then use the timer (or enter time manually). Save the run.</p>
      <p><strong>Rank</strong>: Leaderboard is based on each dog's best speed (PB). 🏆</p>
      <p><strong>Charts</strong>: View speed history per dog and all runs combined.</p>
      <h3>Tips</h3>
      <p>• If you update the app and it looks “stuck”, open in a Private tab once (Safari cache fix).</p>
      <p>• Export data in Settings before big changes.</p>
    `,
    `<button class="btn primary" type="button" id="okHelp">Got it</button>`
  );
  $("#okHelp").addEventListener("click", modal.close);
});

// ---------- Tabs ----------
function setTab(tab){
  store.activeTab = tab;
  saveStore(store);
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  render();
}
$$(".tab").forEach(btn => btn.addEventListener("click", ()=> setTab(btn.dataset.tab)));
setTab(store.activeTab || "dogs"); // initial

// ---------- Derived data ----------
function dogsById(){
  const map = new Map();
  store.dogs.forEach(d => map.set(d.id, d));
  return map;
}

function runsForDog(dogId){
  return store.runs.filter(r => r.dogId === dogId).sort((a,b)=> a.createdAt.localeCompare(b.createdAt));
}

function bestRunForDog(dogId){
  const rr = runsForDog(dogId);
  if(!rr.length) return null;
  return rr.reduce((best, r) => (!best || r.speedKmh > best.speedKmh ? r : best), null);
}

function leaderboard(){
  const rows = store.dogs.map(d => {
    const pb = bestRunForDog(d.id);
    return {
      dog: d,
      pb
    };
  }).filter(x => x.pb).sort((a,b)=> b.pb.speedKmh - a.pb.speedKmh);
  return rows;
}

// ---------- Photo handling ----------
async function fileToDataURL(file, maxSize=600){
  // downscale image to keep localStorage reasonable
  const img = new Image();
  const dataURL = await new Promise((res, rej)=>{
    const reader = new FileReader();
    reader.onload = ()=> res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  img.src = dataURL;
  await new Promise(res => img.onload = res);

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(w,h));
  const cw = Math.round(w*scale);
  const ch = Math.round(h*scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function initials(name){
  const parts = (name||"").trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return "D";
  return (parts[0][0] + (parts[1]?.[0]||"")).toUpperCase();
}

// ---------- Rendering ----------
function render(){
  const app = $("#app");
  const tab = store.activeTab;

  // subtitle
  const dogCount = store.dogs.length;
  const runCount = store.runs.length;
  $("#subtitle").textContent = `${dogCount} dog${dogCount!==1?'s':''} • ${runCount} run${runCount!==1?'s':''}`;

  if(tab === "dogs") app.innerHTML = viewDogs();
  if(tab === "record") app.innerHTML = viewRecord();
  if(tab === "leaderboard") app.innerHTML = viewLeaderboard();
  if(tab === "charts") app.innerHTML = viewCharts();
  if(tab === "settings") app.innerHTML = viewSettings();

  wire(tab);
}

function viewDogs(){
  return `
    <section class="card">
      <div class="row space-between wrap">
        <h2>Dogs</h2>
        <div class="row wrap">
          <button class="btn primary" type="button" id="addDogBtn">Add dog</button>
          <button class="btn ghost" type="button" id="quickAddVada">Quick add Vada</button>
        </div>
      </div>
      <p class="small-note">Add your dogs once. Runs and PBs will attach to each dog.</p>
    </section>

    <section class="card">
      <div class="row space-between">
        <h2>Your dogs</h2>
        <button class="btn ghost" type="button" id="clearDogsBtn">Clear dogs</button>
      </div>

      ${store.dogs.length ? `
        <ul class="list" id="dogList">
          ${store.dogs.map(d => dogCard(d)).join("")}
        </ul>
      ` : `
        <div class="item">
          <div class="muted"><strong>No dogs yet.</strong></div>
          <div class="muted">Tap “Add dog” to start.</div>
        </div>
      `}
    </section>
  `;
}

function dogCard(d){
  const pb = bestRunForDog(d.id);
  const pbBadge = pb ? `
    <span class="badge">🏆 PB <strong>${round(pb.speedKmh,2)} km/h</strong> • ${pb.distanceM}m • ${formatTime(pb.timeMs)}</span>
  ` : `<span class="badge">No runs yet</span>`;

  const avatar = d.photoDataUrl
    ? `<div class="avatar"><img alt="${d.name}" src="${d.photoDataUrl}"></div>`
    : `<div class="avatar">${initials(d.name)}</div>`;

  const metaParts = [];
  if(d.breed) metaParts.push(d.breed);
  if(d.notes) metaParts.push(d.notes);
  const meta = metaParts.length ? metaParts.join(" • ") : "—";

  return `
    <li class="item" data-dogid="${d.id}">
      <div class="dog-top">
        <div class="dog-main">
          ${avatar}
          <div style="min-width:0;">
            <div class="dog-name">${escapeHTML(d.name)}</div>
            <div class="dog-meta">${escapeHTML(meta)}</div>
          </div>
        </div>
        <div class="row wrap" style="justify-content:flex-end;">
          <button class="btn ghost" type="button" data-action="selectDog">Select</button>
          <button class="btn ghost" type="button" data-action="editDog">Edit</button>
          <button class="btn danger" type="button" data-action="deleteDog">Delete</button>
        </div>
      </div>
      <div class="badges">${pbBadge}</div>
    </li>
  `;
}

function viewRecord(){
  const activeDogId = store.settings.activeDogId || (store.dogs[0]?.id || "");
  const activeDog = store.dogs.find(d=> d.id === activeDogId) || null;

  const distOptions = store.distances
    .slice()
    .sort((a,b)=>a-b)
    .map(d => `<option value="${d}" ${d===store.settings.defaultDistanceM?'selected':''}>${d} m</option>`)
    .join("");

  return `
    <section class="card">
      <h2>Record a run</h2>
      ${store.dogs.length ? `
        <div class="form">
          <label>
            Dog
            <select id="recordDog">
              ${store.dogs.map(d => `<option value="${d.id}" ${d.id===activeDogId?'selected':''}>${escapeHTML(d.name)}</option>`).join("")}
            </select>
          </label>

          <div class="row wrap">
            <label style="flex:1; min-width:160px;">
              Distance
              <select id="recordDistance">${distOptions}</select>
            </label>

            <label style="flex:1; min-width:160px;">
              Sport
              <select id="recordSport">
                ${["Sprint","Agility","Lure","Flyball","Training"].map(s => `<option ${s===store.settings.defaultSport?'selected':''}>${s}</option>`).join("")}
              </select>
            </label>
          </div>

          <label>
            Notes (optional)
            <input id="recordNotes" type="text" placeholder="e.g., windy day, great start">
          </label>

          <div class="item">
            <div class="timer" id="timerDisplay">00:00.00</div>
            <div class="timer-sub" id="timerSub">Tap Start. Tap Stop. Save the run.</div>

            <div class="row wrap" style="margin-top:12px;">
              <button class="btn primary" type="button" id="startStopBtn">Start</button>
              <button class="btn ghost" type="button" id="resetBtn">Reset</button>
              <button class="btn" type="button" id="saveRunBtn">Save run</button>
              <button class="btn ghost" type="button" id="manualBtn">Enter time manually</button>
            </div>

            <div class="kpi" id="kpiArea"></div>
          </div>
        </div>
      ` : `
        <div class="item">
          <div class="muted"><strong>Add a dog first.</strong></div>
          <div class="muted">Go to Dogs → Add dog.</div>
        </div>
      `}
    </section>

    ${activeDog ? `
      <section class="card">
        <div class="row space-between wrap">
          <h2>Recent runs • ${escapeHTML(activeDog.name)}</h2>
          <button class="btn ghost" type="button" id="clearRunsForDog">Clear runs</button>
        </div>
        ${runsForDog(activeDogId).length ? `
          <table class="table">
            <thead><tr><th>Date</th><th>Distance</th><th>Time</th><th>Speed</th><th></th></tr></thead>
            <tbody>
              ${runsForDog(activeDogId).slice().reverse().slice(0,12).map(r => `
                <tr data-runid="${r.id}">
                  <td>${new Date(r.createdAt).toLocaleString()}</td>
                  <td>${r.distanceM}m</td>
                  <td>${formatTime(r.timeMs)}</td>
                  <td>${round(r.speedKmh,2)} km/h</td>
                  <td><button class="btn ghost" type="button" data-action="deleteRun">Delete</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `
          <div class="item">
            <div class="muted">No runs yet for this dog.</div>
          </div>
        `}
      </section>
    ` : ""}
  `;
}

function viewLeaderboard(){
  const rows = leaderboard();
  return `
    <section class="card">
      <div class="row space-between wrap">
        <h2>Leaderboard</h2>
        <div class="pill">Sorted by best speed (PB)</div>
      </div>
      ${rows.length ? `
        <table class="table">
          <thead><tr><th>#</th><th>Dog</th><th>PB speed</th><th>Distance</th><th>Time</th></tr></thead>
          <tbody>
            ${rows.map((x,i) => `
              <tr>
                <td><strong>${i+1}</strong></td>
                <td>${escapeHTML(x.dog.name)} ${i===0 ? " 🥇" : i===1 ? " 🥈" : i===2 ? " 🥉" : ""}</td>
                <td><strong>${round(x.pb.speedKmh,2)} km/h</strong> 🏆</td>
                <td>${x.pb.distanceM}m</td>
                <td>${formatTime(x.pb.timeMs)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `
        <div class="item">
          <div class="muted"><strong>No leaderboard yet.</strong></div>
          <div class="muted">Record at least one run for a dog.</div>
        </div>
      `}
      <p class="small-note">PB trophy is based on highest speed. If you prefer lowest time as PB later, we can switch it.</p>
    </section>
  `;
}

function viewCharts(){
  const dogId = store.settings.activeDogId || (store.dogs[0]?.id || "");
  const dog = store.dogs.find(d=> d.id === dogId) || null;
  const dogRuns = dog ? runsForDog(dogId) : [];

  return `
    <section class="card">
      <div class="row space-between wrap">
        <h2>Charts</h2>
        <div class="row wrap">
          <select id="chartDogSelect" ${store.dogs.length ? "" : "disabled"}>
            ${store.dogs.map(d => `<option value="${d.id}" ${d.id===dogId?'selected':''}>${escapeHTML(d.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      ${dog ? `
        <div class="small-note">Speed history for <strong>${escapeHTML(dog.name)}</strong></div>
        <div class="chart-wrap"><canvas id="dogChart" width="900" height="300"></canvas></div>
        <div class="hr"></div>
        <div class="small-note">All runs combined (speed)</div>
        <div class="chart-wrap"><canvas id="allChart" width="900" height="300"></canvas></div>
      ` : `
        <div class="item">
          <div class="muted"><strong>Add a dog first.</strong></div>
          <div class="muted">Then record runs to see charts.</div>
        </div>
      `}
    </section>
  `;
}

function viewSettings(){
  return `
    <section class="card">
      <h2>Settings</h2>

      <div class="form">
        <label>
          Default distance
          <select id="defaultDistance">
            ${store.distances.slice().sort((a,b)=>a-b).map(d=> `<option value="${d}" ${d===store.settings.defaultDistanceM?'selected':''}>${d} m</option>`).join("")}
          </select>
        </label>

        <label>
          Default sport
          <select id="defaultSport">
            ${["Sprint","Agility","Lure","Flyball","Training"].map(s=> `<option ${s===store.settings.defaultSport?'selected':''}>${s}</option>`).join("")}
          </select>
        </label>

        <div class="row wrap">
          <button class="btn" type="button" id="manageDistances">Manage distances</button>
          <button class="btn danger" type="button" id="factoryReset">Factory reset</button>
        </div>
      </div>

      <div class="hr"></div>

      <h2>Backup</h2>
      <div class="row wrap">
        <button class="btn primary" type="button" id="exportBtn">Export data</button>
        <button class="btn" type="button" id="importBtn">Import data</button>
      </div>
      <p class="small-note">Export creates a JSON file you can save in Files. Import restores it.</p>
    </section>
  `;
}

// ---------- Wiring (events per tab) ----------
function wire(tab){
  if(tab === "dogs") wireDogs();
  if(tab === "record") wireRecord();
  if(tab === "charts") wireCharts();
  if(tab === "settings") wireSettings();
}

function wireDogs(){
  $("#addDogBtn")?.addEventListener("click", ()=> openDogEditor());
  $("#quickAddVada")?.addEventListener("click", ()=>{
    if(store.dogs.some(d=> d.name.toLowerCase() === "vada")){ toast("Vada already exists"); return; }
    store.dogs.push({ id: uid(), name:"Vada", breed:"American Staffordshire Terrier", notes:"Imperial Princess", photoDataUrl:null, createdAt: nowISO() });
    saveStore(store);
    render();
  });

  $("#clearDogsBtn")?.addEventListener("click", ()=>{
    if(!confirm("Clear ALL dogs and runs?")) return;
    store.dogs = [];
    store.runs = [];
    store.settings.activeDogId = undefined;
    saveStore(store);
    render();
  });

  $("#dogList")?.addEventListener("click", (e)=>{
    const li = e.target.closest("[data-dogid]");
    if(!li) return;
    const dogId = li.dataset.dogid;
    const action = e.target.dataset.action;
    const dog = store.dogs.find(d=> d.id === dogId);
    if(!dog) return;

    if(action === "selectDog"){
      store.settings.activeDogId = dogId;
      saveStore(store);
      toast(`Selected ${dog.name}`);
      setTab("record");
    }
    if(action === "editDog"){
      openDogEditor(dog);
    }
    if(action === "deleteDog"){
      if(!confirm(`Delete ${dog.name} and all their runs?`)) return;
      store.dogs = store.dogs.filter(d=> d.id !== dogId);
      store.runs = store.runs.filter(r=> r.dogId !== dogId);
      if(store.settings.activeDogId === dogId) store.settings.activeDogId = store.dogs[0]?.id || undefined;
      saveStore(store);
      render();
    }
  });
}

function openDogEditor(existing=null){
  const isEdit = !!existing;
  const dog = existing || { id: uid(), name:"", breed:"", notes:"", photoDataUrl:null };

  modal.open(
    isEdit ? "Edit dog" : "Add dog",
    `
      <form class="form" id="dogEditorForm">
        <label>Dog name
          <input id="edName" type="text" value="${escapeAttr(dog.name)}" placeholder="e.g., Vada" required>
        </label>
        <label>Breed (optional)
          <input id="edBreed" type="text" value="${escapeAttr(dog.breed||"")}" placeholder="e.g., American Staffordshire Terrier">
        </label>
        <label>Notes (optional)
          <input id="edNotes" type="text" value="${escapeAttr(dog.notes||"")}" placeholder="e.g., Black & white, loves sprints">
        </label>
        <label>Photo (optional)
          <input id="edPhoto" type="file" accept="image/*">
        </label>
        ${dog.photoDataUrl ? `<div class="row"><div class="avatar"><img src="${dog.photoDataUrl}" alt="${escapeAttr(dog.name)}"></div><span class="muted">Current photo</span></div>` : ""}
        <div class="row wrap">
          <button class="btn primary" type="submit">${isEdit ? "Save changes" : "Add dog"}</button>
          ${dog.photoDataUrl ? `<button class="btn danger" type="button" id="removePhoto">Remove photo</button>` : ""}
        </div>
        <p class="small-note">Photos are compressed to save space on your phone.</p>
      </form>
    `,
    `<button class="btn ghost" type="button" id="cancelDogEd">Cancel</button>`
  );

  $("#cancelDogEd").addEventListener("click", modal.close);

  $("#removePhoto")?.addEventListener("click", ()=>{
    dog.photoDataUrl = null;
    applyDog(dog, isEdit);
  });

  $("#dogEditorForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const name = ($("#edName").value||"").trim();
    if(!name) return;
    const breed = ($("#edBreed").value||"").trim();
    const notes = ($("#edNotes").value||"").trim();
    const file = $("#edPhoto").files?.[0];

    dog.name = name;
    dog.breed = breed;
    dog.notes = notes;

    if(file){
      try{
        dog.photoDataUrl = await fileToDataURL(file, 600);
      } catch {
        toast("Could not read photo");
      }
    }
    applyDog(dog, isEdit);
  });

  function applyDog(d, isEdit){
    if(isEdit){
      store.dogs = store.dogs.map(x => x.id === d.id ? {...x, ...d} : x);
    } else {
      store.dogs.push({ ...d, createdAt: nowISO() });
    }
    store.settings.activeDogId = d.id;
    saveStore(store);
    modal.close();
    render();
  }
}


// ---------- Record (timer + manual) ----------
let timer = { running:false, start:0, elapsed:0, raf:0 };

function wireRecord(){
  const dogSelect = $("#recordDog");
  const distanceSel = $("#recordDistance");
  const sportSel = $("#recordSport");

  if(dogSelect){
    dogSelect.addEventListener("change", ()=>{
      store.settings.activeDogId = dogSelect.value;
      saveStore(store);
      render();
    });
  }

  $("#startStopBtn")?.addEventListener("click", ()=>{
    if(!timer.running) startTimer();
    else stopTimer();
  });

  $("#resetBtn")?.addEventListener("click", ()=>{
    resetTimer();
    updateKpi();
  });

  $("#manualBtn")?.addEventListener("click", ()=>{
    const current = (timer.elapsed>0 ? (timer.elapsed/1000).toFixed(2) : "");
    modal.open(
      "Enter time manually",
      `
        <form class="form" id="manualForm">
          <label>Time (seconds, or mm:ss.xx)
            <input id="manualTime" type="text" placeholder="e.g., 10.52 or 00:10.52" value="${current}">
          </label>
          <button class="btn primary" type="submit">Use this time</button>
          <p class="small-note">This sets the timer display so you can save the run.</p>
        </form>
      `,
      `<button class="btn ghost" type="button" id="cancelManual">Cancel</button>`
    );
    $("#cancelManual").addEventListener("click", modal.close);
    $("#manualForm").addEventListener("submit", (e)=>{
      e.preventDefault();
      const ms = parseTimeString($("#manualTime").value);
      if(ms == null || ms <= 0){ toast("Enter a valid time"); return; }
      timer.elapsed = ms;
      timer.running = false;
      cancelAnimationFrame(timer.raf);
      $("#startStopBtn").textContent = "Start";
      $("#timerDisplay").textContent = formatTime(timer.elapsed);
      updateKpi();
      modal.close();
    });
  });

  $("#saveRunBtn")?.addEventListener("click", ()=>{
    if(!store.dogs.length){ toast("Add a dog first"); return; }
    const dogId = $("#recordDog").value;
    const distanceM = parseInt($("#recordDistance").value,10);
    const sport = $("#recordSport").value;
    const notes = ($("#recordNotes").value||"").trim();

    if(timer.running){ toast("Stop the timer first"); return; }
    if(timer.elapsed <= 0){ toast("Record a time first"); return; }

    const run = {
      id: uid(),
      dogId,
      distanceM,
      timeMs: Math.round(timer.elapsed),
      speedKmh: round(speedKmh(distanceM, timer.elapsed), 4),
      sport,
      notes,
      createdAt: nowISO()
    };

    store.runs.push(run);
    saveStore(store);

    // PB check
    const pb = bestRunForDog(dogId);
    const isPB = pb && pb.id === run.id; // because bestRunForDog includes latest
    toast(isPB ? "Saved! 🏆 New PB" : "Saved run");

    resetTimer();
    render();
  });

  $("#clearRunsForDog")?.addEventListener("click", ()=>{
    const dogId = store.settings.activeDogId || $("#recordDog")?.value;
    if(!dogId) return;
    const dog = store.dogs.find(d=> d.id === dogId);
    if(!confirm(`Clear all runs for ${dog?.name || "this dog"}?`)) return;
    store.runs = store.runs.filter(r=> r.dogId !== dogId);
    saveStore(store);
    render();
  });

  $("tbody")?.addEventListener("click", (e)=>{
    if(e.target.dataset.action !== "deleteRun") return;
    const tr = e.target.closest("[data-runid]");
    if(!tr) return;
    const runId = tr.dataset.runid;
    if(!confirm("Delete this run?")) return;
    store.runs = store.runs.filter(r=> r.id !== runId);
    saveStore(store);
    render();
  });

  // initial KPI
  updateKpi();

  function tick(){
    if(!timer.running) return;
    timer.elapsed = performance.now() - timer.start;
    $("#timerDisplay").textContent = formatTime(timer.elapsed);
    updateKpi();
    timer.raf = requestAnimationFrame(tick);
  }

  function startTimer(){
    timer.running = true;
    timer.start = performance.now() - timer.elapsed;
    $("#startStopBtn").textContent = "Stop";
    $("#timerSub").textContent = "Running… tap Stop to finish.";
    timer.raf = requestAnimationFrame(tick);
  }

  function stopTimer(){
    timer.running = false;
    cancelAnimationFrame(timer.raf);
    $("#startStopBtn").textContent = "Start";
    $("#timerSub").textContent = "Ready to save.";
    updateKpi();
  }

  function resetTimer(){
    timer.running = false;
    cancelAnimationFrame(timer.raf);
    timer.elapsed = 0;
    $("#timerDisplay").textContent = "00:00.00";
    $("#timerSub").textContent = "Tap Start. Tap Stop. Save the run.";
    $("#startStopBtn").textContent = "Start";
  }

  function updateKpi(){
    const dist = parseInt($("#recordDistance")?.value || store.settings.defaultDistanceM, 10);
    const ms = timer.elapsed;
    const spd = ms>0 ? speedKmh(dist, ms) : 0;
    const dogId = $("#recordDog")?.value || store.settings.activeDogId;
    const pb = dogId ? bestRunForDog(dogId) : null;
    const pbTxt = pb ? `${round(pb.speedKmh,2)} km/h • ${pb.distanceM}m` : "—";

    const area = $("#kpiArea");
    if(!area) return;
    area.innerHTML = `
      <span class="badge">Distance <strong>${dist}m</strong></span>
      <span class="badge">Speed <strong>${ms>0 ? round(spd,2) : "—"} km/h</strong></span>
      <span class="badge">Current PB <strong>${pbTxt}</strong></span>
    `;
  }
}

// ---------- Charts (lightweight canvas) ----------
function wireCharts(){
  const sel = $("#chartDogSelect");
  sel?.addEventListener("change", ()=>{
    store.settings.activeDogId = sel.value;
    saveStore(store);
    render();
  });
  drawCharts();
}

function drawCharts(){
  const dogId = store.settings.activeDogId || store.dogs[0]?.id;
  if(!dogId) return;

  const dogRuns = runsForDog(dogId);
  const allRuns = store.runs.slice().sort((a,b)=> a.createdAt.localeCompare(b.createdAt));

  const dogPoints = dogRuns.map((r,i)=> ({ x:i+1, y:r.speedKmh, label: new Date(r.createdAt).toLocaleDateString() }));
  const allPoints = allRuns.map((r,i)=> ({ x:i+1, y:r.speedKmh, label: (dogsById().get(r.dogId)?.name || "Dog") }));

  const dogCanvas = $("#dogChart");
  const allCanvas = $("#allChart");
  if(dogCanvas) lineChart(dogCanvas, dogPoints, `Speed (km/h)`);
  if(allCanvas) lineChart(allCanvas, allPoints, `Speed (km/h)`);
}

function lineChart(canvas, points, yLabel){
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // background
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0,0,w,h);

  const padL = 46, padR = 14, padT = 12, padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // if no data
  if(!points.length){
    ctx.fillStyle = "rgba(243,243,247,0.65)";
    ctx.font = "bold 18px system-ui";
    ctx.fillText("No data yet", padL, padT+30);
    ctx.fillStyle = "rgba(183,183,195,0.75)";
    ctx.font = "14px system-ui";
    ctx.fillText("Record runs to see the chart.", padL, padT+55);
    return;
  }

  const ys = points.map(p=>p.y);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if(yMin === yMax){ yMin = yMin - 1; yMax = yMax + 1; }
  yMin = Math.max(0, yMin*0.95);
  yMax = yMax*1.05;

  const xMin = 1;
  const xMax = Math.max(2, points.length);

  function xScale(x){ return padL + ( (x - xMin) / (xMax - xMin) ) * plotW; }
  function yScale(y){ return padT + (1 - (y - yMin) / (yMax - yMin)) * plotH; }

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  const gridLines = 4;
  for(let i=0;i<=gridLines;i++){
    const y = padT + (i/gridLines)*plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL+plotW, y);
    ctx.stroke();
  }

  // y labels
  ctx.fillStyle = "rgba(183,183,195,0.85)";
  ctx.font = "12px system-ui";
  for(let i=0;i<=gridLines;i++){
    const val = yMax - (i/gridLines)*(yMax-yMin);
    const y = padT + (i/gridLines)*plotH;
    ctx.fillText(val.toFixed(1), 8, y+4);
  }

  // axes label
  ctx.fillStyle = "rgba(183,183,195,0.85)";
  ctx.font = "12px system-ui";
  ctx.fillText(yLabel, padL, h-10);

  // line
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i)=>{
    const x = xScale(p.x);
    const y = yScale(p.y);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // points
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  points.forEach(p=>{
    const x = xScale(p.x);
    const y = yScale(p.y);
    ctx.beginPath();
    ctx.arc(x,y,3.2,0,Math.PI*2);
    ctx.fill();
  });

  // highlight max
  const best = points.reduce((a,b)=> (b.y>a.y ? b : a), points[0]);
  const bx = xScale(best.x), by = yScale(best.y);
  ctx.strokeStyle = "rgba(255,210,77,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx,by,8,0,Math.PI*2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,210,77,0.95)";
  ctx.font = "bold 13px system-ui";
  ctx.fillText(`PB ${best.y.toFixed(2)} km/h`, clamp(bx-60, padL, w-120), clamp(by-12, padT+10, h-40));
}

// ---------- Settings ----------
function wireSettings(){
  $("#defaultDistance")?.addEventListener("change", (e)=>{
    store.settings.defaultDistanceM = parseInt(e.target.value,10);
    saveStore(store);
    toast("Saved");
  });
  $("#defaultSport")?.addEventListener("change", (e)=>{
    store.settings.defaultSport = e.target.value;
    saveStore(store);
    toast("Saved");
  });

  $("#manageDistances")?.addEventListener("click", ()=>{
    modal.open(
      "Manage distances",
      `
        <form class="form" id="distForm">
          <label>Distances (meters, comma separated)
            <input id="distInput" type="text" value="${store.distances.join(", ")}" placeholder="e.g., 50, 100, 200">
          </label>
          <button class="btn primary" type="submit">Save</button>
          <p class="small-note">Tip: keep 100m in the list if that’s your main sprint distance.</p>
        </form>
      `,
      `<button class="btn ghost" type="button" id="cancelDist">Cancel</button>`
    );
    $("#cancelDist").addEventListener("click", modal.close);
    $("#distForm").addEventListener("submit", (e)=>{
      e.preventDefault();
      const raw = ($("#distInput").value||"").split(",").map(x=> parseInt(x.trim(),10)).filter(n=> Number.isFinite(n) && n>0);
      const uniq = Array.from(new Set(raw)).slice(0,12);
      if(!uniq.length){ toast("Enter at least one distance"); return; }
      store.distances = uniq;
      if(!store.distances.includes(store.settings.defaultDistanceM)){
        store.settings.defaultDistanceM = store.distances[0];
      }
      saveStore(store);
      modal.close();
      render();
    });
  });

  $("#exportBtn")?.addEventListener("click", ()=>{
    const data = JSON.stringify(store, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dog-sports-tracking-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    toast("Export started");
  });

  $("#importBtn")?.addEventListener("click", ()=>{
    modal.open(
      "Import backup",
      `
        <form class="form" id="importForm">
          <label>Select backup JSON file
            <input id="importFile" type="file" accept="application/json">
          </label>
          <button class="btn danger" type="submit">Import (overwrites)</button>
          <p class="small-note">This will overwrite your current data.</p>
        </form>
      `,
      `<button class="btn ghost" type="button" id="cancelImport">Cancel</button>`
    );
    $("#cancelImport").addEventListener("click", modal.close);
    $("#importForm").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const file = $("#importFile").files?.[0];
      if(!file){ toast("Select a file"); return; }
      const text = await file.text();
      const data = safeJSONParse(text, null);
      if(!data || !data.version){ toast("Invalid backup file"); return; }
      store = data;
      saveStore(store);
      modal.close();
      render();
      toast("Imported");
    });
  });

  $("#factoryReset")?.addEventListener("click", ()=>{
    if(!confirm("Factory reset will delete dogs and runs. Continue?")) return;
    store = defaultStore();
    saveStore(store);
    render();
  });
}

// ---------- Simple toast ----------
let toastTimer = 0;
function toast(msg){
  clearTimeout(toastTimer);
  let el = $("#toast");
  if(!el){
    el = document.createElement("div");
    el.id = "toast";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "86px";
    el.style.transform = "translateX(-50%)";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "14px";
    el.style.border = "1px solid rgba(255,255,255,0.14)";
    el.style.background = "rgba(20,20,27,0.95)";
    el.style.color = "rgba(243,243,247,0.95)";
    el.style.fontWeight = "800";
    el.style.fontSize = "13px";
    el.style.zIndex = "100";
    el.style.maxWidth = "calc(100% - 24px)";
    el.style.textAlign = "center";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  toastTimer = setTimeout(()=>{ el.style.opacity = "0"; }, 2200);
}

// ---------- Escaping helpers ----------
function escapeHTML(str){
  return (str ?? "").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}
function escapeAttr(str){ return escapeHTML(str).replace(/"/g, "&quot;"); }

// initial render
render();
