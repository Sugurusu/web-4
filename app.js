const STORAGE_KEY = "pullupBattleRecords";
const API_URL = location.protocol.startsWith("http") ? "/api/records" : null;

const members = [
  { name: "すぐる", initialDate: "2026-05-07", initialReps: 34, handicap: 0, color: "#1f1f1f" },
  { name: "ミーツ", initialDate: "2026-05-07", initialReps: 16, handicap: 0, color: "#6f7d67" },
  { name: "みほ", initialDate: "2026-05-07", initialReps: 7, handicap: 15, color: "#b08a5a" },
  { name: "のり", initialDate: null, initialReps: null, handicap: 0, color: "#8f4f3d" },
];

let records = loadRecords();
let activeRanking = "score";
let charts = {};
let sharedMode = false;
let isPushing = false;

const els = {
  form: document.querySelector("#recordForm"),
  nameInput: document.querySelector("#nameInput"),
  dateInput: document.querySelector("#dateInput"),
  typeInput: document.querySelector("#typeInput"),
  repsInput: document.querySelector("#repsInput"),
  totalInput: document.querySelector("#totalInput"),
  practiceMaxInput: document.querySelector("#practiceMaxInput"),
  maxFields: document.querySelector("#maxFields"),
  trainingFields: document.querySelector("#trainingFields"),
  memoInput: document.querySelector("#memoInput"),
  resetButton: document.querySelector("#resetButton"),
  summaryStrip: document.querySelector("#summaryStrip"),
  rankingList: document.querySelector("#rankingList"),
  memberGrid: document.querySelector("#memberGrid"),
  historyList: document.querySelector("#historyList"),
  syncStatus: document.querySelector("#syncStatus"),
  tabs: document.querySelectorAll(".tab"),
};

init();

async function init() {
  els.nameInput.innerHTML = members.map((member) => `<option value="${member.name}">${member.name}</option>`).join("");
  els.dateInput.value = todayString();
  els.repsInput.required = true;
  els.typeInput.addEventListener("change", syncRecordTypeFields);
  els.form.addEventListener("submit", addRecord);
  els.resetButton.addEventListener("click", resetData);
  els.historyList.addEventListener("click", handleHistoryAction);
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeRanking = tab.dataset.ranking;
      els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
      renderRanking();
    });
  });

  // Fetch from server first if API is available
  if (API_URL) {
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.records)) {
          records = data.records.map(normalizeRecord);
        }
      }
    } catch (e) {
      // Fall back to localStorage/defaults
    }
  }

  render();
  startSharedSync();
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function loadRecords() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDefaultRecords();

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.map(normalizeRecord) : createDefaultRecords();
  } catch {
    return createDefaultRecords();
  }
}

function normalizeRecord(record) {
  const type = record.type || "max";
  if (type === "training") {
    return {
      id: record.id || createId(),
      type,
      name: record.name,
      date: record.date,
      createdAt: normalizeCreatedAt(record, 0),
      totalReps: Number(record.totalReps) || 0,
      practiceMax: normalizePracticeMax(record),
      memo: record.memo || "",
    };
  }
  return {
    id: record.id || createId(),
    type: "max",
    name: record.name,
    date: record.date,
    createdAt: normalizeCreatedAt(record, 0),
    reps: normalizeMaxReps(record),
    memo: record.memo || "",
  };
}

function normalizeCreatedAt(record, fallback) {
  if (Number.isFinite(Number(record.createdAt))) return Number(record.createdAt);
  const idTime = String(record.id || "").match(/^(\d{10,})/);
  if (idTime) return Number(idTime[1]);
  return fallback || Date.parse(record.date) || Date.now();
}

function normalizeMaxReps(record) {
  const reps = Number(record.reps) || 0;
  const isOriginalMeetsRecord = record.name === "ミーツ" && record.date === "2026-05-07" && reps === 17 && (!record.memo || record.memo === "初回測定");
  return isOriginalMeetsRecord ? 16 : reps;
}

function normalizePracticeMax(record) {
  return Number(record.practiceMax ?? record.maxSet) || 0;
}

function createId() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultRecords() {
  return members
    .filter((member) => member.initialDate)
    .map((member) => ({
      id: createId(),
      type: "max",
      name: member.name,
      date: member.initialDate,
      createdAt: Date.parse(member.initialDate) + members.indexOf(member),
      reps: member.initialReps,
      memo: "初回測定",
    }));
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  pushRecordsToServer();
}

async function startSharedSync() {
  if (!API_URL) {
    setSyncStatus("端末内保存中。共有する場合は http://localhost:8000 で開いてください。");
    return;
  }

  await pullRecordsFromServer(true);
  window.setInterval(() => pullRecordsFromServer(false), 3000);
}

async function pullRecordsFromServer(isInitial) {
  if (isPushing) return;

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("共有データを取得できませんでした");

    const data = await response.json();
    sharedMode = true;

    if (Array.isArray(data.records)) {
      const nextRecords = data.records.map(normalizeRecord);
      if (JSON.stringify(nextRecords) !== JSON.stringify(records)) {
        records = nextRecords;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        render();
      }
      setSyncStatus("共有保存中。他の人の入力も数秒以内に反映されます。");
      return;
    }

    if (isInitial) {
      await pushRecordsToServer();
      setSyncStatus("共有保存を開始しました。他の人は同じURLから参加できます。");
    }
  } catch {
    sharedMode = false;
    setSyncStatus("サーバーに接続できないため、この端末内だけに保存しています。");
  }
}

async function pushRecordsToServer() {
  if (!API_URL) return;

  try {
    isPushing = true;
    const response = await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    });
    if (!response.ok) throw new Error("共有保存に失敗しました");
    sharedMode = true;
    setSyncStatus("共有保存済み。他の人の画面にも反映されます。");
  } catch {
    sharedMode = false;
    setSyncStatus("共有保存に失敗しました。この端末には保存されています。");
  } finally {
    isPushing = false;
  }
}

function setSyncStatus(message) {
  if (!els.syncStatus) return;
  els.syncStatus.textContent = message;
  els.syncStatus.dataset.mode = sharedMode ? "shared" : "local";
}

function syncRecordTypeFields() {
  const isTraining = els.typeInput.value === "training";
  els.maxFields.classList.toggle("hidden", isTraining);
  els.trainingFields.classList.toggle("hidden", !isTraining);
  els.repsInput.required = !isTraining;
  els.totalInput.required = isTraining;
  els.practiceMaxInput.required = isTraining;
}

function addRecord(event) {
  event.preventDefault();
  const type = els.typeInput.value;
  const base = {
    id: createId(),
    type,
    name: els.nameInput.value,
    date: els.dateInput.value,
    createdAt: Date.now(),
    memo: els.memoInput.value.trim(),
  };

  if (type === "max") {
    const reps = Number(els.repsInput.value);
    if (!Number.isFinite(reps) || reps < 0) return;
    records.push({ ...base, reps });
  } else {
    const totalReps = Number(els.totalInput.value);
    const practiceMax = Number(els.practiceMaxInput.value);
    if (![totalReps, practiceMax].every(Number.isFinite) || totalReps < 0 || practiceMax < 0) return;
    records.push({ ...base, totalReps, practiceMax });
  }

  records.sort(sortByDate);
  saveRecords();
  els.form.reset();
  els.dateInput.value = todayString();
  els.typeInput.value = "max";
  syncRecordTypeFields();
  render();
}

function resetData() {
  if (!confirm("記録を初期状態に戻しますか？")) return;
  records = createDefaultRecords();
  saveRecords();
  render();
}

function getMember(name) {
  return members.find((member) => member.name === name);
}

function sortByDate(a, b) {
  return a.date.localeCompare(b.date) || normalizeCreatedAt(a, 0) - normalizeCreatedAt(b, 0) || a.name.localeCompare(b.name);
}

function maxRecords() {
  return records.filter((record) => record.type === "max");
}

function trainingRecords() {
  return records.filter((record) => record.type === "training");
}

function performanceRecords() {
  return records
    .map((record, index) => {
      if (record.type === "max") {
        return { id: record.id, order: normalizeCreatedAt(record, index), name: record.name, date: record.date, reps: record.reps, source: "MAX測定" };
      }
      return { id: record.id, order: normalizeCreatedAt(record, index), name: record.name, date: record.date, reps: record.practiceMax, source: "練習MAX" };
    })
    .filter((record) => Number.isFinite(record.reps));
}

function performanceMoments() {
  const momentsByDate = new Map();

  performanceRecords().forEach((record) => {
    if (!momentsByDate.has(record.date)) {
      momentsByDate.set(record.date, {
        date: record.date,
        label: formatChartLabel(record.date),
        bestByMember: new Map(),
      });
    }

    const moment = momentsByDate.get(record.date);
    const current = moment.bestByMember.get(record.name);
    if (!current || record.reps > current.reps || (record.reps === current.reps && record.order > current.order)) {
      moment.bestByMember.set(record.name, record);
    }
  });

  return [...momentsByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((moment) => ({
      date: moment.date,
      label: moment.label,
      records: [...moment.bestByMember.values()],
      order: Date.parse(moment.date),
    }));
}

function trendDatasets(moments) {
  const current = new Map();
  return members.map((member) => ({
    label: member.name,
    color: member.color,
    data: moments.map((moment) => {
      moment.records
        .filter((record) => record.name === member.name)
        .forEach((record) => current.set(member.name, record.reps));
      return current.has(member.name) ? current.get(member.name) : null;
    }),
  }));
}

function formatChartLabel(date) {
  return date.slice(5).replace("-", "/");
}

function latestMaxRecord(name) {
  return maxRecords()
    .filter((record) => record.name === name)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
}

function bestMaxRecord(name) {
  return maxRecords().filter((record) => record.name === name).sort((a, b) => b.reps - a.reps)[0];
}

function baselineFor(member) {
  const first = maxRecords().filter((record) => record.name === member.name).sort(sortByDate)[0];
  if (first) return first.reps;
  return member.initialReps;
}

function trainingTotalFor(name) {
  return trainingRecords()
    .filter((record) => record.name === name)
    .reduce((sum, record) => sum + record.totalReps, 0);
}

function statsFor(member) {
  const latest = latestMaxRecord(member.name);
  const best = bestMaxRecord(member.name);
  const baseline = baselineFor(member);
  const actual = latest?.reps ?? 0;
  const growth = baseline === null || !latest ? 0 : actual - baseline;
  const rate = baseline && latest ? (growth / baseline) * 100 : 0;

  return {
    ...member,
    latest,
    best,
    baseline,
    actual,
    score: actual + member.handicap,
    growth,
    rate,
    trainingTotal: trainingTotalFor(member.name),
  };
}

function allStats() {
  return members.map(statsFor);
}

function rankBy(key) {
  return allStats().sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
}

function scoreRankMap() {
  return rankBy("score").reduce((map, item, index) => {
    map[item.name] = index + 1;
    return map;
  }, {});
}

function formatRate(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function render() {
  renderSummary();
  renderRanking();
  renderMembers();
  renderHistory();
  try {
    renderCharts();
  } catch (error) {
    showChartMessage("グラフ描画でエラーが出ました。ランキングと履歴はそのまま使えます。");
    console.error(error);
  }
}

function renderSummary() {
  const leader = rankBy("score")[0];
  const mostGrowth = rankBy("growth")[0];
  const maxCount = maxRecords().length;
  const trainingTotal = trainingRecords().reduce((sum, record) => sum + record.totalReps, 0);

  els.summaryStrip.innerHTML = [
    ["判定トップ", leader.name, `${leader.score}点`],
    ["最大成長", mostGrowth.name, `${mostGrowth.growth >= 0 ? "+" : ""}${mostGrowth.growth}回`],
    ["MAX記録", `${maxCount}件`, "ランキング対象"],
    ["練習量合計", `${trainingTotal}回`, "練習ログ合計"],
  ]
    .map(
      ([label, value, note]) => `
        <div class="summary-card">
          <span>${label}</span>
          <strong>${value}</strong>
          <span>${note}</span>
        </div>
      `,
    )
    .join("");
}

function renderRanking() {
  const labels = {
    actual: ["実回数", "actual", "回"],
    score: ["判定スコア", "score", "点"],
    growth: ["初回からの伸び", "growth", "回"],
    rate: ["伸び率", "rate", "%"],
  };
  const [title, key, unit] = labels[activeRanking];

  els.rankingList.innerHTML = rankBy(key)
    .map((item, index) => {
      const value = key === "rate" ? formatRate(item.rate) : `${item[key] >= 0 && key === "growth" ? "+" : ""}${item[key]}${unit}`;
      const latestDate = item.latest ? item.latest.date : "MAX未記録";
      return `
        <li class="ranking-item">
          <span class="rank-badge">${index + 1}</span>
          <div>
            <div class="ranking-name">${item.name}</div>
            <div class="ranking-meta">${title} / 最新MAX ${latestDate} / ハンデ ${item.handicap >= 0 ? "+" : ""}${item.handicap}</div>
          </div>
          <strong class="ranking-score">${value}</strong>
        </li>
      `;
    })
    .join("");
}

function renderMembers() {
  const ranks = scoreRankMap();
  els.memberGrid.innerHTML = allStats()
    .map((item) => {
      const best = item.best ? `${item.best.reps}回` : "未記録";
      const latest = item.latest ? `${item.latest.reps}回` : "未記録";
      const growth = item.latest && item.baseline !== null ? `${item.growth >= 0 ? "+" : ""}${item.growth}回` : "未記録";
      return `
        <article class="member-card" style="--member-color: ${item.color}">
          <div class="member-top">
            <div>
              <div class="member-name">${item.name}</div>
              <div class="ranking-meta">ハンデ ${item.handicap >= 0 ? "+" : ""}${item.handicap}</div>
            </div>
            <span class="position-pill">判定 ${ranks[item.name]}位</span>
          </div>
          <div class="metrics">
            <div class="metric"><span class="metric-label">最新MAX</span><strong>${latest}</strong></div>
            <div class="metric"><span class="metric-label">ベストMAX</span><strong>${best}</strong></div>
            <div class="metric"><span class="metric-label">初回から</span><strong>${growth}</strong></div>
            <div class="metric"><span class="metric-label">判定スコア</span><strong>${item.score}</strong></div>
            <div class="metric wide-metric"><span class="metric-label">練習量合計</span><strong>${item.trainingTotal}回</strong></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderHistory() {
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date) || normalizeCreatedAt(b, 0) - normalizeCreatedAt(a, 0));
  els.historyList.innerHTML = sorted
    .map((record) => {
      const member = getMember(record.name);
      const isMax = record.type === "max";
      const badge = isMax ? record.reps : record.totalReps;
      const title = isMax ? `${record.name} / MAX測定 / ${record.date}` : `${record.name} / 練習ログ / ${record.date}`;
      const meta = isMax
        ? `判定スコア ${record.reps + member.handicap}点 / ハンデ ${member.handicap >= 0 ? "+" : ""}${member.handicap}`
        : `本日の総懸垂数 ${record.totalReps}回 / 今日のMAX ${record.practiceMax}回`;
      return `
        <div class="history-item">
          <span class="rank-badge ${isMax ? "max-badge" : "training-badge"}" style="color: ${member.color}">${badge}</span>
          <div>
            <div class="history-name">${escapeHtml(title)}</div>
            <div class="history-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="history-side">
            <div class="history-note">${escapeHtml(record.memo || "メモなし")}</div>
            <div class="history-actions">
              <button type="button" class="text-button" data-action="edit" data-id="${record.id}">修正</button>
              <button type="button" class="text-button danger" data-action="delete" data-id="${record.id}">削除</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function handleHistoryAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const record = records.find((item) => item.id === button.dataset.id);
  if (!record) return;

  if (button.dataset.action === "delete") {
    deleteRecord(record);
    return;
  }

  editRecord(record);
}

function editRecord(record) {
  const date = prompt("日付を修正", record.date);
  if (date === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    alert("日付は YYYY-MM-DD 形式で入力してください。");
    return;
  }

  if (record.type === "max") {
    const reps = prompt(`${record.name}のMAX回数を修正`, record.reps);
    if (reps === null) return;
    const nextReps = Number(reps);
    if (!Number.isFinite(nextReps) || nextReps < 0) {
      alert("MAX回数は0以上の数字で入力してください。");
      return;
    }
    record.reps = nextReps;
  } else {
    const totalReps = prompt(`${record.name}の練習合計回数を修正`, record.totalReps);
    if (totalReps === null) return;
    const practiceMax = prompt("今日のMAX（練習）を修正", record.practiceMax);
    if (practiceMax === null) return;

    const nextTotal = Number(totalReps);
    const nextPracticeMax = Number(practiceMax);
    if (![nextTotal, nextPracticeMax].every(Number.isFinite) || nextTotal < 0 || nextPracticeMax < 0) {
      alert("練習ログは、本日の総懸垂数0以上・今日のMAX0以上で入力してください。");
      return;
    }
    record.totalReps = nextTotal;
    record.practiceMax = nextPracticeMax;
  }

  const memo = prompt("メモを修正", record.memo || "");
  if (memo === null) return;
  record.date = date;
  record.memo = memo.trim();
  records.sort(sortByDate);
  saveRecords();
  render();
}

function deleteRecord(record) {
  if (!confirm(`${record.name} / ${record.date} の記録を削除しますか？`)) return;
  records = records.filter((item) => item.id !== record.id);
  saveRecords();
  render();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function chartOptions(stacked = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#383838", boxWidth: 10, font: { family: "Noto Sans JP", size: 11 } } },
    },
    scales: {
      x: { stacked, ticks: { color: "#707070" }, grid: { color: "rgba(31,31,31,0.06)" } },
      y: { stacked, beginAtZero: true, ticks: { color: "#707070", precision: 0 }, grid: { color: "rgba(31,31,31,0.08)" } },
    },
  };
}

function renderCharts() {
  const stats = allStats();
  const labels = stats.map((item) => item.name);
  const colors = stats.map((item) => item.color);
  const moments = performanceMoments();
  const trendLabels = moments.length ? moments.map((moment) => moment.label) : ["未記録"];
  const trendSeries = moments.length ? trendDatasets(moments) : members.map((member) => ({ label: member.name, color: member.color, data: [null] }));
  const trainingDates = [...new Set(trainingRecords().map((record) => record.date))].sort();
  const labelsForTraining = trainingDates.length ? trainingDates : [todayString()];

  if (typeof Chart === "undefined") {
    renderCanvasFallbacks(stats, labels, colors, trendLabels, trendSeries, labelsForTraining);
    return;
  }

  upsertChart("actualChart", "bar", {
    labels,
    datasets: [{ label: "最新MAX実回数", data: stats.map((item) => item.actual), backgroundColor: colors }],
  });

  upsertChart("scoreChart", "bar", {
    labels,
    datasets: [{ label: "最新MAX + ハンデ", data: stats.map((item) => item.score), backgroundColor: colors }],
  });

  upsertChart("trendChart", "line", {
    labels: trendLabels,
    datasets: trendSeries.map((series) => ({
      label: series.label,
      data: series.data,
      borderColor: series.color,
      backgroundColor: series.color,
      tension: 0,
      spanGaps: true,
    })),
  });

  upsertChart(
    "trainingChart",
    "bar",
    {
      labels: labelsForTraining,
      datasets: members.map((member) => ({
        label: member.name,
        data: labelsForTraining.map((date) =>
          trainingRecords()
            .filter((record) => record.name === member.name && record.date === date)
            .reduce((sum, record) => sum + record.totalReps, 0),
        ),
        backgroundColor: member.color,
      })),
    },
    false,
  );
}

function renderCanvasFallbacks(stats, labels, colors, trendLabels, trendSeries, trainingDates) {
  drawBarCanvas("actualChart", labels, stats.map((item) => item.actual), colors, "最新MAX実回数");
  drawBarCanvas("scoreChart", labels, stats.map((item) => item.score), colors, "最新MAX + ハンデ");
  drawLineCanvas(
    "trendChart",
    trendLabels,
    trendSeries.map((series) => ({ label: series.label, color: series.color, values: series.data })),
    "今のMAX推移",
  );
  drawGroupedBarCanvas(
    "trainingChart",
    trainingDates,
    members.map((member) => ({
      label: member.name,
      color: member.color,
      values: trainingDates.map((date) =>
        trainingRecords()
          .filter((record) => record.name === member.name && record.date === date)
          .reduce((sum, record) => sum + record.totalReps, 0),
      ),
    })),
    "日別の練習量",
  );
}

function setupCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  canvas.style.display = "block";
  const note = canvas.parentElement.querySelector(".chart-message");
  if (note) note.remove();
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, rect.width) * ratio;
  canvas.height = Math.max(240, rect.height) * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  return { canvas, ctx, width: canvas.width / ratio, height: canvas.height / ratio };
}

function drawChartBase(ctx, width, height, title) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1f1f1f";
  ctx.font = "600 13px Noto Sans JP, sans-serif";
  ctx.fillText(title, 16, 24);
  ctx.strokeStyle = "rgba(31,31,31,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(42, 42);
  ctx.lineTo(42, height - 38);
  ctx.lineTo(width - 14, height - 38);
  ctx.stroke();
}

function drawBarCanvas(canvasId, labels, values, colors, title) {
  const { ctx, width, height } = setupCanvas(canvasId);
  drawChartBase(ctx, width, height, title);
  const max = Math.max(1, ...values);
  const chartWidth = width - 70;
  const barWidth = Math.max(20, chartWidth / labels.length - 18);

  labels.forEach((label, index) => {
    const x = 54 + index * (chartWidth / labels.length) + 6;
    const barHeight = ((height - 92) * values[index]) / max;
    const y = height - 39 - barHeight;
    ctx.fillStyle = colors[index];
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#1f1f1f";
    ctx.font = "600 12px Noto Sans JP, sans-serif";
    ctx.fillText(values[index], x + 2, y - 7);
    ctx.fillStyle = "#707070";
    ctx.font = "500 11px Noto Sans JP, sans-serif";
    ctx.fillText(label, x, height - 16);
  });
}

function drawLineCanvas(canvasId, labels, datasets, title) {
  const { ctx, width, height } = setupCanvas(canvasId);
  drawChartBase(ctx, width, height, title);
  const allValues = datasets.flatMap((set) => set.values).filter((value) => value !== null);
  const max = Math.max(1, ...allValues);
  const left = 46;
  const top = 46;
  const bottom = height - 44;
  const chartWidth = width - 74;
  const step = labels.length > 1 ? chartWidth / (labels.length - 1) : chartWidth;

  datasets.forEach((set) => {
    ctx.strokeStyle = set.color;
    ctx.fillStyle = set.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    set.values.forEach((value, index) => {
      if (value === null) return;
      const x = left + index * step;
      const y = bottom - ((bottom - top) * value) / max;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    ctx.stroke();
  });

  labels.forEach((label, index) => {
    const x = left + index * step;
    ctx.fillStyle = "#707070";
    ctx.font = "500 10px Noto Sans JP, sans-serif";
    ctx.fillText(label, Math.min(x, width - 62), height - 16);
  });
}

function drawGroupedBarCanvas(canvasId, labels, datasets, title) {
  const { ctx, width, height } = setupCanvas(canvasId);
  drawChartBase(ctx, width, height, title);
  const max = Math.max(1, ...datasets.flatMap((set) => set.values));
  const chartWidth = width - 70;
  const groupWidth = chartWidth / labels.length;
  const barWidth = Math.max(10, Math.min(26, (groupWidth - 18) / datasets.length));

  labels.forEach((label, index) => {
    const groupX = 54 + index * groupWidth + 6;
    datasets.forEach((set, setIndex) => {
      const barHeight = ((height - 92) * set.values[index]) / max;
      const x = groupX + setIndex * barWidth;
      const y = height - 39 - barHeight;
      ctx.fillStyle = set.color;
      ctx.fillRect(x, y, barWidth, barHeight);
      if (set.values[index] > 0) {
        ctx.fillStyle = "#1f1f1f";
        ctx.font = "500 10px Noto Sans JP, sans-serif";
        ctx.fillText(set.values[index], x, y - 5);
      }
    });
    ctx.fillStyle = "#707070";
    ctx.font = "500 11px Noto Sans JP, sans-serif";
    ctx.fillText(formatChartLabel(label), groupX, height - 16);
  });
}

function showChartMessage(message) {
  document.querySelectorAll(".chart-panel").forEach((panel) => {
    const canvas = panel.querySelector("canvas");
    if (!canvas) return;
    canvas.style.display = "none";
    let note = panel.querySelector(".chart-message");
    if (!note) {
      note = document.createElement("div");
      note.className = "chart-message";
      panel.appendChild(note);
    }
    note.textContent = message;
  });
}

function upsertChart(canvasId, type, data, stacked = false) {
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type,
    data,
    options: chartOptions(stacked),
  });
}
