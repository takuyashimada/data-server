export const readonlyClientScript = `(() => {
  const state = window.__VIEWER__;
  const els = {
    status: document.getElementById("status"),
    extractor: document.getElementById("extractor"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    load: document.getElementById("load"),
    live: document.getElementById("live"),
    chart: document.getElementById("chart"),
    chartMessage: document.getElementById("chartMessage"),
    latest: document.getElementById("latest"),
    records: document.getElementById("records")
  };
  let eventSource = null;
  let records = [];

  const apiBase = "/api/view/" + encodeURIComponent(state.device) + "/" + encodeURIComponent(state.label);
  const tokenQuery = "token=" + encodeURIComponent(state.token);

  function setStatus(text, kind) {
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.querySelector("span:last-child").textContent = text;
  }

  function toLocalInputValue(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function fromLocalInputValue(value) {
    return new Date(value);
  }

  function fmt(value) {
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\\.$/, "");
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  function flatten(value, prefix = "") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [[prefix || "$", value]];
    }
    const rows = [];
    for (const [key, child] of Object.entries(value)) {
      const name = prefix ? prefix + "." + key : key;
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        rows.push(...flatten(child, name));
      } else {
        rows.push([name, child]);
      }
    }
    return rows;
  }

  function renderLatest(record) {
    const entries = flatten(record.data);
    els.latest.innerHTML = entries.map(([name, value]) => (
      '<div class="metric"><div class="name">' + escapeHtml(name) + '</div><div class="value">' + escapeHtml(fmt(value)) + '</div></div>'
    )).join("");
  }

  function renderRecords() {
    els.records.innerHTML = records.slice(0, 200).map((record) => (
      "<tr><td>" + escapeHtml(record.receivedAt) + '</td><td class="mono">' + escapeHtml(JSON.stringify(record.data, null, 2)) + "</td></tr>"
    )).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function drawChart(points) {
    const canvas = els.chart;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(320, Math.floor(rect.width * scale));
    canvas.height = Math.max(220, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const width = canvas.width / scale;
    const height = canvas.height / scale;
    ctx.clearRect(0, 0, width, height);

    const pad = { left: 58, right: 16, top: 18, bottom: 36 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    ctx.strokeStyle = "#d8dde6";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    if (!points.length) {
      els.chartMessage.textContent = "No numeric points for the selected range.";
      return;
    }
    els.chartMessage.textContent = points.length + " points";

    const xs = points.map((p) => new Date(p.t).getTime());
    const ys = points.map((p) => p.v);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    const xSpan = maxX - minX || 1;
    const ySpan = maxY - minY || 1;

    ctx.fillStyle = "#687386";
    ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + plotH * i / 4;
      const value = maxY - ySpan * i / 4;
      ctx.strokeStyle = "#eef1f5";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(fmt(value), pad.left - 8, y);
    }

    ctx.strokeStyle = "#0f766e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = pad.left + ((new Date(point.t).getTime() - minX) / xSpan) * plotW;
      const y = pad.top + (1 - ((point.v - minY) / ySpan)) * plotH;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function loadMetadata() {
    const metadata = await getJson(apiBase + "/metadata?" + tokenQuery);
    els.extractor.innerHTML = '<option value="">raw records</option>' + metadata.extractors.map((item) => (
      '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.labelText + (item.unit ? " (" + item.unit + ")" : "")) + "</option>"
    )).join("");
  }

  async function loadHistory() {
    const params = new URLSearchParams({ token: state.token });
    if (els.from.value) params.set("from", fromLocalInputValue(els.from.value).toISOString());
    if (els.to.value) params.set("to", fromLocalInputValue(els.to.value).toISOString());
    if (els.extractor.value) params.set("extractor", els.extractor.value);
    const history = await getJson(apiBase + "/history?" + params.toString());

    if (history.points) {
      drawChart(history.points);
      return;
    }

    records = history.records.slice().reverse().concat(records).slice(0, 200);
    renderRecords();
    const numericPoints = history.records
      .filter((record) => typeof record.data === "number")
      .map((record) => ({ t: record.receivedAt, v: record.data }));
    drawChart(numericPoints);
  }

  function connectRealtime() {
    if (eventSource) eventSource.close();
    setStatus("connecting live", "");
    eventSource = new EventSource(apiBase + "/realtime?" + tokenQuery);
    eventSource.onopen = () => setStatus("live connected", "connected");
    eventSource.onerror = () => setStatus("live disconnected", "error");
    eventSource.onmessage = (event) => {
      const record = JSON.parse(event.data);
      records.unshift(record);
      records = records.slice(0, 200);
      renderLatest(record);
      renderRecords();
    };
  }

  async function init() {
    const now = new Date();
    els.to.value = toLocalInputValue(now);
    els.from.value = toLocalInputValue(new Date(now.getTime() - 60 * 60 * 1000));
    els.load.addEventListener("click", () => loadHistory().catch((error) => {
      els.chartMessage.innerHTML = '<span class="error-text">' + escapeHtml(error.message) + "</span>";
    }));
    els.live.addEventListener("click", connectRealtime);
    await loadMetadata();
    await loadHistory();
    connectRealtime();
  }

  init().catch((error) => {
    setStatus("error", "error");
    els.chartMessage.innerHTML = '<span class="error-text">' + escapeHtml(error.message) + "</span>";
  });
})();`;
