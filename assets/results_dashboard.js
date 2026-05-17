(function () {
  const config = {
    mode: "api",
    apiBase: "/api/results",
    defaultStage: "final_top100",
    stages: ["final_top100", "pro_top100", "flash_top1000"],
    showAudit: true,
    publicMode: false,
    ...(window.RESULTS_DASHBOARD_CONFIG || {}),
  };

  const stageMeta = {
    final_top100: {
      label: "Final Top 100",
      kicker: "Stack-ranked finalists",
      description:
        "DeepSeek V4 Pro chunk rankings over the Codex top 100, interleaved by local rank.",
    },
    pro_top100: {
      label: "Pro Tournament Top 100",
      kicker: "1,000 thesis rerun",
      description: "DeepSeek V4 Pro elimination tournament over the rerun top 1000 theses.",
    },
    flash_top1000: {
      label: "Flash Tournament Top 1000",
      kicker: "50,435 input screen",
      description: "DeepSeek V4 Flash elimination tournament: pick top 3 of 10 until 1000 remain.",
    },
  };

  const state = {
    stage: config.defaultStage,
    rows: [],
    stageData: null,
    overview: null,
    query: "",
  };

  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const els = {
    tabs: document.getElementById("stage-tabs"),
    audit: document.getElementById("audit-list"),
    metrics: document.getElementById("metrics"),
    insights: document.getElementById("insights"),
    insightStatus: document.getElementById("insight-status"),
    status: document.getElementById("dataset-status"),
    title: document.getElementById("stage-title"),
    description: document.getElementById("stage-description"),
    body: document.getElementById("rankings-body"),
    rounds: document.getElementById("rounds"),
    batchAudit: document.getElementById("batch-audit"),
    search: document.getElementById("search"),
    select: document.getElementById("stage-select"),
    summary: document.getElementById("table-summary"),
    csvLink: document.getElementById("csv-link"),
    backdrop: document.getElementById("drawer-backdrop"),
    drawer: document.getElementById("drawer"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerSubtitle: document.getElementById("drawer-subtitle"),
    thesisMeta: document.getElementById("thesis-meta"),
    thesisContent: document.getElementById("thesis-content"),
  };

  function apiUrl(path) {
    return `${config.apiBase.replace(/\/$/, "")}${path}`;
  }

  async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async function loadOverview() {
    const overview =
      config.mode === "static"
        ? await getJson(apiUrl("/overview.json"))
        : await getJson(apiUrl("/overview"));
    state.overview = overview;
    renderOverview(overview);
  }

  async function loadStage(stage) {
    state.stage = stage;
    setActiveStage(stage);
    els.body.innerHTML = `<tr><td colspan="6" class="muted">Loading ${escapeHtml(stageLabel(stage))}...</td></tr>`;

    const data =
      config.mode === "static"
        ? await getJson(apiUrl(`/stages/${encodeURIComponent(stage)}.json`))
        : await getJson(apiUrl(`/stage/${encodeURIComponent(stage)}`));

    state.stageData = data;
    state.rows = data.rows || [];
    els.title.textContent = data.title || stageLabel(stage);
    els.description.textContent = data.description || stageMeta[stage]?.description || "";
    updateCsvLink(data);
    renderRows();
    renderRounds(data.rounds || []);
    els.batchAudit.classList.remove("open");
    els.batchAudit.innerHTML = "";
  }

  function mountStageControls() {
    const stages = config.stages && config.stages.length ? config.stages : ["final_top100"];
    els.tabs.innerHTML = stages
      .map((stage) => {
        const meta = stageMeta[stage] || { label: stageLabel(stage), kicker: "Saved result set" };
        return `<button class="stage-tab" type="button" data-stage="${escapeAttr(stage)}">
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${escapeHtml(meta.kicker)}</span>
        </button>`;
      })
      .join("");

    els.select.innerHTML = stages
      .map((stage) => `<option value="${escapeAttr(stage)}">${escapeHtml(stageLabel(stage))}</option>`)
      .join("");

    if (stages.length === 1) {
      els.select.hidden = true;
    }
  }

  function setActiveStage(stage) {
    document.querySelectorAll(".stage-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.stage === stage);
    });
    els.select.value = stage;
  }

  function renderOverview(overview) {
    const stages = overview.stages || {};
    const flash = stages.flash_top1000 || {};
    const pro = stages.pro_top100 || {};
    const compressed = overview.compressed_manifest || {};
    const compressedBytes = compressed.compressed_size_bytes || compressed.compressed_bytes;
    const compressedSize = compressedBytes ? `${(compressedBytes / 1024 / 1024).toFixed(1)} MiB` : "available";
    const publicScope = overview.public_scope || {};

    els.metrics.innerHTML = [
      metric("Flash Inputs", fmt.format(flash.input_count || publicScope.flash_inputs || 0), "50,435-input global screen", "blue"),
      metric("Pro Theses", fmt.format(publicScope.pro_thesis_count || 1000), "Rerun complete, zero failed", "green"),
      metric("Final Rows", fmt.format(overview.final_rank_rows || publicScope.final_rank_rows || 0), "Stack-ranked with rationale", "amber"),
      metric("Public Scope", config.publicMode ? "Top 100" : "Full Local", config.publicMode ? "Trimmed static export" : `Archive ${compressedSize}`, "rose"),
    ].join("");

    els.status.textContent = config.publicMode
      ? `${overview.tournament_id || "global-smallcap-20260516"}; public top-100 export`
      : `${overview.tournament_id || "global-smallcap-20260516"}; archive ${compressedSize}`;

    renderAuditList(overview);
    renderInsights(overview);
  }

  function metric(label, value, note, tone) {
    return `<div class="metric ${escapeAttr(tone || "")}">
      <div>
        <span class="metric-label">${escapeHtml(label)}</span>
        <div class="metric-value">${escapeHtml(value)}</div>
      </div>
      <div class="metric-note">${escapeHtml(note || "")}</div>
    </div>`;
  }

  function renderAuditList(overview) {
    const publicScope = overview.public_scope || {};
    const stages = overview.stages || {};
    const flash = stages.flash_top1000 || {};
    const pro = stages.pro_top100 || {};
    const items = [
      `${fmt.format(flash.input_count || publicScope.flash_inputs || 50435)} Flash inputs screened`,
      `${fmt.format(pro.input_count || publicScope.pro_inputs || 1000)} Pro inputs to top 100`,
      `${fmt.format(publicScope.codex_top100_count || overview.final_rank_rows || 100)} Codex top-100 analyses`,
      config.publicMode
        ? "Public export limited to final top 100"
        : `${fmt.format(publicScope.batch_decisions || 7280)} saved batch JSON decisions`,
    ];
    els.audit.innerHTML = items
      .map((item) => `<div class="audit-item"><span class="audit-dot"></span><span>${escapeHtml(item)}</span></div>`)
      .join("");
  }

  function renderInsights(overview) {
    const insights = overview.tournament_insights || {};
    const flash = insights.flash || {};
    const final = insights.final || {};
    const migration = insights.migration || {};
    const audit = insights.audit || {};
    const flashRounds = insights.flash_rounds || [];
    const flashCountries = flash.top_countries || [];
    const finalCountries = final.top_countries || [];
    const capBands = flash.market_cap_bands || {};
    const flashBatchCount = audit.flash_batch_decisions || 7150;
    const proBatchCount = audit.pro_batch_decisions || 130;

    els.insightStatus.textContent = `${fmt.format(flashBatchCount)} Flash batches + ${fmt.format(proBatchCount)} Pro batches`;
    els.insights.innerHTML = [
      `<div class="insight-card">
        <strong>Funnel Compression</strong>
        <p>Flash cut ${fmt.format(50435)} screened names to ${fmt.format(1000)} finalists, then Pro cut the thesis rerun to 100.</p>
        ${renderFunnelBars(flashRounds)}
      </div>`,
      `<div class="insight-card">
        <strong>Not Just The Flash Top 100</strong>
        <p>Only ${fmt.format(migration.final_in_flash_top100 || 0)} final names were already in the Flash top 100. Median final-name Flash rank was ${fmt.format(migration.final_flash_rank_median || 0)}, so the Pro pass materially reshuffled the screen.</p>
      </div>`,
      `<div class="insight-card">
        <strong>Market-Cap Sweet Spot</strong>
        <p>Flash finalists clustered below $150M: ${fmt.format((capBands["<$50M"] || 0) + (capBands["$50-150M"] || 0))} of 1,000. Final median cap was ${formatMoney(final.market_cap_median)}.</p>
      </div>`,
      `<div class="insight-card">
        <strong>Geography Held Up</strong>
        <p>Flash leaders: ${formatLeaders(flashCountries)}. Final top-100 leaders: ${formatLeaders(finalCountries)}.</p>
      </div>`,
    ].join("");
  }

  function renderFunnelBars(rounds) {
    const usable = rounds.length
      ? rounds
      : [
          { round_index: 1, input_count: 50435, winner_count: 15132 },
          { round_index: 2, input_count: 15132, winner_count: 4541 },
          { round_index: 3, input_count: 4541, winner_count: 1363 },
          { round_index: 4, input_count: 1363, winner_count: 1000 },
        ];
    const maxInput = Math.max(...usable.map((round) => Number(round.input_count) || 0), 1);
    return `<div class="funnel-bars">
      ${usable
        .map((round) => {
          const winners = Number(round.winner_count) || 0;
          const width = Math.max(4, Math.round((winners / maxInput) * 100));
          return `<div class="funnel-bar">
            <span>R${escapeHtml(round.round_index || "")}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
            <span>${fmt.format(winners)}</span>
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function renderRows() {
    const query = state.query.trim().toLowerCase();
    const rows = query
      ? state.rows.filter((row) => {
          const haystack = [
            row.ticker,
            row.company_name,
            row.exchange,
            row.country,
            row.reason,
            row.rationale,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : state.rows;

    renderSummary(rows);

    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="6" class="muted">No rows match the current filter.</td></tr>`;
      return;
    }

    els.body.innerHTML = rows
      .map((row) => {
        const marketCap = Number(row.market_cap_usd);
        const marketCapText = Number.isFinite(marketCap) ? money.format(marketCap) : "";
        const reason = row.reason || row.rationale || "";
        return `<tr data-thesis-path="${escapeAttr(row.thesis_path || "")}" data-thesis-data-path="${escapeAttr(row.thesis_data_path || "")}" data-ticker="${escapeAttr(row.ticker || "")}">
          <td class="rank">${escapeHtml(row.final_rank || row.rank || "")}</td>
          <td class="ticker-cell">
            <span class="ticker">${escapeHtml(row.ticker || "")}</span>
            <span class="ticker-sub">${escapeHtml(row.currency || "")}</span>
          </td>
          <td class="company-cell">
            <span class="company-name">${escapeHtml(row.company_name || "")}</span>
          </td>
          <td>
        <div class="chip-row">
              ${chip(row.exchange)}
              ${chip(row.country)}
            </div>
          </td>
          <td class="value-cell">${escapeHtml(marketCapText)}</td>
          <td class="reason">${escapeHtml(reason)}</td>
        </tr>`;
      })
      .join("");
  }

  function renderSummary(rows) {
    const exchanges = new Set(rows.map((row) => row.exchange).filter(Boolean));
    const countries = new Set(rows.map((row) => row.country).filter(Boolean));
    const caps = rows.map((row) => Number(row.market_cap_usd)).filter(Number.isFinite);
    const medianCap = caps.length ? caps.slice().sort((a, b) => a - b)[Math.floor(caps.length / 2)] : null;
    els.summary.innerHTML = [
      pill(`${fmt.format(rows.length)} visible`),
      pill(`${fmt.format(exchanges.size)} markets`),
      pill(`${fmt.format(countries.size)} countries`),
      medianCap ? pill(`${money.format(medianCap)} median cap`) : "",
    ].join("");
  }

  function renderRounds(rounds) {
    if (!config.showAudit || !rounds.length) {
      els.rounds.innerHTML = "";
      return;
    }
    els.rounds.innerHTML = rounds
      .map((round) => {
        const usage = round.usage || {};
        return `<div class="round">
          <strong>Round ${escapeHtml(round.round_index || "")}</strong>
          <dl>
            <dt>Inputs</dt><dd>${fmt.format(round.input_count || 0)}</dd>
            <dt>Batches</dt><dd>${fmt.format(round.batch_count || 0)}</dd>
            <dt>Winners</dt><dd>${fmt.format(round.winner_count || 0)}</dd>
            <dt>Tokens</dt><dd>${fmt.format(usage.total_tokens || 0)}</dd>
          </dl>
          <button type="button" data-round-id="${escapeAttr(round.round_id || "")}">View Audit</button>
        </div>`;
      })
      .join("");
  }

  async function loadBatchAudit(roundId) {
    if (!roundId || !config.showAudit || config.mode === "static") return;
    els.batchAudit.classList.add("open");
    els.batchAudit.innerHTML = `<div class="thesis-meta">Loading ${escapeHtml(roundId)} batch decisions...</div>`;
    try {
      const data = await getJson(
        apiUrl(`/stage/${encodeURIComponent(state.stage)}/${encodeURIComponent(roundId)}/batches?limit=100`)
      );
      const batches = data.batches || [];
      els.batchAudit.innerHTML = `<div class="thesis-meta">Showing ${fmt.format(data.returned_batches || 0)} of ${fmt.format(data.total_batches || 0)} saved batch decisions for ${escapeHtml(roundId)}.</div>
        <div class="batch-list">
          ${batches
            .map((batch) => {
              return `<div class="batch">
                <strong>Batch ${escapeHtml(batch.batch_index || "")}</strong>
                <div class="muted">${escapeHtml(batch.model || "")} | ${escapeHtml(batch.mode || "")} | tokens ${fmt.format(batch.total_tokens || 0)}</div>
                <div class="batch-grid">
                  <div><strong>Inputs</strong><code>${escapeHtml((batch.input_tickers || []).join(" | "))}</code></div>
                  <div><strong>Advanced</strong><code>${escapeHtml((batch.winners || []).join(" | "))}</code></div>
                </div>
                <code>${escapeHtml(batch.response || "")}</code>
              </div>`;
            })
            .join("")}
        </div>`;
    } catch (error) {
      els.batchAudit.innerHTML = `<div class="thesis-meta">Batch audit failed: ${escapeHtml(error)}</div>`;
    }
  }

  async function openThesis(row) {
    const path = row.dataset.thesisPath || "";
    const thesisDataPath = row.dataset.thesisDataPath || "";
    if (!path && !thesisDataPath) return;

    els.drawer.classList.add("open");
    els.drawer.setAttribute("aria-hidden", "false");
    els.backdrop.hidden = false;
    els.drawerTitle.textContent = row.dataset.ticker || "Thesis";
    els.drawerSubtitle.textContent = path || thesisDataPath;
    els.thesisMeta.textContent = "Loading thesis...";
    els.thesisContent.innerHTML = "";

    try {
      const data =
        config.mode === "static"
          ? await getJson(thesisDataPath)
          : await getJson(apiUrl(`/thesis?path=${encodeURIComponent(path)}`));
      const meta = data.metadata || {};
      els.drawerTitle.textContent = `${meta.ticker || row.dataset.ticker || "Thesis"}${
        meta.company_name ? " - " + meta.company_name : ""
      }`;
      els.drawerSubtitle.textContent = data.path || path || thesisDataPath;
      els.thesisMeta.textContent = [
        meta.provider,
        meta.model,
        meta.reasoning_effort ? `reasoning ${meta.reasoning_effort}` : "",
        meta.source_count != null ? `${meta.source_count} sources` : "",
        meta.status,
      ]
        .filter(Boolean)
        .join(" | ");
      els.thesisContent.innerHTML = data.html || "";
    } catch (error) {
      els.thesisMeta.textContent = "Unable to load thesis.";
      els.thesisContent.textContent = String(error);
    }
  }

  function closeDrawer() {
    els.drawer.classList.remove("open");
    els.drawer.setAttribute("aria-hidden", "true");
    els.backdrop.hidden = true;
  }

  function updateCsvLink(data) {
    const csvPath = data.public_csv_path || data.csv_path;
    if (config.mode === "static" && data.public_csv_path) {
      els.csvLink.href = data.public_csv_path;
      els.csvLink.hidden = false;
      return;
    }
    if (!config.publicMode && csvPath) {
      els.csvLink.hidden = true;
      return;
    }
    els.csvLink.hidden = true;
  }

  function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? money.format(number) : "n/a";
  }

  function formatLeaders(items) {
    if (!items.length) return "n/a";
    return items
      .slice(0, 3)
      .map((item) => `${item.label} ${fmt.format(item.count)}`)
      .join(", ");
  }

  function stageLabel(stage) {
    return stageMeta[stage]?.label || stage.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function pill(value) {
    return `<span class="summary-pill">${escapeHtml(value)}</span>`;
  }

  function chip(value) {
    return value ? `<span class="chip">${escapeHtml(value)}</span>` : "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  els.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-stage]");
    if (!button) return;
    loadStage(button.dataset.stage).catch(renderStageError);
  });

  els.select.addEventListener("change", (event) => {
    loadStage(event.target.value).catch(renderStageError);
  });

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderRows();
  });

  els.body.addEventListener("click", (event) => {
    const row = event.target.closest("tr");
    if (!row) return;
    openThesis(row);
  });

  els.rounds.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-round-id]");
    if (!button) return;
    loadBatchAudit(button.dataset.roundId);
  });

  document.getElementById("close-drawer").addEventListener("click", closeDrawer);
  els.backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  function renderStageError(error) {
    els.body.innerHTML = `<tr><td colspan="6">${escapeHtml(error)}</td></tr>`;
  }

  mountStageControls();
  loadOverview().catch((error) => {
    els.status.textContent = `Overview failed: ${error}`;
  });
  loadStage(state.stage).catch(renderStageError);
})();
