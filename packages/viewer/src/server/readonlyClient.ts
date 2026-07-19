export const readonlyClientScript = `(() => {
  const state = window.__VIEWER__;
  const els = {
    status: document.getElementById("status"),
    extractor: document.getElementById("extractor"),
    expression: document.getElementById("expression"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    bandsEnabled: document.getElementById("bandsEnabled"),
    bandConstants: document.getElementById("bandConstants"),
    bandIncludeRaw: document.getElementById("bandIncludeRaw"),
    load: document.getElementById("load"),
    live: document.getElementById("live"),
    chart: document.getElementById("chart"),
    chartMessage: document.getElementById("chartMessage"),
    latest: document.getElementById("latest"),
    records: document.getElementById("records"),
    recordsHead: document.getElementById("recordsHead"),
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
  let seriesPoints = [];
  let currentBaseSeries = [];
  let currentDisplaySeries = [];
  let bandFilterStates = [];
  const hiddenSeriesKeys = new Set();
  let viewStartMs = null;
  let viewEndMs = null;
  let dataStartMs = null;
  let dataEndMs = null;
  let liveFollow = true;

  const defaultWindowMs = 60 * 60 * 1000;
  const minWindowMs = 1000;
  const colors = ["#0f766e", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#15803d", "#a16207", "#0e7490"];

  const pageParams = new URLSearchParams(location.search);
  const apiBase = "/api/view/" + encodeURIComponent(state.device) + "/" + encodeURIComponent(state.label);

  function selectedExtractors() {
    const ids = Array.from(els.extractor.selectedOptions).map((option) => option.value).filter(Boolean);
    return ids.map((id) => metadata?.extractors.find((item) => item.id === id)).filter(Boolean);
  }

  function activeExpressions() {
    return els.expression.value
      .split("\\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function activeBaseSeries() {
    const configured = selectedExtractors().map((extractor, index) => ({
      key: "extractor:" + extractor.id,
      label: extractor.labelText,
      expression: extractor.expression,
      unit: extractor.unit ?? "",
      color: colors[index % colors.length]
    }));

    const expressions = activeExpressions();
    const temporary = expressions
      .filter((expression) => !configured.some((series) => series.expression === expression))
      .map((expression, index) => ({
        key: "expression:" + index + ":" + expression,
        label: "Expression " + (index + 1),
        expression,
        unit: "",
        color: colors[(configured.length + index) % colors.length]
      }));

    return configured.concat(temporary);
  }

  function parseDurationSeconds(value) {
    const match = String(value).trim().match(/^(\\d+(?:\\.\\d+)?)(ms|s|m|h)?$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = (match[2] ?? "s").toLowerCase();
    if (unit === "ms") return amount / 1000;
    if (unit === "m") return amount * 60;
    if (unit === "h") return amount * 3600;
    return amount;
  }

  function formatDurationSeconds(seconds) {
    if (seconds < 1) return Math.round(seconds * 1000) + "ms";
    if (seconds < 60) return seconds + "s";
    if (seconds < 3600) return seconds / 60 + "m";
    return seconds / 3600 + "h";
  }

  function activeBandConstants() {
    if (!els.bandsEnabled.checked) return [];
    return Array.from(new Set(
      els.bandConstants.value
        .split(/[\\s,]+/)
        .map(parseDurationSeconds)
        .filter((value) => value !== null)
    )).sort((a, b) => a - b);
  }

  function bandLabel(index, constants) {
    if (!constants.length) return "raw";
    if (index === 0) return "< " + formatDurationSeconds(constants[0]);
    if (index === constants.length) return "> " + formatDurationSeconds(constants[index - 1]);
    return formatDurationSeconds(constants[index - 1]) + " - " + formatDurationSeconds(constants[index]);
  }

  function activeDisplaySeries(baseSeries = activeBaseSeries()) {
    const constants = activeBandConstants();
    if (!els.bandsEnabled.checked || !constants.length) {
      return baseSeries.map((series, index) => ({
        ...series,
        mode: "raw",
        sourceIndex: index,
        color: colors[index % colors.length]
      }));
    }

    const display = [];
    baseSeries.forEach((series, sourceIndex) => {
      if (els.bandIncludeRaw.checked) {
        display.push({
          ...series,
          key: series.key + ":raw",
          label: series.label + " raw",
          mode: "raw",
          sourceIndex,
          color: colors[display.length % colors.length]
        });
      }
      for (let bandIndex = 0; bandIndex <= constants.length; bandIndex++) {
        display.push({
          ...series,
          key: series.key + ":band:" + bandIndex,
          label: series.label + " " + bandLabel(bandIndex, constants),
          mode: "band",
          sourceIndex,
          bandIndex,
          color: colors[display.length % colors.length]
        });
      }
    });
    return display;
  }

  function unitSuffix(unit) {
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

  function hasFixedTo() {
    return Boolean(els.to.value);
  }

  function canLiveFollow() {
    return !hasFixedTo();
  }

  function recordTime(record) {
    return new Date(record.measuredAt ?? record.receivedAt).getTime();
  }

  function recordTimeText(record) {
    return record.measuredAt ?? record.receivedAt;
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

  function pruneHiddenSeriesKeys(series) {
    const keys = new Set(series.map((item) => item.key));
    Array.from(hiddenSeriesKeys).forEach((key) => {
      if (!keys.has(key)) hiddenSeriesKeys.delete(key);
    });
  }

  function renderLegend(inputSeries) {
    if (!inputSeries.length) return "";
    return '<div class="legend">' + inputSeries.map((item) => {
      const hidden = hiddenSeriesKeys.has(item.series.key);
      return '<button type="button" class="legend-item' + (hidden ? ' disabled' : '') + '" data-series-key="' + escapeHtml(item.series.key) + '" title="' + escapeHtml(hidden ? "show " + item.series.label : "hide " + item.series.label) + '"><span class="swatch" style="background:' + escapeHtml(item.series.color) + '"></span><span>' + escapeHtml(item.series.label + unitSuffix(item.series.unit)) + '</span></button>';
    }).join("") + "</div>";
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

  function createBandFilterStates(baseSeries = currentBaseSeries) {
    const constants = activeBandConstants();
    return baseSeries.map(() => constants.map((timeConstantSeconds) => ({
      timeConstantSeconds,
      value: undefined,
      previousTimeMs: undefined
    })));
  }

  function updateLowPass(state, input, timeMs) {
    if (!Number.isFinite(input)) return null;
    if (state.value === undefined || state.previousTimeMs === undefined) {
      state.value = input;
      state.previousTimeMs = timeMs;
      return input;
    }
    const dt = Math.max(0, (timeMs - state.previousTimeMs) / 1000);
    const alpha = 1 - Math.exp(-dt / state.timeConstantSeconds);
    state.value += alpha * (input - state.value);
    state.previousTimeMs = timeMs;
    return state.value;
  }

  function displayValuesFromBase(baseValues, timeMs, displaySeries = currentDisplaySeries) {
    const lowPassValues = bandFilterStates.map((states, sourceIndex) => {
      const input = baseValues[sourceIndex];
      return states.map((state) => updateLowPass(state, input, timeMs));
    });

    return displaySeries.map((series) => {
      const raw = baseValues[series.sourceIndex];
      if (series.mode === "raw") return raw;
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;

      const values = lowPassValues[series.sourceIndex] ?? [];
      if (!values.length || values.some((value) => value === null)) return undefined;
      if (series.bandIndex === 0) return raw - values[0];
      if (series.bandIndex === values.length) return values[values.length - 1];
      return values[series.bandIndex - 1] - values[series.bandIndex];
    });
  }

  async function evaluateBaseRecord(record, series = currentBaseSeries) {
    if (!series.length) {
      return [];
    }

    const values = [];
    for (const item of series) {
      const compiled = jsonata(item.expression);
      const value = await compiled.evaluate(record.data);
      values.push(value);
    }

    return values;
  }

  async function evaluateAll() {
    currentBaseSeries = activeBaseSeries();
    currentDisplaySeries = activeDisplaySeries(currentBaseSeries);
    pruneHiddenSeriesKeys(currentDisplaySeries);
    bandFilterStates = createBandFilterStates(currentBaseSeries);
    evaluatedRows = [];
    seriesPoints = currentDisplaySeries.map((item) => ({ series: item, points: [] }));

    const chronologicalRows = [];
    for (const record of records) {
      const baseValues = await evaluateBaseRecord(record, currentBaseSeries);
      const values = displayValuesFromBase(baseValues, recordTime(record), currentDisplaySeries);
      const pointValues = values.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
      const row = { record, values, pointValues };
      chronologicalRows.push(row);
      row.pointValues.forEach((value, index) => {
        if (value !== null) {
          seriesPoints[index].points.push({ t: recordTime(record), v: value });
        }
      });
    }
    evaluatedRows = chronologicalRows.reverse();
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
    updateRangeEditor();
    drawChart();
  }

  function ensureInitialView() {
    updateDataBounds();
    const fallbackEnd = Date.now();
    const end = dataEndMs ?? fallbackEnd;
    const start = Math.max(dataStartMs ?? (end - defaultWindowMs), end - defaultWindowMs);
    setViewRange(start, end, { follow: canLiveFollow() });
  }

  function visibleSeriesPoints() {
    if (viewStartMs == null || viewEndMs == null) return seriesPoints;
    return seriesPoints.map((item) => ({
      series: item.series,
      points: item.points.filter((point) => {
        const t = new Date(point.t).getTime();
        return t >= viewStartMs && t <= viewEndMs;
      })
    }));
  }

  function visibleRows() {
    if (viewStartMs == null || viewEndMs == null) return evaluatedRows;
    return evaluatedRows.filter((row) => {
      const t = recordTime(row.record);
      return t >= viewStartMs && t <= viewEndMs;
    });
  }

  function renderLatest(row) {
    const series = currentDisplaySeries;
    if (!row) {
      els.latest.innerHTML = '<div class="message">No records.</div>';
      return;
    }

    if (series.length) {
      els.latest.innerHTML = series.map((item, index) => {
        const value = row.values[index];
        return '<div class="metric"><div class="name"><span class="swatch" style="background:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.label) + '</div><div class="value">' + escapeHtml(fmt(value) + unitSuffix(item.unit)) + '</div></div>';
      }).join("");
      return;
    }

    const entries = flatten(row.record.data);
    els.latest.innerHTML = entries.map(([name, value]) => (
      '<div class="metric"><div class="name">' + escapeHtml(name) + '</div><div class="value">' + escapeHtml(fmt(value)) + '</div></div>'
    )).join("");
  }

  function renderRecords() {
    const series = currentDisplaySeries;
    const unitLabels = Array.from(new Set(series.map((item) => item.unit).filter(Boolean)));
    els.recordsUnit.textContent = unitLabels.length === 1 ? "(" + unitLabels[0] + ")" : "";

    if (!series.length) {
      els.recordsHead.innerHTML = '<tr><th style="width: 220px;">time</th><th>data</th></tr>';
      els.records.innerHTML = visibleRows().slice(0, 200).map((row) => (
        "<tr><td>" + escapeHtml(recordTimeText(row.record)) + '</td><td class="mono">' + escapeHtml(JSON.stringify(row.record.data, null, 2)) + "</td></tr>"
      )).join("");
      return;
    }

    els.recordsHead.innerHTML = '<tr><th style="width: 220px;">time</th>' + series.map((item) => (
      '<th><span class="swatch" style="background:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.label + unitSuffix(item.unit)) + '</th>'
    )).join("") + '</tr>';

    els.records.innerHTML = visibleRows().slice(0, 200).map((row) => (
      "<tr><td>" + escapeHtml(recordTimeText(row.record)) + "</td>" + series.map((_item, index) => (
        '<td class="mono">' + escapeHtml(fmt(row.values[index])) + "</td>"
      )).join("") + "</tr>"
    )).join("");
  }

  function drawChart(inputSeries = visibleSeriesPoints()) {
    const shownSeries = inputSeries.filter((item) => !hiddenSeriesKeys.has(item.series.key));
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

    const allPoints = shownSeries.flatMap((item) => item.points);
    const minX = viewStartMs ?? (allPoints.length ? Math.min(...allPoints.map((p) => new Date(p.t).getTime())) : Date.now() - defaultWindowMs);
    const maxX = viewEndMs ?? (allPoints.length ? Math.max(...allPoints.map((p) => new Date(p.t).getTime())) : Date.now());
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

    if (!allPoints.length) {
      const hiddenCount = inputSeries.filter((item) => hiddenSeriesKeys.has(item.series.key)).length;
      els.chartMessage.innerHTML = escapeHtml("No numeric points for the selected range" + (hiddenCount ? " (" + hiddenCount + " hidden)" : "") + ".") + renderLegend(inputSeries);
      updateRangeEditor();
      return;
    }

    const ys = allPoints.map((p) => p.v);
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

    shownSeries.forEach((item) => {
      if (!item.points.length) return;
      ctx.strokeStyle = item.series.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      item.points.forEach((point, index) => {
        const x = pad.left + ((new Date(point.t).getTime() - minX) / xSpan) * plotW;
        const y = pad.top + (1 - ((point.v - minY) / ySpan)) * plotH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    const unitLabels = Array.from(new Set(shownSeries.map((item) => item.series.unit).filter(Boolean)));
    const totalPoints = allPoints.length;
    const seriesLabel = shownSeries.filter((item) => item.points.length).length + " series";
    const hiddenCount = inputSeries.length - shownSeries.length;
    els.chartMessage.innerHTML = escapeHtml(totalPoints + " points / " + seriesLabel + (hiddenCount ? " / " + hiddenCount + " hidden" : "") + (unitLabels.length === 1 ? " " + unitLabels[0] : "")) + renderLegend(inputSeries);
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

  function requestedExtractorIds() {
    const values = pageParams.getAll("extractor").flatMap((value) => value.split(","));
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  async function loadMetadata() {
    metadata = await getJson(apiBase + "/metadata?token=" + encodeURIComponent(state.token));
    els.extractor.innerHTML = metadata.extractors.map((item) => (
      '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.labelText + (item.unit ? " (" + item.unit + ")" : "")) + "</option>"
    )).join("");

    const ids = requestedExtractorIds();
    if (ids.length) {
      Array.from(els.extractor.options).forEach((option) => {
        option.selected = ids.includes(option.value);
      });
    }

    const requestedExpressions = pageParams.getAll("expression").flatMap((value) => value.split("\\n"));
    if (requestedExpressions.length) {
      els.expression.value = requestedExpressions.map((value) => value.trim()).filter(Boolean).join("\\n");
    }

    if (pageParams.get("bands") === "1") {
      els.bandsEnabled.checked = true;
    }
    const requestedBandConstants = pageParams.get("bandConstants");
    if (requestedBandConstants) {
      els.bandConstants.value = requestedBandConstants;
    }
    if (pageParams.get("bandRaw") === "1") {
      els.bandIncludeRaw.checked = true;
    }
  }

  async function loadHistory(options = {}) {
    const history = await getJson(apiBase + "/history?" + historyParams().toString());
    records = history.records ?? [];
    await evaluateAll();
    updateDataBounds();
    const follow = canLiveFollow() && (options.keepView ? liveFollow : true);
    liveFollow = follow;
    if (options.keepView && viewStartMs != null && viewEndMs != null) {
      setViewRange(viewStartMs, viewEndMs, { follow });
    } else {
      ensureInitialView();
    }
    renderAll();
  }

  function updateUrlState() {
    const params = new URLSearchParams(location.search);
    params.set("token", state.token);
    params.delete("extractor");
    params.delete("expression");
    params.delete("bands");
    params.delete("bandConstants");
    params.delete("bandRaw");

    selectedExtractors().forEach((extractor) => params.append("extractor", extractor.id));
    activeExpressions().forEach((expression) => params.append("expression", expression));
    if (els.bandsEnabled.checked) {
      params.set("bands", "1");
      params.set("bandConstants", els.bandConstants.value);
      if (els.bandIncludeRaw.checked) params.set("bandRaw", "1");
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
      if (!canLiveFollow()) {
        liveFollow = false;
        updateRangeEditor();
        return;
      }
      const oldEnd = dataEndMs;
      const series = currentDisplaySeries;
      records.push(record);
      records = records.slice(-10000);
      try {
        const baseValues = await evaluateBaseRecord(record, currentBaseSeries);
        const values = displayValuesFromBase(baseValues, recordTime(record), series);
        const pointValues = values.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
        const row = { record, values, pointValues };
        evaluatedRows.unshift(row);
        evaluatedRows = evaluatedRows.slice(0, 10000);
        row.pointValues.forEach((value, index) => {
          if (value !== null && seriesPoints[index]) {
            seriesPoints[index].points.push({ t: recordTime(record), v: value });
            seriesPoints[index].points = seriesPoints[index].points.slice(-10000);
          }
        });
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
    updateUrlState();
    await recomputeAndRender();
  }

  let expressionTimer = null;
  function onExpressionInput() {
    updateUrlState();
    clearTimeout(expressionTimer);
    expressionTimer = setTimeout(() => {
      recomputeAndRender().catch(showError);
    }, 180);
  }

  function onBandInput() {
    updateUrlState();
    clearTimeout(expressionTimer);
    expressionTimer = setTimeout(() => {
      recomputeAndRender().catch(showError);
    }, 180);
  }

  function onChartMessageClick(event) {
    const button = event.target.closest?.("[data-series-key]");
    if (!button) return;
    const key = button.getAttribute("data-series-key");
    if (!key) return;
    if (hiddenSeriesKeys.has(key)) hiddenSeriesKeys.delete(key);
    else hiddenSeriesKeys.add(key);
    drawChart();
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
    els.from.value = toLocalInputValue(new Date(now.getTime() - defaultWindowMs));
    els.to.value = "";
    els.from.addEventListener("change", () => loadHistory().catch(showError));
    els.to.addEventListener("change", () => loadHistory().catch(showError));
    els.extractor.addEventListener("change", () => onExtractorChange().catch(showError));
    els.expression.addEventListener("input", onExpressionInput);
    els.bandsEnabled.addEventListener("change", onBandInput);
    els.bandConstants.addEventListener("input", onBandInput);
    els.bandIncludeRaw.addEventListener("change", onBandInput);
    els.chartMessage.addEventListener("click", onChartMessageClick);
    els.load.addEventListener("click", () => loadHistory({ keepView: true }).catch(showError));
    els.live.addEventListener("click", () => {
      liveFollow = canLiveFollow();
      if (dataEndMs != null && viewStartMs != null && viewEndMs != null) {
        const width = viewEndMs - viewStartMs;
        setViewRange(dataEndMs - width, dataEndMs, { follow: canLiveFollow() });
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
