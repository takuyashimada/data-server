function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function readonlyPage(device: string, label: string, token: string): string {
  const escapedDevice = escapeHtml(device);
  const escapedLabel = escapeHtml(label);
  const escapedToken = escapeHtml(token);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedDevice} / ${escapedLabel}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --panel-border: #d8dde6;
        --text: #151922;
        --muted: #687386;
        --accent: #0f766e;
        --accent-soft: #d9f2ee;
        --danger: #b42318;
        --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 24px;
        border-bottom: 1px solid var(--panel-border);
        background: var(--panel);
      }
      h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 650;
      }
      main {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        padding: 16px;
        max-width: 1280px;
        margin: 0 auto;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
        padding: 0 10px;
        border: 1px solid var(--panel-border);
        background: #fff;
        font-size: 13px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9aa4b2;
      }
      .status.connected .dot { background: var(--accent); }
      .status.error .dot { background: var(--danger); }
      .toolbar {
        display: flex;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
        padding: 14px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
      }
      label {
        display: grid;
        gap: 5px;
        font-size: 12px;
        color: var(--muted);
      }
      select, input, button {
        height: 34px;
        border: 1px solid var(--panel-border);
        background: #fff;
        color: var(--text);
        font: inherit;
        font-size: 14px;
        padding: 0 10px;
      }
      button {
        cursor: pointer;
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
        font-weight: 600;
      }
      button.secondary {
        background: #fff;
        color: var(--text);
        border-color: var(--panel-border);
      }
      input[type="range"] {
        min-width: 180px;
        padding: 0;
      }
      .range-value {
        font-family: var(--mono);
        font-size: 13px;
        color: var(--text);
      }
      .range-editor {
        margin-top: 12px;
        display: grid;
        gap: 8px;
      }
      .range-scale, .range-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
      }
      .range-track {
        position: relative;
        height: 34px;
        border: 1px solid var(--panel-border);
        background:
          linear-gradient(to right, rgba(15, 118, 110, 0.10), rgba(15, 118, 110, 0.10)),
          #f9fafb;
        user-select: none;
        touch-action: none;
      }
      .range-selection {
        position: absolute;
        top: 4px;
        bottom: 4px;
        left: 0;
        right: 0;
        min-width: 18px;
        border: 1px solid var(--accent);
        background: rgba(15, 118, 110, 0.18);
        cursor: grab;
      }
      .range-selection.dragging { cursor: grabbing; }
      .range-handle {
        position: absolute;
        top: -5px;
        width: 14px;
        height: 34px;
        border: 2px solid var(--accent);
        background: #fff;
        cursor: ew-resize;
      }
      .range-handle.left { left: -8px; }
      .range-handle.right { right: -8px; }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
        gap: 16px;
      }
      section {
        border: 1px solid var(--panel-border);
        background: var(--panel);
        min-width: 0;
      }
      section h2 {
        margin: 0;
        padding: 12px 14px;
        border-bottom: 1px solid var(--panel-border);
        font-size: 14px;
        font-weight: 650;
      }
      .chart-wrap {
        padding: 14px;
      }
      canvas {
        display: block;
        width: 100%;
        height: 360px;
        border: 1px solid var(--panel-border);
        background: #fff;
      }
      .latest {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        padding: 14px;
      }
      .metric {
        border: 1px solid var(--panel-border);
        padding: 10px;
        min-width: 0;
      }
      .metric .name {
        color: var(--muted);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .metric .value {
        margin-top: 6px;
        font-family: var(--mono);
        font-size: 18px;
        overflow-wrap: anywhere;
      }
      .records {
        max-height: 520px;
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        border-bottom: 1px solid var(--panel-border);
        padding: 8px 10px;
        vertical-align: top;
        text-align: left;
      }
      th {
        position: sticky;
        top: 0;
        background: #f9fafb;
        color: var(--muted);
        font-weight: 600;
      }
      td.mono {
        font-family: var(--mono);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .message {
        padding: 14px;
        color: var(--muted);
      }
      .unit {
        color: var(--muted);
        font-size: 12px;
        font-weight: 500;
      }
      .error-text { color: var(--danger); }
      @media (max-width: 860px) {
        header { align-items: flex-start; flex-direction: column; }
        main { padding: 10px; }
        .grid { grid-template-columns: 1fr; }
        canvas { height: 280px; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapedDevice} / ${escapedLabel}</h1>
      <div id="status" class="status"><span class="dot"></span><span>starting</span></div>
    </header>
    <main>
      <div class="toolbar">
        <label>
          extractor
          <select id="extractor"></select>
        </label>
        <label>
          expression
          <input id="expression" type="text" placeholder="temperature">
        </label>
        <label>
          from
          <input id="from" type="datetime-local">
        </label>
        <label>
          to
          <input id="to" type="datetime-local">
        </label>
        <button id="load" type="button">Load</button>
        <button id="live" class="secondary" type="button">Reconnect live</button>
      </div>
      <div class="grid">
        <section>
          <h2>History</h2>
          <div class="chart-wrap">
            <canvas id="chart" width="900" height="360"></canvas>
            <div class="range-editor">
              <div class="range-scale">
                <span id="rangeStartLabel">--</span>
                <span id="rangeEndLabel">--</span>
              </div>
              <div id="rangeTrack" class="range-track">
                <div id="rangeSelection" class="range-selection">
                  <span id="rangeLeft" class="range-handle left"></span>
                  <span id="rangeRight" class="range-handle right"></span>
                </div>
              </div>
              <div class="range-meta">
                <span id="rangeWindowLabel">--</span>
                <span id="rangeModeLabel">live follow</span>
              </div>
            </div>
          </div>
          <div id="chartMessage" class="message"></div>
        </section>
        <section>
          <h2>Latest</h2>
          <div id="latest" class="latest"></div>
        </section>
      </div>
      <section>
        <h2>Recent Records <span id="recordsUnit" class="unit"></span></h2>
        <div class="records">
          <table>
            <thead><tr><th style="width: 220px;">receivedAt</th><th>data</th></tr></thead>
            <tbody id="records"></tbody>
          </table>
        </div>
      </section>
    </main>
    <script>
      window.__VIEWER__ = {
        device: ${JSON.stringify(device)},
        label: ${JSON.stringify(label)},
        token: ${JSON.stringify(token)}
      };
    </script>
    <script src="/assets/jsonata.min.js"></script>
    <script src="/assets/readonly-view.js"></script>
  </body>
</html>`;
}
