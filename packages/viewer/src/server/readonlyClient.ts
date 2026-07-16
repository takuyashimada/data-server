export const readonlyClientScript = `(() => {
  const state = window.__VIEWER__;
  const els = {
    status: document.getElementById("status"),
    extractor: document.getElementById("extractor"),
    expression: document.getElementById("expression"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    load: document.getElementById("load"),
    live: document.getElementById("live"),
    chart: document.getElementById("chart"),
    chartMessage: document.getElementById("chartMessage"),
    latest: document.getElementById("latest"),
    records: document.getElementById("records"),
    recordsUnit: document.getElementById("recordsUnit"),
    rangeTrack: document.getElementById("rangeTrack"),
    rangeSelection: document.getElementById("rangeSelection"),
    rangeLeft: document.getElementById("rangeLeft"),
    rangeRight: document.getElementById("rangeRight"),
    rangeStartLabel: document.getElementById("rangeStartLabel"),
    rangeEndLabel: document.getElementById("rangeEndLabel"),
    rangeWindowLabel: document.getElementById("rangeWindowLabel"),
    rangeModeLabel: document.getElementById("rangeModeLabel")
  };
  let eventSource = null;
  let metadata = null;
  let records = [];
  let evaluatedRows = [];
  let points = [];
  let viewStartMs = null;
  let viewEndMs = null;
  let dataStartMs = null;
  let dataEndMs = null;
  let liveFollow = true;
  const defaultWindowMs = 60 * 60 * 1000;
  const minWindowMs = 1000;

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

  function recordTime(record) {
    return new Date(record.receivedAt).getTime();
  }

  function fmt(value) {
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\\.$/, "");
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    return JSON.stringify(value);
  }

  function formatDateTime(ms) {
    if (!Number.isFinite(ms)) return "--";
    const date = new Date(ms);
    return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatAxisTime(ms, span) {
    const date = new Date(ms);
    if (span > 24 * 60 * 60 * 1000) {
      return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    if (span > 60 * 60 * 1000) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + " s";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min";
    const hours = minutes / 60;
    if (hours < 24) return hours.toFixed(minutes % 60 ? 1 : 0) + " h";
    const days = hours / 24;
    return days.toFixed(hours % 24 ? 1 : 0) + " d";
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
    evaluatedRows = [];
    points = [];
    for (let i = records.length - 1; i >= 0; i--) {
      const row = await evaluateRecord(records[i]);
      evaluatedRows.push(row);
      if (row.point) points.push(row.point);
    }
    points.reverse();
  }

  function updateDataBounds() {
    const times = records.map(recordTime).filter(Number.isFinite);
    if (!times.length) {
      dataStartMs = null;
      dataEndMs = null;
      return;
    }
    dataStartMs = Math.min(...times);
    dataEndMs = Math.max(...times);
  }

  function clampView(start, end) {
    if (dataStartMs == null || dataEndMs == null) {
      return [start, end];
    }
    let width = Math.max(minWindowMs, end - start);
    const dataWidth = Math.max(minWindowMs, dataEndMs - dataStartMs);
    width = Math.min(width, dataWidth);
    if (start < dataStartMs) {
      start = dataStartMs;
      end = start + width;
    }
    if (end > dataEndMs) {
      end = dataEndMs;
      start = end - width;
    }
    if (start < dataStartMs) start = dataStartMs;
    return [start, end];
  }

  function setViewRange(start, end, options = {}) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end < start) [start, end] = [end, start];
    if (end - start < minWindowMs) end = start + minWindowMs;
    [viewStartMs, viewEndMs] = clampView(start, end);
    if (options.follow !== undefined) liveFollow = options.follow;
    if (options.syncInputs !== false) {
      els.from.value = toLocalInputValue(new Date(viewStartMs));
      els.to.value = toLocalInputValue(new Date(viewEndMs));
    }
    updateRangeEditor();
    drawChart();
  }

  function ensureInitialView() {
    updateDataBounds();
    const fallbackEnd = Date.now();
    const end = dataEndMs ?? fallbackEnd;
    const start = Math.max(dataStartMs ?? (end - defaultWindowMs), end - defaultWindowMs);
    setViewRange(start, end, { follow: true });
  }

  function visiblePoints() {
    if (viewStartMs == null || viewEndMs == null) return points;
    return points.filter((point) => {
      const t = new Date(point.t).getTime();
      return t >= viewStartMs && t <= viewEndMs;
    });
  }

  function visibleRows() {
    if (viewStartMs == null || viewEndMs == null) return evaluatedRows;
    return evaluatedRows.filter((row) => {
      const t = recordTime(row.record);
      return t >= viewStartMs && t <= viewEndMs;
    });
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
    els.records.innerHTML = visibleRows().slice(0, 200).map((row) => {
      const value = useExpression ? fmt(row.value) + unitSuffix() : JSON.stringify(row.record.data, null, 2);
      return "<tr><td>" + escapeHtml(row.record.receivedAt) + '</td><td class="mono">' + escapeHtml(value) + "</td></tr>";
    }).join("");
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

    const pad = { left: 64, right: 18, top: 18, bottom: 44 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    ctx.strokeStyle = "#d8dde6";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    const minX = viewStartMs ?? (inputPoints.length ? Math.min(...inputPoints.map((p) => new Date(p.t).getTime())) : Date.now() - defaultWindowMs);
    const maxX = viewEndMs ?? (inputPoints.length ? Math.max(...inputPoints.map((p) => new Date(p.t).getTime())) : Date.now());
    const xSpan = maxX - minX || 1;

    ctx.fillStyle = "#687386";
    ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 4; i++) {
      const x = pad.left + plotW * i / 4;
      const value = minX + xSpan * i / 4;
      ctx.strokeStyle = "#eef1f5";
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillText(formatAxisTime(value, xSpan), x, pad.top + plotH + 10);
    }

    if (!inputPoints.length) {
      els.chartMessage.textContent = "No numeric points for the selected range.";
      updateRangeEditor();
      return;
    }
    els.chartMessage.textContent = inputPoints.length + " points" + unitSuffix();

    const ys = inputPoints.map((p) => p.v);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    const ySpan = maxY - minY || 1;

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
      ctx.fillStyle = "#687386";
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
    updateRangeEditor();
  }

  function updateRangeEditor() {
    if (dataStartMs == null || dataEndMs == null || viewStartMs == null || viewEndMs == null) {
      els.rangeStartLabel.textContent = "--";
      els.rangeEndLabel.textContent = "--";
      els.rangeWindowLabel.textContent = "--";
      els.rangeModeLabel.textContent = liveFollow ? "live follow" : "manual";
      els.rangeSelection.style.left = "0%";
      els.rangeSelection.style.width = "100%";
      return;
    }

    const span = Math.max(1, dataEndMs - dataStartMs);
    const left = Math.max(0, Math.min(100, ((viewStartMs - dataStartMs) / span) * 100));
    const right = Math.max(0, Math.min(100, ((viewEndMs - dataStartMs) / span) * 100));
    els.rangeSelection.style.left = left + "%";
    els.rangeSelection.style.width = Math.max(0.5, right - left) + "%";
    els.rangeStartLabel.textContent = formatDateTime(dataStartMs);
    els.rangeEndLabel.textContent = formatDateTime(dataEndMs);
    els.rangeWindowLabel.textContent = formatDateTime(viewStartMs) + " - " + formatDateTime(viewEndMs) + " (" + formatDuration(viewEndMs - viewStartMs) + ")";
    els.rangeModeLabel.textContent = liveFollow ? "live follow" : "manual";
  }

  function renderAll() {
    renderLatest(evaluatedRows[0]);
    renderRecords();
    drawChart();
  }

  async function recomputeAndRender() {
    await evaluateAll();
    updateDataBounds();
    if (viewStartMs == null || viewEndMs == null) ensureInitialView();
    else updateRangeEditor();
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

  async function loadHistory(options = {}) {
    const history = await getJson(apiBase + "/history?" + historyParams().toString());
    records = history.records ?? [];
    await evaluateAll();
    updateDataBounds();
    if (options.keepView && viewStartMs != null && viewEndMs != null) {
      setViewRange(viewStartMs, viewEndMs, { follow: liveFollow });
    } else {
      ensureInitialView();
    }
    renderAll();
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
      const oldEnd = dataEndMs;
      records.push(record);
      records = records.slice(-10000);
      try {
        const row = await evaluateRecord(record);
        evaluatedRows.unshift(row);
        evaluatedRows = evaluatedRows.slice(0, 10000);
        if (row.point) {
          points.push(row.point);
          points = points.slice(-10000);
        }
        updateDataBounds();
        if (liveFollow || (oldEnd != null && viewEndMs != null && Math.abs(viewEndMs - oldEnd) < 2000)) {
          const width = viewStartMs != null && viewEndMs != null ? viewEndMs - viewStartMs : defaultWindowMs;
          setViewRange((dataEndMs ?? Date.now()) - width, dataEndMs ?? Date.now(), { follow: true });
          renderLatest(evaluatedRows[0]);
          renderRecords();
        } else {
          updateRangeEditor();
          renderAll();
        }
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

  function installRangeEditor() {
    let drag = null;

    function eventToMs(event) {
      const rect = els.rangeTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      return (dataStartMs ?? 0) + ratio * Math.max(1, (dataEndMs ?? 1) - (dataStartMs ?? 0));
    }

    function begin(event, mode) {
      if (dataStartMs == null || dataEndMs == null || viewStartMs == null || viewEndMs == null) return;
      event.preventDefault();
      drag = {
        mode,
        pointerId: event.pointerId,
        startX: event.clientX,
        initialStart: viewStartMs,
        initialEnd: viewEndMs,
        initialMs: eventToMs(event)
      };
      els.rangeSelection.classList.add("dragging");
      els.rangeTrack.setPointerCapture(event.pointerId);
    }

    els.rangeLeft.addEventListener("pointerdown", (event) => begin(event, "left"));
    els.rangeRight.addEventListener("pointerdown", (event) => begin(event, "right"));
    els.rangeSelection.addEventListener("pointerdown", (event) => {
      if (event.target === els.rangeLeft || event.target === els.rangeRight) return;
      begin(event, "move");
    });
    els.rangeTrack.addEventListener("pointerdown", (event) => {
      if (event.target !== els.rangeTrack) return;
      const center = eventToMs(event);
      const width = viewEndMs != null && viewStartMs != null ? viewEndMs - viewStartMs : defaultWindowMs;
      setViewRange(center - width / 2, center + width / 2, { follow: false });
      begin(event, "move");
    });
    els.rangeTrack.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const currentMs = eventToMs(event);
      const delta = currentMs - drag.initialMs;
      if (drag.mode === "left") {
        setViewRange(Math.min(currentMs, drag.initialEnd - minWindowMs), drag.initialEnd, { follow: false });
      } else if (drag.mode === "right") {
        setViewRange(drag.initialStart, Math.max(currentMs, drag.initialStart + minWindowMs), { follow: false });
      } else {
        setViewRange(drag.initialStart + delta, drag.initialEnd + delta, { follow: false });
      }
      renderRecords();
    });
    els.rangeTrack.addEventListener("pointerup", (event) => {
      if (!drag) return;
      els.rangeSelection.classList.remove("dragging");
      els.rangeTrack.releasePointerCapture(event.pointerId);
      drag = null;
    });
    els.rangeTrack.addEventListener("pointercancel", () => {
      els.rangeSelection.classList.remove("dragging");
      drag = null;
    });
  }

  async function init() {
    const now = new Date();
    els.to.value = toLocalInputValue(now);
    els.from.value = toLocalInputValue(new Date(now.getTime() - defaultWindowMs));
    els.from.addEventListener("change", () => {
      liveFollow = false;
      setViewRange(fromLocalInputValue(els.from.value).getTime(), fromLocalInputValue(els.to.value).getTime(), { follow: false });
      renderRecords();
    });
    els.to.addEventListener("change", () => {
      liveFollow = false;
      setViewRange(fromLocalInputValue(els.from.value).getTime(), fromLocalInputValue(els.to.value).getTime(), { follow: false });
      renderRecords();
    });
    els.extractor.addEventListener("change", () => onExtractorChange().catch(showError));
    els.expression.addEventListener("input", onExpressionInput);
    els.load.addEventListener("click", () => loadHistory({ keepView: true }).catch(showError));
    els.live.addEventListener("click", () => {
      liveFollow = true;
      if (dataEndMs != null && viewStartMs != null && viewEndMs != null) {
        const width = viewEndMs - viewStartMs;
        setViewRange(dataEndMs - width, dataEndMs, { follow: true });
      }
      connectRealtime();
    });
    installRangeEditor();
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
