export const readonlyClientScript = `(() => {
  const state = window.__VIEWER__;
  const els = {
    status: document.getElementById("status"),
    extractor: document.getElementById("extractor"),
    expression: document.getElementById("expression"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    range: document.getElementById("range"),
    rangeValue: document.getElementById("rangeValue"),
    load: document.getElementById("load"),
    live: document.getElementById("live"),
    chart: document.getElementById("chart"),
    chartMessage: document.getElementById("chartMessage"),
    latest: document.getElementById("latest"),
    records: document.getElementById("records"),
    recordsUnit: document.getElementById("recordsUnit")
  };
  let eventSource = null;
  let metadata = null;
  let records = [];
  let evaluatedRows = [];
  let points = [];

  const pageParams = new URLSearchParams(location.search);
  const apiBase = "/api/view/" + encodeURIComponent(state.device) + "/" + encodeURIComponent(state.label);

  function selectedExtractor() {
    return metadata?.extractors.find((item) => item.id === els.extractor.value) ?? null;
  }

  function activeExpression() {
    return els.expression.value.trim();
  }

  function activeUnit() {
    const extractor = selectedExtractor();
    if (extractor && activeExpression() === extractor.expression && extractor.unit) {
      return extractor.unit;
    }
    return "";
  }

  function unitSuffix() {
    const unit = activeUnit();
    return unit ? " " + unit : "";
  }

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

  function updateRangeLabel() {
    const minutes = Number(els.range.value);
    els.rangeValue.textContent = minutes < 60 ? minutes + " min" : (minutes / 60).toFixed(minutes % 60 ? 1 : 0) + " h";
  }

  function applyRangeToInputs() {
    const now = new Date();
    const minutes = Number(els.range.value);
    els.to.value = toLocalInputValue(now);
    els.from.value = toLocalInputValue(new Date(now.getTime() - minutes * 60 * 1000));
    updateRangeLabel();
  }

  function fmt(value) {
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\\.$/, "");
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    return JSON.stringify(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  async function evaluateRecord(record) {
    const expression = activeExpression();
    if (!expression) {
      return { record, value: record.data, point: typeof record.data === "number" ? { t: record.receivedAt, v: record.data } : null };
    }

    const compiled = jsonata(expression);
    const value = await compiled.evaluate(record.data);
    return {
      record,
      value,
      point: typeof value === "number" && Number.isFinite(value) ? { t: record.receivedAt, v: value } : null
    };
  }

  async function evaluateAll() {
    const newestFirst = records.slice().reverse();
    evaluatedRows = [];
    points = [];
    for (const record of newestFirst) {
      const row = await evaluateRecord(record);
      evaluatedRows.push(row);
      if (row.point) points.push(row.point);
    }
    points.reverse();
  }

  function renderLatest(row) {
    if (!row) {
      els.latest.innerHTML = '<div class="message">No records.</div>';
      return;
    }

    if (activeExpression()) {
      const label = selectedExtractor()?.labelText ?? "Temporary expression";
      els.latest.innerHTML = '<div class="metric"><div class="name">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(fmt(row.value) + unitSuffix()) + '</div></div>';
      return;
    }

    const entries = flatten(row.record.data);
    els.latest.innerHTML = entries.map(([name, value]) => (
      '<div class="metric"><div class="name">' + escapeHtml(name) + '</div><div class="value">' + escapeHtml(fmt(value)) + '</div></div>'
    )).join("");
  }

  function renderRecords() {
    const useExpression = Boolean(activeExpression());
    els.recordsUnit.textContent = activeUnit() ? "(" + activeUnit() + ")" : "";
    els.records.innerHTML = evaluatedRows.slice(0, 200).map((row) => {
      const value = useExpression ? fmt(row.value) + unitSuffix() : JSON.stringify(row.record.data, null, 2);
      return "<tr><td>" + escapeHtml(row.record.receivedAt) + '</td><td class="mono">' + escapeHtml(value) + "</td></tr>";
    }).join("");
  }

  function visiblePoints() {
    const from = els.from.value ? fromLocalInputValue(els.from.value).getTime() : -Infinity;
    const to = els.to.value ? fromLocalInputValue(els.to.value).getTime() : Infinity;
    return points.filter((point) => {
      const t = new Date(point.t).getTime();
      return t >= from && t <= to;
    });
  }

  function drawChart(inputPoints = visiblePoints()) {
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

    const pad = { left: 64, right: 18, top: 18, bottom: 38 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    ctx.strokeStyle = "#d8dde6";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    if (!inputPoints.length) {
      els.chartMessage.textContent = "No numeric points for the selected range.";
      return;
    }
    els.chartMessage.textContent = inputPoints.length + " points" + unitSuffix();

    const xs = inputPoints.map((p) => new Date(p.t).getTime());
    const ys = inputPoints.map((p) => p.v);
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
    inputPoints.forEach((point, index) => {
      const x = pad.left + ((new Date(point.t).getTime() - minX) / xSpan) * plotW;
      const y = pad.top + (1 - ((point.v - minY) / ySpan)) * plotH;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function renderAll() {
    renderLatest(evaluatedRows[0]);
    renderRecords();
    drawChart();
  }

  async function recomputeAndRender() {
    await evaluateAll();
    renderAll();
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function historyParams() {
    const params = new URLSearchParams({ token: state.token });
    if (els.from.value) params.set("from", fromLocalInputValue(els.from.value).toISOString());
    if (els.to.value) params.set("to", fromLocalInputValue(els.to.value).toISOString());
    return params;
  }

  async function loadMetadata() {
    metadata = await getJson(apiBase + "/metadata?token=" + encodeURIComponent(state.token));
    els.extractor.innerHTML = '<option value="">temporary/raw</option>' + metadata.extractors.map((item) => (
      '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.labelText + (item.unit ? " (" + item.unit + ")" : "")) + "</option>"
    )).join("");

    const requestedExtractor = pageParams.get("extractor");
    const requestedExpression = pageParams.get("expression");
    if (requestedExtractor && metadata.extractors.some((item) => item.id === requestedExtractor)) {
      els.extractor.value = requestedExtractor;
      els.expression.value = selectedExtractor()?.expression ?? "";
    } else if (requestedExpression) {
      els.expression.value = requestedExpression;
    }
  }

  async function loadHistory() {
    const history = await getJson(apiBase + "/history?" + historyParams().toString());
    records = history.records ?? [];
    await recomputeAndRender();
  }

  function updateUrlState() {
    const params = new URLSearchParams(location.search);
    params.set("token", state.token);
    if (els.extractor.value) params.set("extractor", els.extractor.value);
    else params.delete("extractor");

    const extractor = selectedExtractor();
    if (activeExpression() && (!extractor || activeExpression() !== extractor.expression)) {
      params.set("expression", activeExpression());
    } else {
      params.delete("expression");
    }
    history.replaceState(null, "", location.pathname + "?" + params.toString());
  }

  function connectRealtime() {
    if (eventSource) eventSource.close();
    setStatus("connecting live", "");
    eventSource = new EventSource(apiBase + "/realtime?token=" + encodeURIComponent(state.token));
    eventSource.onopen = () => setStatus("live connected", "connected");
    eventSource.onerror = () => setStatus("live disconnected", "error");
    eventSource.onmessage = async (event) => {
      const record = JSON.parse(event.data);
      records.push(record);
      records = records.slice(-10000);
      applyRangeToInputs();
      try {
        await recomputeAndRender();
      } catch (error) {
        showError(error);
      }
    };
  }

  async function onExtractorChange() {
    const extractor = selectedExtractor();
    els.expression.value = extractor?.expression ?? "";
    updateUrlState();
    await recomputeAndRender();
  }

  let expressionTimer = null;
  function onExpressionInput() {
    els.extractor.value = "";
    updateUrlState();
    clearTimeout(expressionTimer);
    expressionTimer = setTimeout(() => {
      recomputeAndRender().catch(showError);
    }, 180);
  }

  async function init() {
    applyRangeToInputs();
    els.range.addEventListener("input", () => {
      applyRangeToInputs();
      drawChart();
    });
    els.range.addEventListener("change", () => loadHistory().catch(showError));
    els.from.addEventListener("change", drawChart);
    els.to.addEventListener("change", drawChart);
    els.extractor.addEventListener("change", () => onExtractorChange().catch(showError));
    els.expression.addEventListener("input", onExpressionInput);
    els.load.addEventListener("click", () => loadHistory().catch(showError));
    els.live.addEventListener("click", connectRealtime);
    await loadMetadata();
    await loadHistory();
    connectRealtime();
  }

  function showError(error) {
    els.chartMessage.innerHTML = '<span class="error-text">' + escapeHtml(error.message) + "</span>";
  }

  init().catch((error) => {
    setStatus("error", "error");
    showError(error);
  });
})();`;
