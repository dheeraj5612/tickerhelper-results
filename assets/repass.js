(function () {
  const STORAGE_KEY = "signal-ledger-repass-watchlist-v1";
  const DATA_URL = "./data/gpt55_repass.json?v=20260521d";

  const state = {
    rows: [],
    pending: [],
    tiers: [],
    sectors: [],
    countries: [],
    momentumBuckets: [],
    query: "",
    tier: "All",
    sector: "All",
    country: "All",
    momentum: "All",
    sort: "overall_rank",
    minBase: 0,
    minClean: -2.5,
    hideAccountingRisk: false,
    cashSupportedOnly: false,
    expandedKey: "",
    watchlist: new Set(),
  };

  const els = {
    coverage: document.getElementById("coverage-status"),
    metrics: document.getElementById("repass-metrics"),
    sectorStatus: document.getElementById("sector-status"),
    sectorGrid: document.getElementById("sector-grid"),
    priority: document.getElementById("priority-strip"),
    snapshotStatus: document.getElementById("snapshot-status"),
    search: document.getElementById("repass-search"),
    sectorFilter: document.getElementById("sector-filter"),
    countryFilter: document.getElementById("country-filter"),
    momentumFilter: document.getElementById("momentum-filter"),
    tierFilter: document.getElementById("tier-filter"),
    tierTabs: document.getElementById("tier-tabs"),
    sort: document.getElementById("sort-select"),
    baseMin: document.getElementById("base-min"),
    baseMinValue: document.getElementById("base-min-value"),
    cleanMin: document.getElementById("clean-min"),
    cleanMinValue: document.getElementById("clean-min-value"),
    hideAccountingRisk: document.getElementById("hide-accounting-risk"),
    cashSupportedOnly: document.getElementById("cash-supported-only"),
    resetFilters: document.getElementById("reset-filters"),
    exportCsv: document.getElementById("export-csv"),
    summary: document.getElementById("repass-summary"),
    body: document.getElementById("repass-body"),
    watchlistStatus: document.getElementById("watchlist-status"),
    watchlistGrid: document.getElementById("watchlist-grid"),
    copyWatchlist: document.getElementById("copy-watchlist"),
    clearWatchlist: document.getElementById("clear-watchlist"),
    pendingStatus: document.getElementById("pending-status"),
    pendingGrid: document.getElementById("pending-grid"),
    toast: document.getElementById("repass-toast"),
  };

  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const sectorOrder = [
    "Healthcare & Pharma",
    "Semiconductors & Hardware",
    "Energy & Utilities",
    "Metals & Materials",
    "Financials & Credit",
    "Technology & Digital",
    "Industrials & Aerospace",
    "Consumer & Media",
    "Property & Infrastructure",
    "Special Situations",
    "Non-Actionable Cleanup",
  ];
  const countryOrder = [
    "United States",
    "Canada",
    "United Kingdom",
    "Japan",
    "South Korea",
    "Hong Kong / China",
    "China",
    "Australia",
    "Germany",
    "Italy",
    "France",
    "Sweden",
    "Norway",
    "Denmark",
    "Switzerland",
    "Israel",
    "Malaysia",
    "Singapore",
    "Taiwan",
    "Mexico",
    "South Africa",
    "Poland",
    "Other / Mixed",
  ];
  const momentumOrder = ["Excellent", "Good", "Positive", "Mixed / Watch", "Weak / Stagnant", "Unknown"];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function moic(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}x` : "";
  }

  function score(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "";
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

  function overlayPills(row) {
    const pills = [];
    if (row.momentum_signal && row.momentum_signal !== "Unknown") {
      const cls = String(row.momentum_signal).toLowerCase().includes("weak") ? "momentum weak" : "momentum";
      pills.push(`<span class="risk-pill ${cls}">${escapeHtml(row.momentum_signal)}</span>`);
    }
    if (row.accounting_risk_flag) {
      pills.push(`<span class="risk-pill accounting">Accounting ${escapeHtml(row.accounting_risk_flag)}</span>`);
    }
    if (row.balance_sheet_signal) {
      pills.push(`<span class="risk-pill cash">${escapeHtml(row.balance_sheet_signal)}</span>`);
    }
    return pills.length ? `<div class="risk-pills">${pills.join("")}</div>` : "";
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function includesAny(text, words) {
    return words.some((word) => text.includes(word));
  }

  function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function deriveSector(row) {
    const primaryText = normalize(`${row.company} ${row.ticker} ${row.why}`);
    const text = normalize(`${row.company} ${row.ticker} ${row.why} ${row.theme}`);
    if (includesAny(text, ["delisted", "non-actionable", "stale", "acquired", "go-private", "duplicate exposure"])) {
      return "Non-Actionable Cleanup";
    }
    if (matchesAny(text, [/\bsemiconductor(s)?\b/, /\bsemis\b/, /\bsemicap\b/, /\bchips?\b/, /\bwafer(s)?\b/, /\bfoundry\b/, /\bmemory\b/, /\bpcb\b/, /\bdisplay driver\b/, /\bsoc\b/, /\belectronics\b/])) {
      return "Semiconductors & Hardware";
    }
    if (matchesAny(text, [/\bhealthcare\b/, /\bbiotech\b/, /\bpharma\b/, /\bmedtech\b/, /\bclinics?\b/, /\bdiagnostics?\b/, /\bmedical\b/, /\bhospitals?\b/, /\beyecare\b/, /\btherapeutics\b/])) {
      return "Healthcare & Pharma";
    }
    if (matchesAny(primaryText, [/\boil\b/, /\bgas\b/, /\benergy\b/, /\boilfield\b/, /\boffshore\b/, /\be&p\b/, /\bpetrochemical\b/, /\bhelium\b/, /\butility\b/, /\butilities\b/, /\brenewable(s)?\b/, /\brng\b/, /\bcoal\b/, /\bsolar\b/, /\bbiogas\b/, /\bpower\b/])) {
      return "Energy & Utilities";
    }
    if (matchesAny(primaryText, [/\bmining\b/, /\bmetals?\b/, /\bgold\b/, /\bsilver\b/, /\bcopper\b/, /\bmaterials?\b/, /\bresources?\b/, /\bcommodity\b/, /\bsteel\b/, /\btin\b/, /\blithium\b/, /\bmanganese\b/, /\bbattery\b/, /\bgraphite\b/, /\bchemicals?\b/])) {
      return "Metals & Materials";
    }
    if (matchesAny(primaryText, [/\bproperty\b/, /\bconstruction\b/, /\bcement\b/, /\binfrastructure\b/, /\breal estate\b/, /\bholdco(s)?\b/, /\basset-backed\b/, /\bcontractor\b/, /\bnav\b/])) {
      return "Property & Infrastructure";
    }
    if (matchesAny(primaryText, [/\bconsumer\b/, /\bfood\b/, /\bleisure\b/, /\bmedia\b/, /\bcannabis\b/, /\btravel\b/, /\bluxury\b/, /\bbeauty\b/, /\beducation\b/, /\brestaurants?\b/, /\bcable\b/, /\bautos?\b/, /\bgaming\b/, /\bapparel\b/, /\baquaculture\b/, /\bsalmon\b/, /\bhog\b/, /\bpoultry\b/, /\bplantation\b/, /\beyecare\b/])) {
      return "Consumer & Media";
    }
    if (matchesAny(primaryText, [/\bsoftware\b/, /\bsaas\b/, /\bdata\b/, /\badtech\b/, /\bhardware\b/, /\bpayments?\b/, /\bcrypto\b/, /\binternet\b/, /\bai\b/, /\bdigital\b/, /\bcyber\b/, /\bcommerce\b/, /\bsmart factory\b/, /\bplatform\b/])) {
      return "Technology & Digital";
    }
    if (matchesAny(text, [/\bfinancial(s)?\b/, /\bbancorp\b/, /\bbanks?\b/, /\binsurance\b/, /\basset manager\b/, /\basset-management\b/, /\bcredit\b/, /\blending\b/, /\bcapital markets\b/, /\bdefi\b/, /\bmortgage\b/])) {
      return "Financials & Credit";
    }
    if (matchesAny(primaryText, [/\bindustrial(s)?\b/, /\baerospace\b/, /\bmachinery\b/, /\blogistics\b/, /\bairlines?\b/, /\bstaffing\b/, /\bservices\b/, /\bequipment\b/, /\btransportation\b/, /\brecruitment\b/])) {
      return "Industrials & Aerospace";
    }
    return "Special Situations";
  }

  function deriveCountry(row) {
    const tickerText = normalize(row.ticker);
    const text = normalize(`${row.ticker} ${row.company} ${row.theme} ${row.source}`);
    const hasBareUsTicker = String(row.ticker || "")
      .split(/[\/,;|()]+/)
      .map((part) => part.trim())
      .some((part) => /^[A-Z]{1,5}$/.test(part));
    if (hasBareUsTicker && !matchesAny(tickerText, [/\.(hk|ks|kq|t|to|v|ax|l|mi|pa|st|ol|co|sw|ta|kl|si|tw|two|mx|jo|wa|br|as|nz|jk|pr)\b/])) return "United States";
    if (hasBareUsTicker && matchesAny(tickerText, [/\.[f]\b/]) && !matchesAny(tickerText, [/\.(hk|ks|kq|t|to|v|ax|l|mi|pa|st|ol|co|sw|ta|kl|si|tw|two|mx|jo|wa|br|as|nz|jk|pr)\b/])) return "United States";
    if (matchesAny(tickerText, [/hkex:/, /\.(hk)\b/])) return "Hong Kong / China";
    if (matchesAny(tickerText, [/szse:/, /sse:/, /\.(ss|sz)\b/])) return "China";
    if (matchesAny(tickerText, [/krx:/, /\.(kq|ks)\b/])) return "South Korea";
    if (matchesAny(tickerText, [/tse:/, /\.t\b/])) return "Japan";
    if (matchesAny(tickerText, [/\.(to|v)\b/, /tsx:/, /tsxv:/])) return "Canada";
    if (matchesAny(tickerText, [/\.ax\b/, /asx:/])) return "Australia";
    if (matchesAny(tickerText, [/\.l\b/, /lse:/])) return "United Kingdom";
    if (matchesAny(tickerText, [/\.de\b/, /xetra/])) return "Germany";
    if (matchesAny(tickerText, [/\.mi\b/])) return "Italy";
    if (matchesAny(tickerText, [/\.pa\b/])) return "France";
    if (matchesAny(tickerText, [/\.st\b/])) return "Sweden";
    if (matchesAny(tickerText, [/\.ol\b/])) return "Norway";
    if (matchesAny(tickerText, [/\.co\b/])) return "Denmark";
    if (matchesAny(tickerText, [/\.sw\b/])) return "Switzerland";
    if (matchesAny(tickerText, [/\.ta\b/, /tase:/])) return "Israel";
    if (matchesAny(tickerText, [/\.kl\b/, /myx:/])) return "Malaysia";
    if (matchesAny(tickerText, [/\.si\b/])) return "Singapore";
    if (matchesAny(tickerText, [/\.(tw|two)\b/, /twse:/, /tpex:/])) return "Taiwan";
    if (matchesAny(tickerText, [/\.mx\b/, /bmv:/])) return "Mexico";
    if (matchesAny(tickerText, [/\.jo\b/, /jse:/])) return "South Africa";
    if (matchesAny(tickerText, [/\.wa\b/, /newconnect:/])) return "Poland";
    if (matchesAny(tickerText, [/\.br\b/])) return "Belgium";
    if (matchesAny(tickerText, [/\.as\b/])) return "Netherlands";
    if (matchesAny(tickerText, [/\.nz\b/])) return "New Zealand";
    if (matchesAny(tickerText, [/\.jk\b/])) return "Indonesia";
    if (matchesAny(tickerText, [/\.pr\b/])) return "Czech Republic";
    if (includesAny(text, ["hong kong", " hk$"])) return "Hong Kong / China";
    if (includesAny(text, [" china ", "beijing", "shanghai", "shenzhen"])) return "China";
    if (includesAny(text, [" korea", "korean"])) return "South Korea";
    if (includesAny(text, [" japan", "japan "])) return "Japan";
    if (includesAny(text, [" canada", "canadian"])) return "Canada";
    if (includesAny(text, [" australia", "australian"])) return "Australia";
    if (includesAny(text, ["london", "gbp", "uk ", "united kingdom", " britain"])) return "United Kingdom";
    if (includesAny(text, ["germany", "german"])) return "Germany";
    if (includesAny(text, ["italy", "italian"])) return "Italy";
    if (includesAny(text, ["france", "french"])) return "France";
    if (includesAny(text, ["sweden", "swedish", " sek"])) return "Sweden";
    if (includesAny(text, ["norway", "norwegian", " nok"])) return "Norway";
    if (includesAny(text, ["denmark", "danish", " dkk"])) return "Denmark";
    if (includesAny(text, ["switzerland", "swiss", " chf"])) return "Switzerland";
    if (includesAny(text, ["israel", "israeli", " ila", " ils", "₪"])) return "Israel";
    if (includesAny(text, ["malaysia", "malaysian", " myr", " rm"])) return "Malaysia";
    if (includesAny(text, ["singapore", " s$"])) return "Singapore";
    if (includesAny(text, ["taiwan", "twd", "nt$"])) return "Taiwan";
    if (includesAny(text, ["mexico", "mexican", "mx$"])) return "Mexico";
    if (includesAny(text, ["south africa", "zar", "zac"])) return "South Africa";
    if (includesAny(text, ["poland", "polish", "pln"])) return "Poland";
    if (includesAny(text, ["belgium", "brussels"])) return "Belgium";
    if (includesAny(text, ["netherlands", "dutch"])) return "Netherlands";
    if (includesAny(text, ["new zealand", "nz$"])) return "New Zealand";
    if (includesAny(text, ["indonesia", "idr"])) return "Indonesia";
    if (includesAny(text, ["prague", "czech"])) return "Czech Republic";
    if (includesAny(text, ["nyse:", "nasdaq:", "otc", "us$", "united states"])) return "United States";
    if (/^[A-Z]{1,5}(\/[A-Z]{1,5})?(\s|$)/.test(String(row.ticker || ""))) return "United States";
    return "Other / Mixed";
  }

  function hydrateRows(rows) {
    return rows.map((row, index) => ({
      ...row,
      _key: `${row.ticker || "row"}::${row.company || ""}::${row.source || index}`,
      sector: row.sector || deriveSector(row),
      country: row.country || deriveCountry(row),
      base_moic: finiteNumber(row.base_moic, null),
      bull_moic: finiteNumber(row.bull_moic, null),
      clean_score: finiteNumber(row.clean_score, null),
      clean_score_pre_momentum_overlay: finiteNumber(row.clean_score_pre_momentum_overlay, null),
      momentum_overlay: finiteNumber(row.momentum_overlay, 0),
      momentum_signal: row.momentum_signal || "Unknown",
      accounting_cash_overlay: finiteNumber(row.accounting_cash_overlay, 0),
      accounting_risk_flag: row.accounting_risk_flag || "",
      balance_sheet_signal: row.balance_sheet_signal || "",
    }));
  }

  function buildSectorStats() {
    const byName = new Map();
    state.rows.forEach((row) => {
      const sector = row.sector || "Special Situations";
      if (!byName.has(sector)) {
        byName.set(sector, { name: sector, count: 0, diligence: 0, baseTotal: 0, baseCount: 0, best: row });
      }
      const item = byName.get(sector);
      item.count += 1;
      if (row.tier === "A - Diligence First") item.diligence += 1;
      if (Number.isFinite(row.base_moic)) {
        item.baseTotal += row.base_moic;
        item.baseCount += 1;
      }
      if ((row.overall_rank || Infinity) < (item.best.overall_rank || Infinity)) item.best = row;
    });
    state.sectors = Array.from(byName.values())
      .map((item) => ({ ...item, avgBase: item.baseCount ? item.baseTotal / item.baseCount : null }))
      .sort((a, b) => {
        const ai = sectorOrder.indexOf(a.name);
        const bi = sectorOrder.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.name.localeCompare(b.name);
      });
  }

  function buildCountryStats() {
    const byName = new Map();
    state.rows.forEach((row) => {
      const country = row.country || "Other / Mixed";
      if (!byName.has(country)) byName.set(country, { name: country, count: 0 });
      byName.get(country).count += 1;
    });
    state.countries = Array.from(byName.values()).sort((a, b) => {
      const ai = countryOrder.indexOf(a.name);
      const bi = countryOrder.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || b.count - a.count || a.name.localeCompare(b.name);
    });
  }

  function buildMomentumStats() {
    const byName = new Map();
    state.rows.forEach((row) => {
      const name = row.momentum_signal || "Unknown";
      if (!byName.has(name)) byName.set(name, { name, count: 0 });
      byName.get(name).count += 1;
    });
    state.momentumBuckets = Array.from(byName.values()).sort((a, b) => {
      const ai = momentumOrder.indexOf(a.name);
      const bi = momentumOrder.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || b.count - a.count || a.name.localeCompare(b.name);
    });
  }

  function loadWatchlist() {
    try {
      const keys = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      state.watchlist = new Set(Array.isArray(keys) ? keys : []);
    } catch {
      state.watchlist = new Set();
    }
  }

  function saveWatchlist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state.watchlist)));
  }

  function activeRows() {
    const query = normalize(state.query);
    return state.rows.filter((row) => {
      if (state.tier !== "All" && row.tier !== state.tier) return false;
      if (state.sector !== "All" && row.sector !== state.sector) return false;
      if (state.country !== "All" && row.country !== state.country) return false;
      if (state.momentum !== "All" && row.momentum_signal !== state.momentum) return false;
      if (state.hideAccountingRisk && row.accounting_risk_flag) return false;
      if (state.cashSupportedOnly && !row.balance_sheet_signal) return false;
      if (Number.isFinite(row.base_moic) && row.base_moic < state.minBase) return false;
      if (Number.isFinite(row.clean_score) && row.clean_score < state.minClean) return false;
      if (!query) return true;
      return [
        row.ticker,
        row.company,
        row.theme,
        row.sector,
        row.country,
        row.momentum_signal,
        row.source,
        row.why,
        row.tier,
        row.clean_score,
        row.accounting_risk_flag,
        row.balance_sheet_signal,
      ].some((field) => normalize(field).includes(query));
    });
  }

  function filteredRows() {
    return activeRows().sort((a, b) => {
      if (state.sort === "ticker") return String(a.ticker).localeCompare(String(b.ticker));
      if (state.sort === "sector") return String(a.sector).localeCompare(String(b.sector)) || (a.overall_rank || 0) - (b.overall_rank || 0);
      if (state.sort === "country") return String(a.country).localeCompare(String(b.country)) || (a.overall_rank || 0) - (b.overall_rank || 0);
      if (state.sort === "clean_score" || state.sort === "base_moic" || state.sort === "bull_moic" || state.sort === "momentum_overlay") {
        return (finiteNumber(b[state.sort], -Infinity) - finiteNumber(a[state.sort], -Infinity)) || (a.overall_rank || 0) - (b.overall_rank || 0);
      }
      return (a.overall_rank || 0) - (b.overall_rank || 0);
    });
  }

  function rowByKey(key) {
    return state.rows.find((row) => row._key === key);
  }

  function renderMetrics(payload) {
    const summary = payload.summary || {};
    const tiers = payload.tiers || [];
    const diligence = tiers.find((item) => item.name === "A - Diligence First")?.count || 0;
    const watchlist = tiers.find((item) => item.name === "B - Strong Watchlist")?.count || 0;
    const pending = (payload.pending_top100 || []).length;
    els.coverage.textContent = `${fmt.format(state.rows.length)} exposures`;
    els.metrics.innerHTML = [
      metric("Analyzed", summary.unique_analyzed_names || fmt.format(state.rows.length), "Flattened economic exposures", "blue"),
      metric("Diligence First", summary.diligence_first_names || fmt.format(diligence), "Highest priority bucket", "green"),
      metric("Strong Watchlist", summary.strong_watchlist_names || fmt.format(watchlist), "Second-tier research queue", "amber"),
      metric("Countries", fmt.format(state.countries.length), "Listing-country filters available", "blue"),
      metric("Momentum Confirmed", summary.positive_momentum_names_boosted || "0", "Excellent/good/positive chart action", "green"),
      metric("Focus Missing", summary.focus_top100_names_still_missing_from_pasted_gpt_5_5_pro_scenario_runs || fmt.format(pending), "Sector focus queue remaining", "rose"),
      metric("Accounting Flags", summary.accounting_or_filing_issue_names_penalized || "0", "Penalized in clean-risk rerank", "rose"),
      metric("Cash Support", summary.high_cash_or_balance_sheet_support_names_boosted || "0", "Net-cash, cash-flow, or asset-backed", "green"),
    ].join("");
  }

  function renderSectorControls() {
    const options = ["All", ...state.sectors.map((item) => item.name)];
    els.sectorFilter.innerHTML = options
      .map((sector) => {
        const count = sector === "All" ? state.rows.length : state.sectors.find((item) => item.name === sector)?.count || 0;
        return `<option value="${escapeHtml(sector)}">${escapeHtml(sector)} (${fmt.format(count)})</option>`;
      })
      .join("");
    els.sectorFilter.value = state.sector;
    els.sectorStatus.textContent = `${state.sectors.length} sectors`;
    els.sectorGrid.innerHTML = state.sectors
      .map((item) => {
        const active = item.name === state.sector ? "active" : "";
        const top = item.best || {};
        return `<button class="sector-card ${active}" type="button" data-sector="${escapeHtml(item.name)}">
          <span class="sector-name">${escapeHtml(item.name)}</span>
          <span class="sector-count">${fmt.format(item.count)} names</span>
          <span class="sector-stat">
            <strong>${fmt.format(item.diligence)}</strong>
            <span>A-tier</span>
          </span>
          <span class="sector-foot">
            <span>${escapeHtml(top.ticker || "")}</span>
            <span>${escapeHtml(Number.isFinite(item.avgBase) ? moic(item.avgBase) : "")}</span>
          </span>
        </button>`;
      })
      .join("");
  }

  function renderCountryControls() {
    const options = ["All", ...state.countries.map((item) => item.name)];
    els.countryFilter.innerHTML = options
      .map((country) => {
        const count = country === "All" ? state.rows.length : state.countries.find((item) => item.name === country)?.count || 0;
        return `<option value="${escapeHtml(country)}">${escapeHtml(country)} (${fmt.format(count)})</option>`;
      })
      .join("");
    els.countryFilter.value = state.country;
  }

  function renderMomentumControls() {
    const options = ["All", ...state.momentumBuckets.map((item) => item.name)];
    els.momentumFilter.innerHTML = options
      .map((momentum) => {
        const count = momentum === "All" ? state.rows.length : state.momentumBuckets.find((item) => item.name === momentum)?.count || 0;
        return `<option value="${escapeHtml(momentum)}">${escapeHtml(momentum)} (${fmt.format(count)})</option>`;
      })
      .join("");
    els.momentumFilter.value = state.momentum;
  }

  function renderPriority() {
    const top = state.rows
      .filter((row) => row.tier === "A - Diligence First" && (state.sector === "All" || row.sector === state.sector) && (state.country === "All" || row.country === state.country) && (state.momentum === "All" || row.momentum_signal === state.momentum))
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
    els.tierFilter.value = state.tier;
    els.tierTabs.innerHTML = options
      .map((tier) => {
        const count = tier === "All" ? activeRows().length : activeRows().filter((row) => row.tier === tier).length;
        return `<button class="tier-tab ${tier === state.tier ? "active" : ""}" type="button" data-tier="${escapeHtml(tier)}">
          ${escapeHtml(tierShort(tier))} · ${fmt.format(count)}
        </button>`;
      })
      .join("");
  }

  function renderRangeControls() {
    els.baseMin.value = String(state.minBase);
    els.cleanMin.value = String(state.minClean);
    els.baseMinValue.value = state.minBase <= 0 ? "Any" : moic(state.minBase);
    els.cleanMinValue.value = state.minClean <= -2.5 ? "Any" : score(state.minClean);
  }

  function renderTable() {
    const rows = filteredRows();
    const sectorText = state.sector === "All" ? "all sectors" : state.sector;
    const countryText = state.country === "All" ? "all countries" : state.country;
    const momentumText = state.momentum === "All" ? "all momentum" : state.momentum;
    els.summary.textContent = `${fmt.format(rows.length)} of ${fmt.format(state.rows.length)} exposures shown · ${sectorText} · ${countryText} · ${momentumText}`;
    if (!rows.length) {
      els.body.innerHTML = `<tr><td colspan="13" class="muted">No rows match the current filters.</td></tr>`;
      return;
    }
    els.body.innerHTML = rows
      .flatMap((row) => {
        const pinned = state.watchlist.has(row._key);
        const detailOpen = state.expandedKey === row._key;
        const rowHtml = `<tr class="${pinned ? "is-pinned" : ""}">
          <td>${escapeHtml(row.overall_rank)}</td>
          <td><span class="ticker-link">${escapeHtml(row.ticker)}</span></td>
          <td>${escapeHtml(row.company)}</td>
          <td><span class="sector-pill">${escapeHtml(row.sector)}</span></td>
          <td><span class="country-pill">${escapeHtml(row.country)}</span></td>
          <td><span class="tier-badge">${escapeHtml(tierShort(row.tier))}</span></td>
          <td>${escapeHtml(moic(row.base_moic))}</td>
          <td>${escapeHtml(moic(row.bull_moic))}</td>
          <td>${escapeHtml(score(row.clean_score))}</td>
          <td>${escapeHtml(row.momentum_signal || "Unknown")}</td>
          <td>${escapeHtml(row.source)}</td>
          <td class="why-cell">${overlayPills(row)}${escapeHtml(row.why)}</td>
          <td class="row-actions">
            <button class="icon-button" type="button" data-action="watch" data-key="${escapeHtml(row._key)}" title="${pinned ? "Remove from pinned list" : "Pin to local list"}">${pinned ? "Pinned" : "Pin"}</button>
            <button class="icon-button" type="button" data-action="details" data-key="${escapeHtml(row._key)}" title="Toggle details">${detailOpen ? "Less" : "More"}</button>
          </td>
        </tr>`;
        if (!detailOpen) return [rowHtml];
        const detailHtml = `<tr class="detail-row">
          <td colspan="13">
            <div class="row-detail">
              <div>
                <span class="detail-label">Theme</span>
                <strong>${escapeHtml(row.theme)}</strong>
              </div>
              <div>
                <span class="detail-label">Source batch</span>
                <strong>${escapeHtml(row.source)} · Rank ${escapeHtml(row.source_rank || "")}</strong>
              </div>
              <div>
                <span class="detail-label">Country</span>
                <strong>${escapeHtml(row.country)}</strong>
              </div>
              <div>
                <span class="detail-label">Clean-risk score</span>
                <strong>${escapeHtml(score(row.clean_score))}</strong>
              </div>
              <div>
                <span class="detail-label">Momentum</span>
                <strong>${escapeHtml(row.momentum_signal || "Unknown")} · ${escapeHtml(score(row.momentum_overlay))}</strong>
              </div>
              <div>
                <span class="detail-label">Risk overlay</span>
                <strong>${escapeHtml([
                  row.accounting_risk_flag ? `Accounting: ${row.accounting_risk_flag}` : "",
                  row.balance_sheet_signal ? `Balance sheet: ${row.balance_sheet_signal}` : "",
                  row.accounting_cash_overlay ? `Score overlay: ${score(row.accounting_cash_overlay)}` : "",
                ].filter(Boolean).join(" · ") || "No explicit overlay flag")}</strong>
              </div>
              <button class="utility-button compact" type="button" data-action="copy-row" data-key="${escapeHtml(row._key)}">Copy row</button>
            </div>
          </td>
        </tr>`;
        return [rowHtml, detailHtml];
      })
      .join("");
  }

  function renderWatchlist() {
    const rows = state.rows
      .filter((row) => state.watchlist.has(row._key))
      .sort((a, b) => (a.overall_rank || 0) - (b.overall_rank || 0));
    els.watchlistStatus.textContent = `${rows.length} pinned`;
    if (!rows.length) {
      els.watchlistGrid.innerHTML = `<p class="empty-note">Pinned names stay in this browser.</p>`;
      return;
    }
    els.watchlistGrid.innerHTML = rows
      .map(
        (row) => `<article class="watch-card">
          <div class="watch-top">
            <span>#${escapeHtml(row.overall_rank)}</span>
            <button class="icon-button compact" type="button" data-action="watch" data-key="${escapeHtml(row._key)}">Remove</button>
          </div>
          <strong>${escapeHtml(row.ticker)}</strong>
          <p>${escapeHtml(row.company)}</p>
          <div class="watch-meta">
            <span>${escapeHtml(row.sector)}</span>
            <span>${escapeHtml(row.country)}</span>
            <span>${escapeHtml(moic(row.base_moic))}</span>
          </div>
        </article>`
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

  function renderInteractive() {
    renderSectorControls();
    renderCountryControls();
    renderMomentumControls();
    renderPriority();
    renderTierControls();
    renderRangeControls();
    renderTable();
    renderWatchlist();
  }

  function renderAll(payload) {
    renderMetrics(payload);
    renderInteractive();
    renderPending();
  }

  function rowText(row) {
    return `${row.overall_rank}. ${row.ticker} - ${row.company}
Sector: ${row.sector}
Country: ${row.country}
Momentum: ${row.momentum_signal || "Unknown"} (${score(row.momentum_overlay)})
Tier: ${row.tier}
Base/Bull MOIC: ${moic(row.base_moic)} / ${moic(row.bull_moic)}
Clean-risk score: ${score(row.clean_score)}
Risk overlay: ${[
  row.accounting_risk_flag ? `Accounting ${row.accounting_risk_flag}` : "",
  row.balance_sheet_signal || "",
  row.accounting_cash_overlay ? `overlay ${score(row.accounting_cash_overlay)}` : "",
].filter(Boolean).join(" / ") || "none"}
Source: ${row.source}
Read: ${row.why}`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCsv() {
    const columns = ["overall_rank", "ticker", "company", "sector", "country", "tier", "base_moic", "bull_moic", "clean_score", "momentum_signal", "momentum_overlay", "accounting_risk_flag", "balance_sheet_signal", "accounting_cash_overlay", "source", "theme", "why"];
    const rows = filteredRows();
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gpt55-repass-filtered.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${fmt.format(rows.length)} rows exported`);
  }

  async function copyText(text, message) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      showToast(message);
    } catch {
      showToast("Copy failed");
    }
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => els.toast.classList.remove("visible"), 1800);
  }

  function resetFilters() {
    state.query = "";
    state.tier = "All";
    state.sector = "All";
    state.country = "All";
    state.momentum = "All";
    state.sort = "overall_rank";
    state.minBase = 0;
    state.minClean = -2.5;
    state.hideAccountingRisk = false;
    state.cashSupportedOnly = false;
    state.expandedKey = "";
    els.search.value = "";
    els.sort.value = state.sort;
    els.hideAccountingRisk.checked = false;
    els.cashSupportedOnly.checked = false;
    renderInteractive();
  }

  function toggleWatch(key) {
    if (state.watchlist.has(key)) {
      state.watchlist.delete(key);
    } else {
      state.watchlist.add(key);
    }
    saveWatchlist();
    renderTable();
    renderWatchlist();
  }

  function bindEvents() {
    els.search.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderTierControls();
      renderTable();
    });
    els.sort.addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderTable();
    });
    els.sectorFilter.addEventListener("change", (event) => {
      state.sector = event.target.value;
      state.expandedKey = "";
      renderInteractive();
    });
    els.countryFilter.addEventListener("change", (event) => {
      state.country = event.target.value;
      state.expandedKey = "";
      renderInteractive();
    });
    els.momentumFilter.addEventListener("change", (event) => {
      state.momentum = event.target.value;
      state.expandedKey = "";
      renderInteractive();
    });
    els.tierFilter.addEventListener("change", (event) => {
      state.tier = event.target.value;
      state.expandedKey = "";
      renderTierControls();
      renderTable();
    });
    els.baseMin.addEventListener("input", (event) => {
      state.minBase = Number(event.target.value);
      state.expandedKey = "";
      renderTierControls();
      renderRangeControls();
      renderTable();
    });
    els.cleanMin.addEventListener("input", (event) => {
      state.minClean = Number(event.target.value);
      state.expandedKey = "";
      renderTierControls();
      renderRangeControls();
      renderTable();
    });
    els.hideAccountingRisk.addEventListener("change", (event) => {
      state.hideAccountingRisk = event.target.checked;
      state.expandedKey = "";
      renderTierControls();
      renderTable();
    });
    els.cashSupportedOnly.addEventListener("change", (event) => {
      state.cashSupportedOnly = event.target.checked;
      state.expandedKey = "";
      renderTierControls();
      renderTable();
    });
    els.resetFilters.addEventListener("click", resetFilters);
    els.exportCsv.addEventListener("click", downloadCsv);
    els.tierTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tier]");
      if (!button) return;
      state.tier = button.dataset.tier;
      state.expandedKey = "";
      renderTierControls();
      renderTable();
    });
    els.sectorGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sector]");
      if (!button) return;
      state.sector = state.sector === button.dataset.sector ? "All" : button.dataset.sector;
      state.expandedKey = "";
      renderInteractive();
    });
    els.body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const key = button.dataset.key;
      const row = rowByKey(key);
      if (button.dataset.action === "watch") {
        toggleWatch(key);
      } else if (button.dataset.action === "details") {
        state.expandedKey = state.expandedKey === key ? "" : key;
        renderTable();
      } else if (button.dataset.action === "copy-row" && row) {
        copyText(rowText(row), "Row copied");
      }
    });
    els.watchlistGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='watch']");
      if (!button) return;
      toggleWatch(button.dataset.key);
    });
    els.copyWatchlist.addEventListener("click", () => {
      const rows = state.rows.filter((row) => state.watchlist.has(row._key)).sort((a, b) => (a.overall_rank || 0) - (b.overall_rank || 0));
      copyText(rows.map(rowText).join("\n\n"), rows.length ? "Pinned list copied" : "No pinned names");
    });
    els.clearWatchlist.addEventListener("click", () => {
      state.watchlist.clear();
      saveWatchlist();
      renderTable();
      renderWatchlist();
    });
    window.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName;
      if (event.key !== "/" || ["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      event.preventDefault();
      els.search.focus();
    });
  }

  async function init() {
    bindEvents();
    loadWatchlist();
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    state.rows = hydrateRows(payload.rows || []);
    state.pending = payload.pending_top100 || [];
    state.tiers = payload.tiers || [];
    buildSectorStats();
    buildCountryStats();
    buildMomentumStats();
    renderAll(payload);
  }

  init().catch((error) => {
    els.coverage.textContent = "Failed";
    els.body.innerHTML = `<tr><td colspan="13" class="muted">${escapeHtml(error.message)}</td></tr>`;
  });
})();
