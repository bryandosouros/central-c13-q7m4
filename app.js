(() => {
  "use strict";

  const PAGE_SIZE = 30;
  const state = {
    snapshot: null,
    rows: [],
    filteredRows: [],
    currentPage: 1,
    loading: false,
  };

  const elements = {
    syncState: document.querySelector("#sync-state"),
    syncLabel: document.querySelector("#sync-label"),
    updatedAt: document.querySelector("#updated-at"),
    refreshPolicy: document.querySelector("#refresh-policy"),
    reload: document.querySelector("#reload-button"),
    message: document.querySelector("#global-message"),
    metricTotal: document.querySelector("#metric-total"),
    metricComplete: document.querySelector("#metric-complete"),
    metricPending: document.querySelector("#metric-pending"),
    metricUnknown: document.querySelector("#metric-unknown"),
    metricCoverage: document.querySelector("#metric-coverage"),
    coverageBar: document.querySelector(".coverage-bar"),
    coverageFill: document.querySelector("#coverage-fill"),
    coverageCaption: document.querySelector("#coverage-caption"),
    filters: document.querySelector("#filters"),
    search: document.querySelector("#filter-search"),
    party: document.querySelector("#filter-party"),
    side: document.querySelector("#filter-side"),
    status: document.querySelector("#filter-status"),
    clearFilters: document.querySelector("#clear-filters"),
    resultCount: document.querySelector("#result-count"),
    tableBody: document.querySelector("#audit-table-body"),
    emptyState: document.querySelector("#empty-state"),
    pageSummary: document.querySelector("#page-summary"),
    previousPage: document.querySelector("#previous-page"),
    nextPage: document.querySelector("#next-page"),
    footerSource: document.querySelector("#footer-source"),
  };

  async function loadSnapshot(force = false) {
    if (state.loading) return;
    setLoading(true);

    try {
      const suffix = force ? `?refresh=${Date.now()}` : "";
      const response = await fetch(`./data/snapshot.json${suffix}`, { cache: force ? "no-store" : "default" });
      if (!response.ok) throw new Error(`O snapshot respondeu com status ${response.status}.`);
      const snapshot = await response.json();
      if (snapshot.schemaVersion !== 3 || !Array.isArray(snapshot.rows)) throw new Error("O snapshot está em um formato incompatível.");

      state.snapshot = snapshot;
      state.rows = snapshot.rows;
      state.currentPage = 1;
      populatePartyFilter(snapshot.parties);
      renderOverview();
      renderFreshness();
      applyFilters();
      elements.message.className = "global-message";
      elements.message.textContent = "";
    } catch (error) {
      renderError(error);
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading) {
    state.loading = loading;
    elements.reload.disabled = loading;
    elements.reload.classList.toggle("is-loading", loading);
    elements.filters.querySelectorAll("input, select").forEach((control) => { control.disabled = loading; });
    if (loading) {
      elements.syncState.dataset.state = "loading";
      elements.syncLabel.textContent = "Sincronizando painel";
    }
  }

  function populatePartyFilter(parties) {
    const current = elements.party.value || "all";
    elements.party.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
    parties.forEach((party) => {
      const option = document.createElement("option");
      option.value = party.code;
      option.textContent = `${party.code} · ${party.label}`;
      elements.party.append(option);
    });
    elements.party.value = parties.some((party) => party.code === current) ? current : "all";
  }

  function renderOverview() {
    const { totals, rows } = state.snapshot;
    elements.metricTotal.textContent = formatNumber(totals.electors);
    elements.metricComplete.textContent = formatNumber(totals.complete);
    elements.metricPending.textContent = formatNumber(totals.pending);
    elements.metricUnknown.textContent = formatNumber(totals.unknown);

    const alliedRows = rows.filter((row) => row.parties.some((party) => party.side === "favor"));
    const passed = alliedRows.reduce((sum, row) => sum + row.audit.passed, 0);
    const possible = alliedRows.length * 5;
    const coverage = possible ? Math.round((passed / possible) * 100) : 0;
    elements.metricCoverage.textContent = `${coverage}%`;
    elements.coverageFill.style.width = `${coverage}%`;
    elements.coverageBar.setAttribute("aria-valuenow", String(coverage));
    elements.coverageCaption.textContent = `${formatNumber(passed)} de ${formatNumber(possible)} comprovações aliadas confirmadas`;
  }

  function renderFreshness() {
    const generated = new Date(state.snapshot.generatedAt);
    const validDate = !Number.isNaN(generated.getTime());
    elements.updatedAt.textContent = validDate
      ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(generated)
      : "Horário indisponível";
    const profilePolicy = state.snapshot.refreshPolicy.systemProfiles || state.snapshot.refreshPolicy.system;
    const voterPolicy = state.snapshot.refreshPolicy.systemVoterTitle || state.snapshot.refreshPolicy.habbo;
    elements.refreshPolicy.textContent = `Habbo: ${state.snapshot.refreshPolicy.habbo} · Perfis SYSTEM: ${profilePolicy} · Títulos TSE: ${voterPolicy}`;
    elements.syncState.dataset.state = "ready";
    elements.syncLabel.textContent = validDate ? `Atualizado ${formatRelative(generated)}` : "Snapshot carregado";

    const { requestMetrics } = state.snapshot;
    const tseHolders = state.snapshot.sourceStatus?.systemVoterCards?.holderCount;
    const tseLabel = Number.isFinite(tseHolders) ? ` · TSE: ${formatNumber(tseHolders)} portadores` : "";
    elements.footerSource.textContent = `Fonte: Habbo + SYSTEM${tseLabel} · ${requestMetrics.habboRequests} leituras Habbo · ${requestMetrics.systemRequests} leituras SYSTEM`;
  }

  function applyFilters() {
    if (!state.snapshot) return;
    const search = normalize(elements.search.value);
    const party = elements.party.value;
    const side = elements.side.value;
    const status = elements.status.value;

    state.filteredRows = state.rows.filter((row) => {
      const matchesSearch = !search || normalize(row.name).includes(search) || normalize(row.uniqueId).includes(search);
      const matchesParty = party === "all" || row.parties.some((item) => item.code === party);
      const matchesSide = side === "all" || row.parties.some((item) => item.side === side);
      const habboPending = row.habbo.deputy === false || row.habbo.voterTitle === false;
      const systemPending = row.system.party === false || row.system.voterTitle === false;
      const matchesStatus = status === "all"
        || (status === "complete" && row.audit.complete)
        || (status === "pending" && row.audit.hasPending)
        || (status === "habbo-pending" && habboPending)
        || (status === "system-pending" && systemPending)
        || (status === "unknown" && row.audit.hasUnknown)
        || (status === "multiple" && row.audit.multipleParties);
      return matchesSearch && matchesParty && matchesSide && matchesStatus;
    });

    const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
    state.currentPage = Math.min(state.currentPage, totalPages);
    renderTable();
  }

  function renderTable() {
    const total = state.filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (state.currentPage - 1) * PAGE_SIZE;
    const rows = state.filteredRows.slice(start, start + PAGE_SIZE);

    elements.tableBody.replaceChildren(...rows.map(createRow));
    elements.emptyState.hidden = total > 0;
    elements.resultCount.textContent = formatNumber(total);
    elements.pageSummary.textContent = total
      ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} de ${total} · página ${state.currentPage}/${totalPages}`
      : "Nenhum eleitor corresponde aos filtros";
    elements.previousPage.disabled = state.currentPage <= 1;
    elements.nextPage.disabled = state.currentPage >= totalPages;
  }

  function createRow(row) {
    const tr = document.createElement("tr");

    const identity = document.createElement("td");
    identity.className = "identity-cell";
    identity.dataset.label = "Eleitor";
    const initial = document.createElement("span");
    initial.className = "identity-initial";
    initial.textContent = row.name.slice(0, 1).toLocaleUpperCase("pt-BR");
    const identityCopy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = row.name;
    const id = document.createElement("small");
    id.textContent = row.uniqueId;
    identityCopy.append(name, id);
    identity.append(initial, identityCopy);

    const affiliation = document.createElement("td");
    affiliation.className = "affiliation-cell";
    affiliation.dataset.label = "Filiação";
    const tags = document.createElement("div");
    tags.className = "party-tags";
    row.parties.forEach((party) => tags.append(createPartyTag(party)));
    affiliation.append(tags);
    if (row.audit.multipleParties) {
      const multiple = document.createElement("small");
      multiple.className = "multiple-note";
      multiple.textContent = "Múltiplas filiações";
      affiliation.append(multiple);
    }

    const habboDeputy = createCheckCell("Deputado no Habbo", row.habbo.deputy);
    const habboVoter = createCheckCell("Título no Habbo", row.habbo.voterTitle);
    const systemParty = createCheckCell("Partido no SYSTEM", row.system.party, systemPartyTitle(row));
    const systemVoter = createCheckCell("Título no TSE", row.system.voterTitle, systemStatusTitle(row));

    const result = document.createElement("td");
    result.className = "result-cell";
    result.dataset.label = "Resultado";
    const score = document.createElement("span");
    score.className = `score-badge ${row.audit.complete ? "score-badge--complete" : row.audit.hasUnknown ? "score-badge--unknown" : "score-badge--pending"}`;
    score.textContent = `${row.audit.passed}/5`;
    const resultCopy = document.createElement("span");
    const resultTitle = document.createElement("strong");
    resultTitle.textContent = row.audit.complete ? "Regularizado" : row.audit.hasUnknown ? "Revisar fonte" : pluralize(row.audit.failed.length, "pendência", "pendências");
    const resultDetail = document.createElement("small");
    resultDetail.textContent = issueSummary(row);
    resultCopy.append(resultTitle, resultDetail);
    result.append(score, resultCopy);

    tr.append(identity, affiliation, habboDeputy, habboVoter, systemParty, systemVoter, result);
    return tr;
  }

  function createPartyTag(party) {
    const tag = document.createElement("span");
    tag.className = `party-tag party-tag--${party.side}`;
    tag.textContent = party.code;
    tag.title = party.label;
    return tag;
  }

  function createCheckCell(label, value, title = "") {
    const cell = document.createElement("td");
    cell.className = "check-cell";
    cell.dataset.label = label;
    const badge = document.createElement("span");
    badge.className = `check-badge ${value === true ? "check-badge--pass" : value === false ? "check-badge--fail" : "check-badge--unknown"}`;
    badge.textContent = value === true ? "✓" : value === false ? "×" : "—";
    badge.setAttribute("aria-label", value === true ? "Consta" : value === false ? "Pendente" : "Não avaliado");
    if (title) badge.title = title;
    cell.append(badge);
    return cell;
  }

  function issueSummary(row) {
    const labels = {
      habboDeputy: "Deputado Habbo",
      habboVoterTitle: "Título Habbo",
      systemParty: "Partido SYSTEM",
      systemVoterTitle: "Título TSE",
    };
    const issues = [...row.audit.failed, ...row.audit.unknown].map((key) => labels[key]).filter(Boolean);
    if (!issues.length && row.audit.multipleParties) return "Atenção à filiação múltipla";
    if (!issues.length) return "Todos os requisitos confirmados";
    return issues.slice(0, 2).join(" · ") + (issues.length > 2 ? ` +${issues.length - 2}` : "");
  }

  function systemPartyTitle(row) {
    if (row.system.status === "not_found") return "Conta não encontrada no SYSTEM";
    if (row.system.partyCodes.length) return `Partidos no SYSTEM: ${row.system.partyCodes.join(", ")}`;
    return row.system.party === null ? "SYSTEM indisponível nesta atualização" : "Nenhum partido correspondente no SYSTEM";
  }

  function systemStatusTitle(row) {
    if (row.system.voterTitleStatus !== "ok") return "Cadastro de carteirinhas do TSE indisponível nesta atualização";
    return row.system.voterTitle ? "Título localizado entre os portadores do TSE" : "Título não localizado entre os portadores do TSE";
  }

  function renderError(error) {
    elements.syncState.dataset.state = "error";
    elements.syncLabel.textContent = "Dados indisponíveis";
    elements.message.className = "global-message global-message--error";
    elements.message.textContent = `Não foi possível carregar a auditoria. ${error.message || "Tente novamente em instantes."}`;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "table-error";
    cell.textContent = "O snapshot ainda não está disponível.";
    row.append(cell);
    elements.tableBody.replaceChildren(row);
  }

  function normalize(value = "") {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("pt-BR").format(value || 0);
  }

  function formatRelative(date) {
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "agora";
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    return `há ${Math.floor(hours / 24)} d`;
  }

  function pluralize(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
  }

  function registerWebMcpTool() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "query_electoral_audit",
        title: "Filtrar auditoria eleitoral",
        description: "Filtra o snapshot já carregado por eleitor, partido, bloco ou situação sem consultar APIs externas.",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", maxLength: 64 },
            party: { type: "string" },
            side: { type: "string", enum: ["all", "favor", "oposicao"] },
            status: { type: "string", enum: ["all", "complete", "pending", "habbo-pending", "system-pending", "unknown", "multiple"] },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input = {}) {
          if (!state.snapshot) throw new Error("O snapshot ainda não foi carregado.");
          const validParties = ["all", ...state.snapshot.parties.map((party) => party.code)];
          if (input.party && !validParties.includes(input.party)) throw new TypeError("Partido inválido.");
          elements.search.value = input.search || "";
          elements.party.value = input.party || "all";
          elements.side.value = input.side || "all";
          elements.status.value = input.status || "all";
          state.currentPage = 1;
          applyFilters();
          return {
            total: state.filteredRows.length,
            rows: state.filteredRows.slice(0, 25).map((row) => ({
              username: row.name,
              parties: row.parties.map((party) => party.code),
              score: `${row.audit.passed}/5`,
              failed: row.audit.failed,
              unknown: row.audit.unknown,
            })),
            truncated: state.filteredRows.length > 25,
          };
        },
      }, { signal: lifecycle.signal })).catch(() => lifecycle.abort());
    } catch {
      lifecycle.abort();
    }
  }

  elements.filters.addEventListener("input", () => { state.currentPage = 1; applyFilters(); });
  elements.filters.addEventListener("change", () => { state.currentPage = 1; applyFilters(); });
  elements.filters.addEventListener("submit", (event) => event.preventDefault());
  elements.clearFilters.addEventListener("click", () => { elements.filters.reset(); state.currentPage = 1; applyFilters(); });
  elements.reload.addEventListener("click", () => loadSnapshot(true));
  elements.previousPage.addEventListener("click", () => { if (state.currentPage > 1) { state.currentPage -= 1; renderTable(); } });
  elements.nextPage.addEventListener("click", () => {
    const pages = Math.ceil(state.filteredRows.length / PAGE_SIZE);
    if (state.currentPage < pages) { state.currentPage += 1; renderTable(); }
  });

  if (window.location.search) history.replaceState(null, "", window.location.pathname);
  registerWebMcpTool();
  loadSnapshot();
})();
