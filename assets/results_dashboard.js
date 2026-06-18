(function () {
  const config = {
    mode: "api",
    apiBase: "/api/results",
        defaultTournament: "global-smallcap-20260517-v5-criteria-rerun",
    compareTournament: "global-smallcap-20260516",
    defaultStage: "pro_top100",
    stages: ["pro_top100", "flash_top1000", "final_top100"],
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
      kicker: "1,000 candidate narrowing",
      description: "DeepSeek V4 Pro elimination tournament over the saved top 1000 candidate theses.",
    },
    flash_top1000: {
      label: "Flash Tournament Top 1000",
      kicker: "42,543-name global screen",
      description: "DeepSeek V4 Flash elimination tournament: pick top 3 of 10 until 1000 remain.",
    },
  };

  const savedDensity = (() => {
    try {
      return localStorage.getItem("tickerhelper-results-density") || "";
    } catch (_error) {
      return "";
    }
  })();

  const state = {
    tournamentId: config.defaultTournament || "global-smallcap-20260516",
    compareTournamentId: config.compareTournament || "",
    stage: config.defaultStage,
    rows: [],
    stageData: null,
    overview: null,
    query: "",
    sortKey: "rank",
    sortDir: "asc",
    density: savedDensity === "compact" ? "compact" : "comfortable",
    selectedKey: "",
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
    tournamentSelect: document.getElementById("tournament-select"),
    compareSelect: document.getElementById("compare-select"),
    summary: document.getElementById("table-summary"),
    comparison: document.getElementById("comparison-panel"),
    csvLink: document.getElementById("csv-link"),
    backdrop: document.getElementById("drawer-backdrop"),
    drawer: document.getElementById("drawer"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerSubtitle: document.getElementById("drawer-subtitle"),
    thesisMeta: document.getElementById("thesis-meta"),
    thesisContent: document.getElementById("thesis-content"),
    sortHeaders: document.querySelectorAll("[data-sort-header]"),
    sortButtons: document.querySelectorAll("[data-sort]"),
    densityButtons: document.querySelectorAll("[data-density]"),
  };

  function apiUrl(path) {
    return `${config.apiBase.replace(/\/$/, "")}${path}`;
  }

  function withQuery(path, params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    const suffix = query.toString();
    return `${apiUrl(path)}${suffix ? "?" + suffix : ""}`;
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
        : await getJson(withQuery("/overview", { tournament_id: state.tournamentId }));
    state.overview = overview;
    mountTournamentControls(overview.available_tournaments || []);
    renderOverview(overview);
  }

  async function loadStage(stage) {
    state.stage = stage;
    setActiveStage(stage);
    els.body.innerHTML = `<tr><td colspan="6" class="muted">Loading ${escapeHtml(stageLabel(stage))}...</td></tr>`;

    const data =
      config.mode === "static"
        ? await getJson(apiUrl(`/stages/${encodeURIComponent(stage)}.json`))
        : await getJson(withQuery(`/stage/${encodeURIComponent(stage)}`, { tournament_id: state.tournamentId }));

    state.stageData = data;
    state.rows = data.rows || [];
    els.title.textContent = data.title || stageLabel(stage);
    els.description.textContent = data.description || stageMeta[stage]?.description || "";
    updateCsvLink(data);
    renderRows();
    renderRounds(data.rounds || []);
    loadComparison(stage).catch(() => {
      els.comparison.hidden = true;
      els.comparison.innerHTML = "";
    });
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

  function mountTournamentControls(tournaments) {
    if (!els.tournamentSelect || !els.compareSelect) return;
    const ids = tournaments.map((item) => item.tournament_id).filter(Boolean);
    const passControls = document.querySelector(".pass-controls");
    // Hide the tournament switcher when there's nothing to switch between
    // (static public export ships a single tournament).
    if (ids.length < 2) {
      if (passControls) passControls.hidden = true;
      return;
    }
    if (passControls) passControls.hidden = false;
    if (!ids.includes(state.tournamentId) && ids.length) state.tournamentId = ids[0];
    if (state.compareTournamentId && !ids.includes(state.compareTournamentId)) {
      state.compareTournamentId = ids.find((id) => id !== state.tournamentId) || "";
    }
    const options = ids
      .map((id) => `<option value="${escapeAttr(id)}">${escapeHtml(tournamentLabel(id))}</option>`)
      .join("");
    els.tournamentSelect.innerHTML = options;
    els.tournamentSelect.value = state.tournamentId;

    els.compareSelect.innerHTML =
      `<option value="">No comparison</option>` +
      options;
    els.compareSelect.value = state.compareTournamentId;
  }

  function setActiveStage(stage) {
    document.querySelectorAll(".stage-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.stage === stage);
    });
    els.select.value = stage;
  }

  function renderOverview(overview) {
    const stages = overview.stages || {};
    const firstPass = stages.pro_top10000 || stages.flash_top1000 || {};
    const finalPass = stages.pro_top100 || {};
    const compressed = overview.compressed_manifest || {};
    const compressedBytes = compressed.compressed_size_bytes || compressed.compressed_bytes;
    const compressedSize = compressedBytes ? `${(compressedBytes / 1024 / 1024).toFixed(1)} MiB` : "available";
    const publicScope = overview.public_scope || {};
    const universeCount =
      publicScope.screen_inputs ||
      firstPass.input_count ||
      publicScope.flash_inputs ||
      0;
    const thesisCount =
      publicScope.v4_pro_thesis_count ||
      publicScope.pro_thesis_count ||
      0;

    els.metrics.innerHTML = [
      metric("GPT-5.5 Pro pass", fmt.format(universeCount), "Names screened to a top 100", "amber"),
      metric("Pipeline", "4 rounds", "Flash → V4 Pro → GPT-5.5 Pro", "blue"),
      metric("Final stack rank", fmt.format(overview.final_rank_rows || publicScope.final_rank_rows || 0), "GPT-5.5 Pro top-100 theses", "green"),
      metric("Top 20", "Gated", "Reserved for subscribers", "rose"),
    ].join("");

    els.status.textContent = config.publicMode
      ? `${overview.tournament_id || "latest"}; public top-100 export`
      : `${overview.tournament_id || "latest"}; archive ${compressedSize}`;

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
    const firstPass = stages.pro_top10000 || stages.flash_top1000 || {};
    const finalPass = stages.pro_top100 || {};
    const universeCount =
      publicScope.screen_inputs ||
      firstPass.input_count ||
      publicScope.flash_inputs ||
      0;
    const firstFinalCount = firstPass.final_count || publicScope.first_pass_finalists || 10000;
    const top100InputCount = finalPass.input_count || publicScope.second_pass_inputs || firstFinalCount;
    const items = [
      `${fmt.format(universeCount)} investable names screened`,
      `${fmt.format(firstFinalCount)} V4 Pro high-reasoning semifinalists`,
      `${fmt.format(top100InputCount)} V4 Pro max-reasoning inputs to top 100`,
      `${fmt.format(publicScope.codex_top100_count || overview.final_rank_rows || 100)} fresh GPT-5.5 Pro finalist theses`,
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
    const audit = insights.audit || {};
    const stages = overview.stages || {};
    const firstPass = stages.pro_top10000 || stages.flash_top1000 || {};
    const finalPass = stages.pro_top100 || {};
    const publicScope = overview.public_scope || {};
    const firstRounds = insights.pro_top10000_rounds || insights.flash_rounds || [];
    const screenInputs = publicScope.screen_inputs || firstPass.input_count || publicScope.flash_inputs || 0;
    const firstFinal = firstPass.final_count || publicScope.first_pass_finalists || 10000;
    const finalInputs = finalPass.input_count || publicScope.second_pass_inputs || firstFinal;
    const finalRows = overview.final_rank_rows || publicScope.final_rank_rows || 100;
    const firstBatchCount = audit.pro_top10000_batch_decisions || audit.flash_batch_decisions || publicScope.first_pass_batches || 0;
    const secondBatchCount = audit.pro_batch_decisions || publicScope.second_pass_batches || 0;

    els.insightStatus.textContent = `${fmt.format(firstBatchCount + secondBatchCount)} saved model decisions`;
    els.insights.innerHTML = [
      `<div class="insight-card">
        <strong>Funnel Compression</strong>
        <p>The broad screen was compressed from ${fmt.format(screenInputs)} names to ${fmt.format(firstFinal)}, then to ${fmt.format(finalRows)} finalists.</p>
        ${renderFunnelBars(firstRounds, screenInputs, firstFinal)}
      </div>`,
      `<div class="insight-card">
        <strong>Higher-Reasoning Finish</strong>
        <p>The large pass uses V4 Pro high reasoning; the ${fmt.format(finalInputs)} to 100 pass uses max reasoning before Codex writes fresh finalist theses.</p>
      </div>`,
      `<div class="insight-card">
        <strong>Final Thesis Refresh</strong>
        <p>The top 100 list is judged from newly written Codex finalist theses when available, with V4 Pro theses as the fallback research layer.</p>
      </div>`,
      `<div class="insight-card">
        <strong>Research Queue</strong>
        <p>This is a ranked research queue for deeper review, not a recommendation service or a substitute for current diligence.</p>
      </div>`,
    ].join("");
  }

  function renderFunnelBars(rounds, screenInputs, firstFinal) {
    const usable = rounds.length
      ? rounds
      : [
          { round_index: 1, input_count: screenInputs || 0, winner_count: firstFinal || 0 },
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
    const filteredRows = query
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
      : state.rows.slice();
    const rows = sortRows(filteredRows);

    renderSummary(rows);
    updateSortUi();

    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="6" class="muted">No rows match the current filter.</td></tr>`;
      return;
    }

    const rowsHtml = rows
      .map((row) => {
        const marketCap = Number(row.market_cap_usd);
        const marketCapText = Number.isFinite(marketCap) ? money.format(marketCap) : "";
        const reason = row.reason || row.rationale || "";
        const key = rowKey(row);
        const selectedClass = key && key === state.selectedKey ? "selected" : "";
        const lockedClass = row.locked ? "locked" : "";
        return `<tr class="${selectedClass} ${lockedClass}" tabindex="0" data-row-key="${escapeAttr(key)}" data-locked="${row.locked ? "1" : ""}" data-thesis-path="${escapeAttr(row.thesis_path || "")}" data-thesis-data-path="${escapeAttr(row.thesis_data_path || "")}" data-ticker="${escapeAttr(row.ticker || "")}">
          <td class="rank" data-label="Rank">${escapeHtml(row.final_rank || row.rank || "")}</td>
          <td class="ticker-cell" data-label="Ticker">
            <span class="ticker">${escapeHtml(row.ticker || "")}</span>
            <span class="ticker-sub">${escapeHtml(row.currency || "")}</span>
          </td>
          <td class="company-cell" data-label="Company">
            <span class="company-name">${escapeHtml(row.company_name || "")}</span>
          </td>
          <td data-label="Market">
            <div class="chip-row">
              ${chip(row.exchange)}
              ${chip(row.country)}
            </div>
          </td>
          <td class="value-cell" data-label="Value">${escapeHtml(marketCapText)}</td>
          <td class="reason" data-label="Rationale">${escapeHtml(reason)}</td>
        </tr>`;
      });
    const lastLocked = rows.reduce((a, r, i) => (r.locked ? i : a), -1);
    if (lastLocked >= 0 && lastLocked < rows.length - 1) {
      rowsHtml.splice(lastLocked + 1, 0, '<tr class="paywall-band"><td colspan="6"><div class="paywall-strip"><span>Ranks 1–20 are reserved for <strong>The Scarcity Trade</strong> subscribers.</span><a href="https://scarcitytrade.com" target="_blank" rel="noopener">Request access →</a></div></td></tr>');
    }
    els.body.innerHTML = rowsHtml.join("");
  }

  function sortRows(rows) {
    const direction = state.sortDir === "desc" ? -1 : 1;
    return rows.slice().sort((left, right) => {
      const a = sortValue(left, state.sortKey);
      const b = sortValue(right, state.sortKey);
      const primary = compareSortValues(a, b) * direction;
      if (primary) return primary;
      return compareSortValues(sortValue(left, "rank"), sortValue(right, "rank"));
    });
  }

  function sortValue(row, key) {
    if (key === "rank") {
      const rank = Number(row.final_rank || row.rank);
      return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
    }
    if (key === "ticker") return String(row.ticker || "").toLowerCase();
    if (key === "company") return String(row.company_name || "").toLowerCase();
    if (key === "market") return `${row.country || ""} ${row.exchange || ""}`.toLowerCase();
    if (key === "value") {
      const marketCap = Number(row.market_cap_usd);
      return Number.isFinite(marketCap) ? marketCap : Number.NEGATIVE_INFINITY;
    }
    return "";
  }

  function compareSortValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function rowKey(row) {
    return [
      row.thesis_data_path || row.thesis_path || "",
      row.ticker || "",
      row.final_rank || row.rank || "",
    ].join("|");
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
        withQuery(`/stage/${encodeURIComponent(state.stage)}/${encodeURIComponent(roundId)}/batches`, {
          limit: 100,
          tournament_id: state.tournamentId,
        })
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

  async function loadComparison(stage) {
    if (config.mode === "static" || !state.compareTournamentId || state.compareTournamentId === state.tournamentId) {
      els.comparison.hidden = true;
      els.comparison.innerHTML = "";
      return;
    }
    const data = await getJson(
      withQuery(`/compare/${encodeURIComponent(stage)}`, {
        base_tournament_id: state.compareTournamentId,
        compare_tournament_id: state.tournamentId,
        limit: 100,
      })
    );
    renderComparison(data);
  }

  function renderComparison(data) {
    const rows = data.rows || [];
    els.comparison.hidden = false;
    if (!data.compare_count) {
      els.comparison.innerHTML = `<div class="comparison-head">
        <strong>Pass Comparison</strong>
        <span>${escapeHtml(tournamentLabel(data.compare_tournament_id))} has no saved rows yet for ${escapeHtml(stageLabel(data.stage_id))}.</span>
      </div>`;
      return;
    }
    els.comparison.innerHTML = `<div class="comparison-head">
        <strong>Pass Comparison</strong>
        <span>${escapeHtml(tournamentLabel(data.compare_tournament_id))} versus ${escapeHtml(tournamentLabel(data.base_tournament_id))}: ${fmt.format(data.retained_count || 0)} retained, ${fmt.format(data.added_count || 0)} added, ${fmt.format(data.removed_count || 0)} removed.</span>
      </div>
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Old</th>
              <th>New</th>
              <th>Delta</th>
              <th>Status</th>
              <th>Old Read</th>
              <th>New Read</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => {
                const delta = row.rank_delta == null ? "" : row.rank_delta > 0 ? `+${row.rank_delta}` : String(row.rank_delta);
                return `<tr>
                  <td><span class="ticker">${escapeHtml(row.ticker || "")}</span><span class="company-mini">${escapeHtml(row.company_name || "")}</span></td>
                  <td>${escapeHtml(row.base_rank || "")}</td>
                  <td>${escapeHtml(row.compare_rank || "")}</td>
                  <td class="${Number(row.rank_delta) > 0 ? "rank-up" : Number(row.rank_delta) < 0 ? "rank-down" : ""}">${escapeHtml(delta)}</td>
                  <td><span class="compare-status ${escapeAttr(row.status || "")}">${escapeHtml(row.status || "")}</span></td>
                  <td>${escapeHtml(row.base_reason || "")}</td>
                  <td>${escapeHtml(row.compare_reason || "")}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  async function openThesis(row) {
    const path = row.dataset.thesisPath || "";
    const thesisDataPath = row.dataset.thesisDataPath || "";
    if (row.dataset.locked === "1" || (!path && !thesisDataPath)) {
      state.selectedKey = row.dataset.rowKey || "";
      markSelectedRows();
      els.drawer.classList.add("open");
      els.drawer.setAttribute("aria-hidden", "false");
      els.backdrop.hidden = false;
      els.drawerTitle.textContent = "Top-20 idea — locked";
      els.drawerSubtitle.textContent = "Subscribers only";
      els.thesisMeta.textContent = "";
      els.thesisContent.innerHTML = '<div class="locked-panel"><p>This is one of the <strong>top-20 ranked names</strong>. The ticker, company, and full thesis are reserved for subscribers. The rest of the Top 100 is open below.</p><p><a class="locked-cta" href="https://scarcitytrade.com" target="_blank" rel="noopener">Request access at The Scarcity Trade →</a></p></div>';
      return;
    }

    state.selectedKey = row.dataset.rowKey || "";
    markSelectedRows();
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
    state.selectedKey = "";
    markSelectedRows();
  }

  function markSelectedRows() {
    els.body.querySelectorAll("tr").forEach((row) => {
      row.classList.toggle("selected", Boolean(state.selectedKey) && row.dataset.rowKey === state.selectedKey);
    });
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

  function tournamentLabel(tournamentId) {
    if (!tournamentId) return "";
    if (tournamentId === "global-smallcap-20260516") return "Pass 1";
    if (tournamentId === "global-smallcap-20260517-v2-criteria") return "Pass 2";
    if (tournamentId === "global-smallcap-20260517-v4-archetype") return "Recovered V4";
    if (tournamentId === "global-smallcap-20260517-v5-criteria-rerun") return "Pass 2 V5";
    return tournamentId;
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

  function updateSortUi() {
    els.sortHeaders.forEach((header) => {
      const isActive = header.dataset.sortHeader === state.sortKey;
      header.setAttribute("aria-sort", isActive ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
    });
    els.sortButtons.forEach((button) => {
      const isActive = button.dataset.sort === state.sortKey;
      button.classList.toggle("active", isActive);
      button.dataset.direction = isActive ? state.sortDir : "";
    });
  }

  function applyDensity(density) {
    state.density = density === "compact" ? "compact" : "comfortable";
    document.body.classList.toggle("density-compact", state.density === "compact");
    els.densityButtons.forEach((button) => {
      const active = button.dataset.density === state.density;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    try {
      localStorage.setItem("tickerhelper-results-density", state.density);
    } catch (_error) {
      // Ignore storage failures in private or locked-down browsers.
    }
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
  }

  els.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-stage]");
    if (!button) return;
    loadStage(button.dataset.stage).catch(renderStageError);
  });

  els.select.addEventListener("change", (event) => {
    loadStage(event.target.value).catch(renderStageError);
  });

  if (els.tournamentSelect) {
    els.tournamentSelect.addEventListener("change", (event) => {
      state.tournamentId = event.target.value;
      loadOverview().catch((error) => {
        els.status.textContent = `Overview failed: ${error}`;
      });
      loadStage(state.stage).catch(renderStageError);
    });
  }

  if (els.compareSelect) {
    els.compareSelect.addEventListener("change", (event) => {
      state.compareTournamentId = event.target.value;
      loadComparison(state.stage).catch(() => {
        els.comparison.hidden = true;
      });
    });
  }

  els.sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (!key) return;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "value" ? "desc" : "asc";
      }
      renderRows();
    });
  });

  els.densityButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyDensity(button.dataset.density);
    });
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

  els.body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr");
    if (!row) return;
    event.preventDefault();
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
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      els.search.focus();
      els.search.select();
      return;
    }
    if (event.key === "Escape") {
      if (els.drawer.classList.contains("open")) {
        closeDrawer();
        return;
      }
      if (document.activeElement === els.search && els.search.value) {
        els.search.value = "";
        state.query = "";
        renderRows();
      }
    }
  });

  function renderStageError(error) {
    els.body.innerHTML = `<tr><td colspan="6">${escapeHtml(error)}</td></tr>`;
  }

  applyDensity(state.density);
  updateSortUi();
  mountStageControls();
  loadOverview().catch((error) => {
    els.status.textContent = `Overview failed: ${error}`;
  });
  loadStage(state.stage).catch(renderStageError);
})();
