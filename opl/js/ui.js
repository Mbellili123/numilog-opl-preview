/* global Chart, DATA */
(function () {
  const FR = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const FR1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const fmt = (n) => (Number.isFinite(n) ? FR.format(Math.round(n)) : "—");
  const fmt1 = (n) => (Number.isFinite(n) ? FR1.format(n) : "—");
  const fmtD = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  const ceil = (x) => (Number.isFinite(x) ? Math.ceil(Math.max(0, x)) : 0);

  const LS = {
    params: "numilog-opl-params",
    anom: "numilog-anom-keep",
  };

  const state = {
    plf: "703",
    act: "CEF",
    flow: "OUT",
    scenario: "p80",
    growth: 1,
    charts: {},
  };

  function loadParams() {
    try {
      return JSON.parse(localStorage.getItem(LS.params) || "{}");
    } catch {
      return {};
    }
  }
  function saveParams(p) {
    localStorage.setItem(LS.params, JSON.stringify(p));
  }
  function keptMap() {
    try {
      return JSON.parse(localStorage.getItem(LS.anom) || "{}");
    } catch {
      return {};
    }
  }

  if (!window.DATA) {
    document.getElementById("mode-banner").textContent =
      "data.js manquant. Double-cliquez run.bat à la racine du projet, puis rechargez cette page.";
    return;
  }

  const D = window.DATA;
  const saved = loadParams();
  if (saved.plf && D.platforms[saved.plf]) state.plf = saved.plf;
  if (saved.act) state.act = saved.act;
  if (saved.flow) state.flow = saved.flow;

  function seriesKey() {
    const measure = state.flow === "IN" ? "pal" : "pal_colis";
    return `${state.plf}|${state.act}|${state.flow}|${measure}`;
  }
  function getSeries() {
    return D.series.find((s) => s.key === seriesKey());
  }
  function getFc() {
    return D.forecasts.find((s) => s.key === seriesKey());
  }
  function actsOfPlf() {
    return D.activities.filter((a) => a.platform === state.plf);
  }

  function oplNeed(volume, p) {
    const prod = Number(p.prod) || 22;
    const hours = Number(p.hours) || 6.5;
    const shifts = Number(p.shifts) || 1;
    const abs = (Number(p.abs) || 10) / 100;
    const cap = prod * hours * shifts * (1 - abs);
    if (cap <= 0) return 0;
    return volume / cap;
  }

  function scenarioVol(fc, i) {
    if (!fc) return 0;
    const g = Number(document.getElementById("growth").value) || 1;
    if (state.scenario === "p50") return fc.p50[i];
    if (state.scenario === "growth") return fc.p50[i] * g;
    return fc.p80[i];
  }

  function persist() {
    saveParams({
      ...loadParams(),
      plf: state.plf,
      act: state.act,
      flow: state.flow,
      prod: document.getElementById("prod").value,
      hours: document.getElementById("hours").value,
      shifts: document.getElementById("shifts").value,
      abs: document.getElementById("abs").value,
      staff: document.getElementById("staff-now").value,
    });
  }

  function chart(id, cfg) {
    const prev = state.charts[id];
    if (prev) prev.destroy();
    const ctx = document.getElementById(id);
    if (!ctx || !window.Chart) return;
    state.charts[id] = new Chart(ctx, cfg);
  }

  function renderRail() {
    const rail = document.getElementById("plf-rail");
    const enable105 = document.getElementById("enable-105").checked;
    rail.innerHTML = "";
    for (const code of Object.keys(D.platforms)) {
      if (code === "105" && !enable105) continue;
      const p = D.platforms[code];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "plf-btn" + (code === state.plf ? " active" : "");
      b.style.setProperty("--accent", p.color);
      b.innerHTML = `<strong>${p.name}</strong><small>${code} · coupure ${fmtD(p.cutoff)}</small>`;
      b.onclick = () => {
        state.plf = code;
        const acts = actsOfPlf();
        state.act = acts[0]?.act || state.act;
        persist();
        renderAll();
      };
      rail.appendChild(b);
    }
  }

  function fillActs() {
    const sel = document.getElementById("filter-act");
    const acts = actsOfPlf();
    sel.innerHTML = acts
      .map((a) => `<option value="${a.act}">${a.act} · ${a.status}</option>`)
      .join("");
    if (!acts.some((a) => a.act === state.act) && acts[0]) state.act = acts[0].act;
    sel.value = state.act;
  }

  function renderMeta() {
    const p = D.platforms[state.plf];
    const fc = getFc();
    document.getElementById("meta-plf").textContent = p ? `${p.code} ${p.name}` : "—";
    document.getElementById("meta-cutoff").textContent = fmtD(p?.cutoff);
    document.getElementById("meta-model").textContent = fc?.modelLabel || "—";
    const w = fc?.metrics?.wape;
    document.getElementById("meta-wape").textContent = Number.isFinite(w) ? fmt1(w) + " %" : "—";
    document.getElementById("mode-banner").innerHTML =
      `<strong>DONNÉES RÉELLES</strong> — ${p?.name} · ${state.act} · ${state.flow} · horizon → 30/09/2027 · mesure OUT = PAL+COLIS.`;
  }

  function renderKpis() {
    const s = getSeries();
    const fc = getFc();
    const box = document.getElementById("kpi-row");
    if (!s || !fc) {
      box.innerHTML = "<p>Série indisponible.</p>";
      return;
    }
    const hist = s.y.reduce((a, b) => a + b, 0);
    const daysH = s.y.length;
    const next365 = fc.p50.slice(0, 365).reduce((a, b) => a + b, 0);
    const prev365 = s.y.slice(-365).reduce((a, b) => a + b, 0);
    const varPct = prev365 ? (100 * (next365 - prev365)) / prev365 : null;
    const peakW = fc.weekly.reduce((m, w) => (w.p80 > m.p80 ? w : m), fc.weekly[0] || { p80: 0, peak: 0, week: "—" });
    const p = { ...loadParams(), prod: document.getElementById("prod").value, hours: document.getElementById("hours").value, shifts: document.getElementById("shifts").value, abs: document.getElementById("abs").value };
    const oplPeak = ceil(oplNeed(peakW.peak, p));
    box.innerHTML = [
      ["Volume 12 mois prévus", fmt(next365), "P50, 365 j"],
      ["Vs 12 derniers mois", (varPct == null ? "—" : (varPct > 0 ? "+" : "") + fmt1(varPct) + " %"), `hist. ${fmt(prev365)}`],
      ["Pic hebdo (P80)", fmt(peakW.p80), `semaine ${fmtD(peakW.week)}`],
      ["OPL au pic jour", String(oplPeak), "ceil, scénario prudent"],
    ]
      .map(
        ([l, v, f]) =>
          `<article class="kpi"><span class="label">${l}</span><div class="value">${v}</div><span class="foot">${f}</span></article>`
      )
      .join("");
    void hist;
    void daysH;
  }

  function renderMainChart() {
    const s = getSeries();
    const fc = getFc();
    if (!s || !fc) return;
    const histN = Math.min(s.dates.length, 180);
    const labels = s.dates.slice(-histN).concat(fc.dates);
    const hist = Array(histN).fill(null).map((_, i) => s.y[s.y.length - histN + i]).concat(fc.dates.map(() => null));
    const p50 = Array(histN).fill(null).concat(fc.p50);
    const p10 = Array(histN).fill(null).concat(fc.p10);
    const p90 = Array(histN).fill(null).concat(fc.p90);
    chart("chart-main", {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Réel", data: hist, borderColor: "#1e3a5f", pointRadius: 0, borderWidth: 1.5 },
          { label: "P50", data: p50, borderColor: "#0d7a8c", pointRadius: 0, borderWidth: 2 },
          { label: "P10", data: p10, borderColor: "#d5dee8", pointRadius: 0, borderWidth: 1 },
          { label: "P90", data: p90, borderColor: "#d5dee8", pointRadius: 0, borderWidth: 1 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 12 } } } },
    });
    chart("chart-hist", {
      type: "line",
      data: { labels: s.dates, datasets: [{ label: "Réel corrigé", data: s.y, borderColor: "#1e3a5f", pointRadius: 0, borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 16 } } } },
    });
    chart("chart-fc", {
      type: "line",
      data: {
        labels: fc.dates,
        datasets: [
          { label: "P50", data: fc.p50, borderColor: "#0d7a8c", pointRadius: 0 },
          { label: "P80", data: fc.p80, borderColor: "#b86a1c", pointRadius: 0 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 14 } } } },
    });
  }

  function renderProfile() {
    const p = D.platforms[state.plf];
    const prof = state.flow === "IN" ? p.weekdayProfileIn : p.weekdayProfileOut;
    const names = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    document.getElementById("open-profile").innerHTML = `<table class="data"><thead><tr><th>Jour</th><th>Ouvert</th><th class="num">Taux actif</th><th class="num">Moyenne</th></tr></thead><tbody>${prof
      .map(
        (r) =>
          `<tr><td>${names[r.day]}</td><td>${r.closed ? "fermé (projeté 0)" : "ouvert"}</td><td class="num">${fmt1(100 * r.rate)} %</td><td class="num">${fmt(r.avg)}</td></tr>`
      )
      .join("")}</tbody></table>`;
  }

  function renderQuality() {
    const tb = document.querySelector("#table-acts tbody");
    tb.innerHTML = D.activities
      .map(
        (a) =>
          `<tr><td>${a.platform}</td><td>${a.act}</td><td><span class="badge ${a.status}">${a.status}${a.shortHistory ? " · hist. court" : ""}</span></td><td>${fmtD(a.firstDate)}</td><td>${fmtD(a.lastDate)}</td><td class="num">${a.nActiveDays}</td></tr>`
      )
      .join("");
    const keep = keptMap();
    const anoms = D.anomalies.filter((a) => a.platform === state.plf).slice(0, 400);
    document.getElementById("anom-count").textContent = `${anoms.length} lignes (filtre plateforme) · choix mémorisés dans ce navigateur.`;
    document.querySelector("#table-anom tbody").innerHTML = anoms
      .map((a, i) => {
        const id = `${a.date}|${a.platform}|${a.act}|${a.flow}|${a.raw}`;
        const k = keep[id];
        return `<tr><td>${fmtD(a.date)}</td><td>${a.platform}</td><td>${a.act}</td><td>${a.flow}</td><td class="num">${fmt(a.raw)}</td><td class="num">${fmt(a.corrected)}</td><td>${a.rule || ""}</td><td>
          <button type="button" class="btn" data-keep="${id}" data-v="${k === "keep" ? "1" : "0"}">${k === "keep" ? "Gardé" : "Garder"}</button>
          <button type="button" class="btn" data-fix="${id}">${k === "fix" ? "Corrigé" : "Corriger"}</button>
        </td></tr>`;
      })
      .join("");
    document.getElementById("ignored-box").innerHTML =
      "<ul>" + D.ignored.filter((a) => a.platform === state.plf).map((a) => `<li>${a.act} — ${a.reason}</li>`).join("") + "</ul>";
  }

  function renderWeeks() {
    const fc = getFc();
    if (!fc) return;
    document.querySelector("#table-week tbody").innerHTML = fc.weekly
      .map((w) => `<tr><td>${fmtD(w.week)}</td><td class="num">${fmt(w.p50)}</td><td class="num">${fmt(w.p80)}</td><td class="num">${fmt(w.peak)}</td></tr>`)
      .join("");
  }

  function renderBt() {
    const fc = getFc();
    const box = document.getElementById("bt-rank");
    if (!fc) return;
    const rows = (fc.ranking || [])
      .map(
        (r, i) =>
          `<tr class="${r.id === fc.model ? "hl" : ""}"><td>${i + 1}</td><td>${D.modelLabels[r.id] || r.id}${r.id === fc.model ? " ← retenu" : ""}</td><td class="num">${fmt1(r.wape)}</td><td class="num">${fmt1(r.mase)}</td><td class="num">${fmt1(r.bias)}</td><td class="num">${fmt1(r.rmse)}</td></tr>`
      )
      .join("");
    box.innerHTML = `<h2>Classement (WAPE hebdo)</h2>
      <p class="muted-note">Confiance : <strong>${fc.confidence}</strong>. Origines : ${(fc.origins || []).map(fmtD).join(" · ") || "—"}.</p>
      <table class="data"><thead><tr><th>#</th><th>Modèle</th><th class="num">WAPE %</th><th class="num">MASE</th><th class="num">Biais %</th><th class="num">RMSE</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById("bt-origins").textContent =
      "Protocole : 4 origines glissantes, horizon 13 semaines, pas de mélange aléatoire train/test.";
  }

  function renderOpl() {
    const fc = getFc();
    const p = {
      prod: document.getElementById("prod").value,
      hours: document.getElementById("hours").value,
      shifts: document.getElementById("shifts").value,
      abs: document.getElementById("abs").value,
    };
    persist();
    if (!fc) return;
    const staff = Number(document.getElementById("staff-now").value);
    const platFcs = D.forecasts.filter((f) => f.platform === state.plf && f.flow === state.flow);
    const weeks = fc.weekly;
    const rows = weeks.map((w, wi) => {
      const vol = state.scenario === "p50" ? w.p50 : w.p80 * (state.scenario === "growth" ? Number(document.getElementById("growth").value) || 1 : 1);
      const peak = w.peak * (state.scenario === "growth" ? Number(document.getElementById("growth").value) || 1 : 1);
      const oplAct = ceil(oplNeed(peak, p));
      let mut = 0;
      for (const f of platFcs) {
        const ww = f.weekly[wi];
        if (ww) mut += oplNeed(ww.peak, p);
      }
      const oplMut = ceil(mut);
      const gap = Number.isFinite(staff) && staff > 0 ? oplAct - staff : null;
      return { w, vol, peak, oplAct, oplMut, gap };
    });
    const maxOpl = rows.reduce((m, r) => Math.max(m, r.oplAct), 0);
    document.getElementById("opl-kpis").innerHTML = [
      ["OPL max (activité)", String(maxOpl), "ceil pic jour"],
      ["OPL max mutualisé", String(rows.reduce((m, r) => Math.max(m, r.oplMut), 0)), "toutes ACT " + state.plf],
      ["Gain polyvalence", String(rows.reduce((m, r) => Math.max(m, r.oplMut), 0) && maxOpl ? Math.max(0, maxOpl /* per act only */) : 0), "voir tableau"],
    ]
      .map(([l, v, f]) => `<article class="kpi"><span class="label">${l}</span><div class="value">${v}</div><span class="foot">${f}</span></article>`)
      .join("");
    document.querySelector("#table-opl tbody").innerHTML = rows
      .map(
        (r) =>
          `<tr><td>${fmtD(r.w.week)}</td><td class="num">${fmt(r.vol)}</td><td class="num">${fmt(r.peak)}</td><td class="num">${r.oplAct}</td><td class="num">${r.oplMut}</td><td class="num">${r.gap == null ? "—" : (r.gap > 0 ? "+" : "") + r.gap}</td></tr>`
      )
      .join("");
    chart("chart-opl", {
      type: "bar",
      data: {
        labels: rows.map((r) => r.w.week),
        datasets: [
          { label: "OPL activité", data: rows.map((r) => r.oplAct), backgroundColor: "#1e3a5f" },
          { label: "OPL mutualisé", data: rows.map((r) => r.oplMut), backgroundColor: "#0d7a8c" },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 16 } } } },
    });
  }

  function renderAll() {
    renderRail();
    fillActs();
    renderMeta();
    renderKpis();
    renderMainChart();
    renderProfile();
    renderQuality();
    renderWeeks();
    renderBt();
    renderOpl();
  }

  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main .view").forEach((v) => v.classList.toggle("active", v.dataset.view === b.dataset.view));
  });
  document.getElementById("filter-act").onchange = (e) => {
    state.act = e.target.value;
    persist();
    renderAll();
  };
  document.getElementById("filter-flow").onchange = (e) => {
    state.flow = e.target.value;
    persist();
    renderAll();
  };
  document.getElementById("filter-scenario").onchange = (e) => {
    state.scenario = e.target.value;
    renderOpl();
    renderKpis();
  };
  document.getElementById("growth").onchange = () => {
    renderOpl();
    renderKpis();
  };
  ["prod", "hours", "shifts", "abs", "staff-now"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => renderOpl());
  });
  document.getElementById("enable-105").onchange = () => {
    if (state.plf === "105" && !document.getElementById("enable-105").checked) state.plf = "703";
    renderAll();
  };
  document.getElementById("table-anom").addEventListener("click", (e) => {
    const keepBtn = e.target.closest("[data-keep]");
    const fixBtn = e.target.closest("[data-fix]");
    const map = keptMap();
    if (keepBtn) map[keepBtn.dataset.keep] = "keep";
    if (fixBtn) map[fixBtn.dataset.fix] = "fix";
    localStorage.setItem(LS.anom, JSON.stringify(map));
    renderQuality();
  });
  document.getElementById("btn-export").onclick = () => {
    const fc = getFc();
    if (!fc) return;
    const lines = ["semaine,p50,p80,pic"].concat(fc.weekly.map((w) => `${w.week},${w.p50},${w.p80},${w.peak}`));
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prevision_${state.plf}_${state.act}_${state.flow}.csv`;
    a.click();
  };
  document.getElementById("btn-prod-export").onclick = () => {
    const blob = new Blob([JSON.stringify(loadParams(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "parametres-opl.json";
    a.click();
  };
  document.getElementById("prod-import").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        localStorage.setItem(LS.params, JSON.stringify(p));
        ["prod", "hours", "shifts", "abs"].forEach((id) => {
          if (p[id] != null) document.getElementById(id).value = p[id];
        });
        renderAll();
      } catch (err) {
        alert("JSON invalide");
      }
    };
    r.readAsText(f);
  };

  const p0 = loadParams();
  if (p0.prod) document.getElementById("prod").value = p0.prod;
  if (p0.hours) document.getElementById("hours").value = p0.hours;
  if (p0.shifts) document.getElementById("shifts").value = p0.shifts;
  if (p0.abs) document.getElementById("abs").value = p0.abs;
  if (p0.staff) document.getElementById("staff-now").value = p0.staff;

  renderAll();
})();
