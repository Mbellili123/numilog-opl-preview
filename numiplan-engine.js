/*! NumiPlan engine — activité + contraintes sociales (pas un ordre R1→R12) */
(function (global) {
  "use strict";
  const CYCLE = ["M", "A", "N"];
  const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
  function regimeCoeff(regime) {
    if (regime === 5) return 1.11;
    if (regime === 6) return 1.26;
    return 1.4;
  }
  function shuffleCopy(arr, seed) {
    const rng = mulberry32(seed >>> 0);
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function dayNeedSum(n) { return (n?.M || 0) + (n?.A || 0) + (n?.N || 0); }

  function assignShift(p, day, sId, quota, consecutive) {
    p.assignments[day] = sId;
    p.lastShift = sId;
    p.currentLockedShift = sId;
    p.consecutiveDaysOnShift = consecutive;
    p.weeklyWorkDays++;
    quota[sId]--;
    if (sId === "M" || sId === "A") p.mustResumeMorning = false;
    if (sId === "N") p.restDaysLeft = 2;
  }
  function canWorkToday(p, day) {
    if (p.isOff[day]) return false;
    if (p.restDaysLeft > 0) return false;
    if (p.weeklyWorkDays >= 5) return false;
    if (p.assignments[day] !== "R") return false;
    return true;
  }
  function preferredShifts(p) {
    if (p.mustResumeMorning) return ["M", "A"];
    if (p.currentLockedShift && p.consecutiveDaysOnShift < 3) return [p.currentLockedShift];
    const i = CYCLE.indexOf(p.lastShift);
    if (i >= 0 && i < 2) return [CYCLE[i + 1]];
    if (i === 2) return ["M", "A"];
    return CYCLE;
  }
  function canTakeShift(p, sId) {
    if (p.mustResumeMorning && sId === "N") return false;
    return true;
  }

  function generateSchedule(state) {
    if (!state.employees?.length) {
      return { ok: false, error: "Ajoutez des employés avant de générer le planning." };
    }
    const year = Number(state.year);
    const month = Number(state.month);
    const nDays = daysInMonth(year, month);
    const needs = Array.from({ length: nDays }, (_, i) => state.needsByDay[i] || { M: 0, A: 0, N: 0, day: i + 1 });
    const sums = needs.map((n) => dayNeedSum(n));
    const peakNeed = sums.length ? Math.max(0, ...sums) : 0;
    const neededCount = Math.ceil(peakNeed * regimeCoeff(state.activityRegime));

    const pool = [...state.employees.map((e) => ({ ...e, isVirtual: false }))];
    const missingBefore = Math.max(0, neededCount - pool.length);
    let v = 1;
    if (state.allowVirtual) {
      while (pool.length < neededCount) {
        pool.push({ name: `OPL virtuel ${v++}`, ca: 0, recup: 0, isVirtual: true });
      }
    }

    const total = pool.length;
    const staffShort = total < neededCount || total < peakNeed;

    const weeks = [];
    let currentWeek = [];
    for (let d = 1; d <= nDays; d++) {
      currentWeek.push(d - 1);
      const date = new Date(year, month, d);
      if (date.getDay() === 0 || d === nDays) {
        weeks.push([...currentWeek]);
        currentWeek = [];
      }
    }

    const leaveSchedule = Array.from({ length: total }, () => new Array(nDays).fill(null));
    const currentCA = pool.map((e) => e.ca || 0);
    const currentRecup = pool.map((e) => e.recup || 0);
    let prevWeekLeavers = new Set();

    weeks.forEach((weekIndices) => {
      let maxNeedInWeek = 0;
      weekIndices.forEach((idx) => {
        maxNeedInWeek = Math.max(maxNeedInWeek, dayNeedSum(needs[idx]));
      });
      const weekReserve = Math.max(maxNeedInWeek, Math.ceil(maxNeedInWeek * regimeCoeff(state.activityRegime)));
      const surplus = staffShort ? 0 : Math.max(0, total - weekReserve);
      const selectedThisWeek = new Set();
      let used = 0;

      if (surplus > 0) {
        const caCandidates = pool
          .map((e, idx) => ({ idx, ca: currentCA[idx], wasOnLeave: prevWeekLeavers.has(idx) }))
          .filter((c) => c.ca >= weekIndices.length)
          .sort((a, b) => (a.wasOnLeave !== b.wasOnLeave ? (a.wasOnLeave ? 1 : -1) : b.ca - a.ca));
        for (let i = 0; i < Math.min(surplus, caCandidates.length); i++) {
          const empIdx = caCandidates[i].idx;
          weekIndices.forEach((dIdx) => { leaveSchedule[empIdx][dIdx] = "C"; });
          currentCA[empIdx] -= weekIndices.length;
          selectedThisWeek.add(empIdx);
          used++;
        }
        if (used < surplus) {
          const recupCandidates = pool
            .map((e, idx) => ({ idx, recup: currentRecup[idx], wasOnLeave: prevWeekLeavers.has(idx) }))
            .filter((c) => !selectedThisWeek.has(c.idx) && c.recup >= weekIndices.length)
            .sort((a, b) => (a.wasOnLeave !== b.wasOnLeave ? (a.wasOnLeave ? 1 : -1) : b.recup - a.recup));
          for (let i = 0; i < Math.min(surplus - used, recupCandidates.length); i++) {
            const empIdx = recupCandidates[i].idx;
            weekIndices.forEach((dIdx) => { leaveSchedule[empIdx][dIdx] = "CP"; });
            currentRecup[empIdx] -= weekIndices.length;
            selectedThisWeek.add(empIdx);
          }
        }
      }
      prevWeekLeavers = selectedThisWeek;
    });

    const schedule = pool.map((emp, i) => ({
      name: emp.name,
      isVirtual: !!emp.isVirtual,
      assignments: new Array(nDays).fill("R"),
      lastShift: null,
      restDaysLeft: 0,
      mustResumeMorning: false,
      isOff: leaveSchedule[i],
      consecutiveDaysOnShift: 0,
      currentLockedShift: null,
      recupBalance: pool[i].recup || 0,
      weeklyWorkDays: 0,
    }));

    for (let d = 0; d < nDays; d++) {
      if (new Date(year, month, d + 1).getDay() === 1) {
        schedule.forEach((p) => (p.weeklyWorkDays = 0));
      }
      const need = needs[d] || { M: 0, A: 0, N: 0 };
      const quota = { M: need.M || 0, A: need.A || 0, N: need.N || 0 };
      const dayDemand = dayNeedSum(need);
      const workers = shuffleCopy(schedule, year * 400 + month * 32 + d + 17);

      if (dayDemand > 0) {
        for (const p of workers.filter((w) => w.isOff[d] === "C" || w.isOff[d] === "CP")) {
          const avail = workers.filter(
            (w) => !w.isOff[d] && w.restDaysLeft === 0 && w.weeklyWorkDays < 5
          ).length;
          if (avail >= dayDemand) break;
          p.isOff[d] = null;
        }
      }

      workers.forEach((p) => {
        if (p.isOff[d]) {
          p.assignments[d] = p.isOff[d];
          p.lastShift = "R";
          p.consecutiveDaysOnShift = 0;
          p.currentLockedShift = null;
          p.mustResumeMorning = false;
          return;
        }
        if (p.restDaysLeft > 0) {
          p.assignments[d] = "R";
          p.restDaysLeft--;
          p.consecutiveDaysOnShift = 0;
          p.currentLockedShift = null;
          p.lastShift = "R";
          if (p.restDaysLeft === 0) p.mustResumeMorning = true;
          return;
        }
        if (p.weeklyWorkDays >= 5) {
          p.assignments[d] = "R";
          p.consecutiveDaysOnShift = 0;
          p.currentLockedShift = null;
          p.lastShift = "R";
        }
      });

      const fillQuota = (sId, preferOnly) => {
        while (quota[sId] > 0) {
          const poolEligible = workers.filter((p) => canWorkToday(p, d) && canTakeShift(p, sId));
          let candidate = null;
          if (preferOnly) {
            if (sId === "N") {
              candidate = poolEligible.find(
                (p) => p.currentLockedShift === "N" && p.consecutiveDaysOnShift > 0 && p.consecutiveDaysOnShift < 3
              );
              if (!candidate) candidate = poolEligible.find((p) => p.lastShift === "A");
              if (!candidate) candidate = poolEligible.find((p) => preferredShifts(p).includes("N"));
            } else if (sId === "M") {
              candidate = poolEligible.find((p) => p.mustResumeMorning);
              if (!candidate) {
                candidate = poolEligible.find(
                  (p) => p.currentLockedShift === "M" && p.consecutiveDaysOnShift > 0 && p.consecutiveDaysOnShift < 3
                );
              }
              if (!candidate) candidate = poolEligible.find((p) => preferredShifts(p).includes("M"));
            } else {
              candidate = poolEligible.find(
                (p) => p.currentLockedShift === sId && p.consecutiveDaysOnShift > 0 && p.consecutiveDaysOnShift < 3
              );
              if (!candidate) candidate = poolEligible.find((p) => preferredShifts(p).includes(sId));
            }
          } else {
            candidate = poolEligible[0] || null;
          }
          if (!candidate) break;
          const cons =
            candidate.currentLockedShift === sId ? candidate.consecutiveDaysOnShift + 1 : 1;
          assignShift(candidate, d, sId, quota, cons);
        }
      };

      const FILL_ORDER = ["N", "M", "A"];
      for (const sId of FILL_ORDER) fillQuota(sId, true);
      for (const sId of FILL_ORDER) fillQuota(sId, false);

      const stillShort = quota.M + quota.A + quota.N > 0;
      workers
        .filter((p) => canWorkToday(p, d))
        .forEach((p) => {
          if (stillShort) return;
          if (dayDemand === 0) {
            p.assignments[d] = "R";
            p.lastShift = "R";
            p.consecutiveDaysOnShift = 0;
            p.currentLockedShift = null;
            return;
          }
          if (p.recupBalance > 0) {
            p.assignments[d] = "CP";
            p.recupBalance--;
            p.consecutiveDaysOnShift = 0;
            p.currentLockedShift = null;
            p.lastShift = "R";
            return;
          }
          const weekStart = (() => {
            const dt = new Date(year, month, d + 1);
            const dow = dt.getDay();
            const back = dow === 0 ? 6 : dow - 1;
            return Math.max(0, d - back);
          })();
          let restInWeek = 0;
          for (let k = weekStart; k < d; k++) {
            const a = p.assignments[k];
            if (a === "R" || a === "C" || a === "CP") restInWeek++;
          }
          const prev = d > 0 && CYCLE.includes(p.assignments[d - 1]) ? p.assignments[d - 1] : null;
          if (restInWeek < 2 || !prev) {
            p.assignments[d] = "R";
            p.lastShift = "R";
            p.consecutiveDaysOnShift = 0;
            p.currentLockedShift = null;
          } else {
            p.assignments[d] = "S";
            p.lastShift = prev;
            p.currentLockedShift = prev;
            p.consecutiveDaysOnShift = (p.consecutiveDaysOnShift || 0) + 1;
            p.weeklyWorkDays++;
          }
        });
    }

    const generatedSchedule = schedule.map((p) => ({
      name: p.name,
      isVirtual: p.isVirtual,
      assignments: p.assignments,
     }));

    let uncoveredDays = 0;
    for (let d = 0; d < nDays; d++) {
     const need = dayNeedSum(needs[d]);
      if (need <= 0) continue;
      const covered = generatedSchedule.reduce((s, emp) => {
        const a = emp.assignments[d];
        return s + (a === "M" || a === "A" || a === "N" ? 1 : 0);
      }, 0);
      if (covered < need) uncoveredDays++;
    }

    return {
      ok: true,
      generatedSchedule,
      virtualCount: pool.filter((e) => e.isVirtual).length,
      missingCount: state.allowVirtual ? 0 : missingBefore,
      allowVirtual: !!state.allowVirtual,
      activityFirst: true,
      staffShort,
      uncoveredDays,
      neededCount,
      peakNeed,
      realCount: state.employees.length,
      nDays,
      monthLabel: MONTH_NAMES[month] + " " + year,
    };
  }

  global.NumiPlanGenerateSchedule = generateSchedule;
  global.NumiPlanEngine = { generateSchedule, version: "contraintes-v1" };
})(typeof globalThis !== "undefined" ? globalThis : window);
