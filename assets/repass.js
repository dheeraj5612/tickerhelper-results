(function () {
  const state = {
    rows: [],
    pending: [],
    tiers: [],
    query: "",
    tier: "All",
    sort: "overall_rank",
  };

  const els = {
    coverage: document.getElementById("coverage-status"),
    metrics: document.getElementById("repass-metrics"),
    priority: document.getElementById("priority-strip"),
    snapshotStatus: document.getElementById("snapshot-status"),
    search: document.getElementById("repass-search"),
    tierFilter: document.getElementById("tier-filter"),
    tierTabs: document.getElementById("tier-tabs"),
    sort: document.getElementById("sort-select"),
    summary: document.getElementById("repass-summary"),
    body: document.getElementById("repass-body"),
    pendingStatus: document.getElementById("pending-status"),
    pendingGrid: document.getElementById("pending-grid"),
  };

  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function moic(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
  }

  function tierShort(tier) {
    return String(tier || "").replace(/^[A-D]\s+-\s+/, "");
  }

  function metric(label, value, note, tone) {
    return `<div class="metric ${escapeHtml(tone || "")}">
      <div>
        <span class="metric-label">${escapeHtml(label)}</span>
        <div class="metric-value">${escapeHtml(value)}</div>
      </div>
      <div class="metric-note">${escapeHtml(note || "")}</div>
    </div>`;
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function filteredRows() {
    const query = normalize(state.query);
    return state.rows
      .filter((row) => {
        if (state.tier !== "All" && row.tier !== state.tier) return false;
        if (!query) return true;
        return [
          row.ticker,
          row.company,
          row.theme,
          row.source,
          row.why,
          row.tier,
        ].some((field) => normalize(field).includes(query));
      })
      .sort((a, b) => {
        if (state.sort === "ticker") return String(a.ticker).localeCompare(String(b.ticker));
        if (state.sort === "base_moic" || state.sort === "bull_moic") {
          return (b[state.sort] || -Infinity) - (a[state.sort] || -Infinity);
        }
        return (a.overall_rank || 0) - (b.overall_rank || 0);
      });
  }

  function renderMetrics(payload) {
    const summary = payload.summary || {};
    const tiers = payload.tiers || [];
    const diligence = tiers.find((item) => item.name === "A - Diligence First")?.count || 0;
    const watchlist = tiers.find((item) => item.name === "B - Strong Watchlist")?.count || 0;
    const pending = (payload.pending_top100 || []).length;
    els.coverage.textContent = `${fmt.format(payload.rows.length)} exposures`;
    els.metrics.innerHTML = [
      metric("Analyzed", summary.unique_analyzed_names || fmt.format(payload.rows.length), "Flattened economic exposures", "blue"),
      metric("Diligence First", summary.diligence_first_names || fmt.format(diligence), "Highest priority bucket", "green"),
      metric("Strong Watchlist", summary.strong_watchlist_names || fmt.format(watchlist), "Second-tier research queue", "amber"),
      metric("Focus Missing", summary.focus_top100_names_still_missing_from_pasted_gpt_5_5_pro_scenario_runs || fmt.format(pending), "Sector focus queue remaining", "rose"),
    ].join("");
  }

  function renderPriority() {
    const top = state.rows
      .filter((row) => row.tier === "A - Diligence First")
      .sort((a, b) => (a.overall_rank || 0) - (b.overall_rank || 0))
      .slice(0, 12);
    els.snapshotStatus.textContent = `${top.length} shown`;
    els.priority.innerHTML = top
      .map(
        (row) => `<article class="priority-card">
          <div class="priority-card-top">
            <div>
              <span class="priority-rank">#${escapeHtml(row.overall_rank)}</span>
              <div class="priority-ticker">${escapeHtml(row.ticker)}</div>
              <p class="priority-company">${escapeHtml(row.company)}</p>
            </div>
            <div class="moic-stack" aria-label="Scenario MOIC">
              <span class="moic-pill">B ${escapeHtml(moic(row.base_moic))}</span>
              <span class="moic-pill">U ${escapeHtml(moic(row.bull_moic))}</span>
            </div>
          </div>
          <p class="priority-why">${escapeHtml(row.why)}</p>
        </article>`
      )
      .join("");
  }

  function renderTierControls() {
    const options = ["All", ...state.tiers.map((item) => item.name)];
    els.tierFilter.innerHTML = options
      .map((tier) => `<option value="${escapeHtml(tier)}">${escapeHtml(tierShort(tier))}</option>`)
      .join("");
    els.tierTabs.innerHTML = options
      .map((tier) => {
        const count = tier === "All" ? state.rows.length : state.tiers.find((item) => item.name === tier)?.count || 0;
        return `<button class="tier-tab ${tier === state.tier ? "active" : ""}" type="button" data-tier="${escapeHtml(tier)}">
          ${escapeHtml(tierShort(tier))} · ${fmt.format(count)}
        </button>`;
      })
      .join("");
  }

  function renderTable() {
    const rows = filteredRows();
    els.summary.textContent = `${fmt.format(rows.length)} of ${fmt.format(state.rows.length)} exposures shown`;
    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="8" class="muted">No rows match the current filters.</td></tr>`;
      return;
    }
    els.body.innerHTML = rows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.overall_rank)}</td>
          <td><span class="ticker-link">${escapeHtml(row.ticker)}</span></td>
          <td>${escapeHtml(row.company)}</td>
          <td><span class="tier-badge">${escapeHtml(tierShort(row.tier))}</span></td>
          <td>${escapeHtml(moic(row.base_moic))}</td>
          <td>${escapeHtml(moic(row.bull_moic))}</td>
          <td>${escapeHtml(row.source)}</td>
          <td class="why-cell">${escapeHtml(row.why)}</td>
        </tr>`
      )
      .join("");
  }

  function renderPending() {
    els.pendingStatus.textContent = `${state.pending.length} remaining`;
    els.pendingGrid.innerHTML = state.pending
      .map(
        (item) => `<article class="pending-card">
          <div class="pending-meta">
            <span>Top-100 #${escapeHtml(item.rank)}</span>
            <span>${escapeHtml(item.ticker)}</span>
          </div>
          <h4>${escapeHtml(item.company)}</h4>
          <p>${escapeHtml(item.rationale)}</p>
        </article>`
      )
      .join("");
  }

  function renderAll(payload) {
    renderMetrics(payload);
    renderPriority();
    renderTierControls();
    renderTable();
    renderPending();
  }

  function bindEvents() {
    els.search.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderTable();
    });
    els.sort.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderTable();
    });
    els.tierFilter.addEventListener("change", (event) => {
      state.tier = event.target.value;
      renderTierControls();
      renderTable();
    });
    els.tierTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tier]");
      if (!button) return;
      state.tier = button.dataset.tier;
      els.tierFilter.value = state.tier;
      renderTierControls();
      renderTable();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "/" || document.activeElement === els.search) return;
      event.preventDefault();
      els.search.focus();
    });
  }

  async function init() {
    bindEvents();
    const response = await fetch("./data/gpt55_repass.json?v=20260521a", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.rows = payload.rows || [];
    state.pending = payload.pending_top100 || [];
    state.tiers = payload.tiers || [];
    renderAll(payload);
  }

  init().catch((error) => {
    els.coverage.textContent = "Failed";
    els.body.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(error.message)}</td></tr>`;
  });
})();
