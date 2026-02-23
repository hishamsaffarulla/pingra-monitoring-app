// Status page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';

let statusMonitors = [];
const AUTO_REFRESH_SECONDS = 30;
let refreshCountdown = AUTO_REFRESH_SECONDS;
let refreshTimerId = null;
let historyOffsetDays = 0;
const historyWindowDays = 7;
let compactMode = false;

function showStatusMessage(message, title = 'Notice') {
    const titleEl = document.getElementById('status-feedback-title');
    const messageEl = document.getElementById('status-feedback-message');
    const modal = document.getElementById('status-feedback-modal');
    if (!modal) return;
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message || '';
    modal.classList.add('active');
}

function normalizeStatus(value) {
    if (value === 'up' || value === 'down' || value === 'degraded') {
        return value;
    }
    // Keep status UI to three states only.
    return 'degraded';
}

function getStatusSymbol(status) {
    if (status === 'up') return '\u25B2';
    if (status === 'down') return '\u2715';
    return '!';
}

function getReadableStatus(status) {
    if (status === 'up') return 'Operational';
    if (status === 'down') return 'Major Outage';
    return 'Partial Outage';
}

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    const refreshButton = document.getElementById('refresh-btn');
    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            refreshCountdown = AUTO_REFRESH_SECONDS;
            updateRefreshButton();
            await loadStatusPage();
        });
    }

    const olderBtn = document.getElementById('older-btn');
    if (olderBtn) {
        olderBtn.addEventListener('click', async () => {
            historyOffsetDays += historyWindowDays;
            updateHistoryButtons();
            await loadStatusPage();
        });
    }

    const newerBtn = document.getElementById('newer-btn');
    if (newerBtn) {
        newerBtn.addEventListener('click', async () => {
            historyOffsetDays = Math.max(0, historyOffsetDays - historyWindowDays);
            updateHistoryButtons();
            await loadStatusPage();
        });
    }

    const recentBtn = document.getElementById('recent-btn');
    if (recentBtn) {
        recentBtn.addEventListener('click', async () => {
            historyOffsetDays = 0;
            updateHistoryButtons();
            await loadStatusPage();
        });
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = window.location.href;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(url);
                }
                showStatusMessage('Status page link copied.', 'Share');
            } catch {
                showStatusMessage(url, 'Copy This Link');
            }
        });
    }

    const customizeBtn = document.getElementById('customize-btn');
    if (customizeBtn) {
        customizeBtn.addEventListener('click', () => {
            window.location.href = '/settings.html#general';
        });
    }

    const gridBtn = document.getElementById('grid-view-btn');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            compactMode = !compactMode;
            gridBtn.classList.toggle('is-active', compactMode);
            renderStatusTable(filterStatusMonitors((document.getElementById('status-search')?.value || '').trim()));
        });
    }

    const filterBtn = document.getElementById('filter-btn');
    if (filterBtn) {
        filterBtn.addEventListener('click', () => {
            const input = document.getElementById('status-search');
            if (input) input.focus();
        });
    }

    const feedbackOkBtn = document.getElementById('status-feedback-ok-btn');
    if (feedbackOkBtn) {
        feedbackOkBtn.addEventListener('click', () => {
            const modal = document.getElementById('status-feedback-modal');
            if (modal) modal.classList.remove('active');
        });
    }

    loadStatusPage();
    startRefreshCountdown();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    const searchInput = document.getElementById('status-search');
    const sideSearchInput = document.getElementById('status-search-side');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (sideSearchInput && sideSearchInput.value !== searchInput.value) {
                sideSearchInput.value = searchInput.value;
            }
            renderStatusTable(filterStatusMonitors(searchInput.value));
        });
    }
    if (sideSearchInput) {
        sideSearchInput.addEventListener('input', () => {
            if (searchInput && searchInput.value !== sideSearchInput.value) {
                searchInput.value = sideSearchInput.value;
            }
            renderStatusTable(filterStatusMonitors(sideSearchInput.value));
        });
    }

    updateHistoryButtons();
});

function startRefreshCountdown() {
    if (refreshTimerId !== null) {
        clearInterval(refreshTimerId);
    }

    refreshCountdown = AUTO_REFRESH_SECONDS;
    updateRefreshButton();

    refreshTimerId = setInterval(async () => {
        refreshCountdown -= 1;

        if (refreshCountdown <= 0) {
            refreshCountdown = AUTO_REFRESH_SECONDS;
            updateRefreshButton();
            await loadStatusPage();
            return;
        }

        updateRefreshButton();
    }, 1000);
}

function updateRefreshButton() {
    const refreshButton = document.getElementById('refresh-btn');
    if (refreshButton) {
        refreshButton.textContent = `< ${refreshCountdown}s >`;
    }

    const countdownEl = document.getElementById('refresh-countdown');
    if (countdownEl) countdownEl.textContent = `${refreshCountdown}s`;
}

function updateHistoryButtons() {
    const newerBtn = document.getElementById('newer-btn');
    const olderBtn = document.getElementById('older-btn');
    const recentBtn = document.getElementById('recent-btn');
    if (newerBtn) {
        newerBtn.disabled = historyOffsetDays === 0;
    }
    if (olderBtn) {
        olderBtn.textContent = '\u2039 Older';
    }
    if (recentBtn) {
        recentBtn.classList.toggle('active', historyOffsetDays === 0);
    }
}

async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    });

    if (response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
        return;
    }

    if (!response.ok) {
        const errorText = await response.text();
        let message = 'Request failed';
        try {
            const parsed = errorText ? JSON.parse(errorText) : null;
            if (parsed && parsed.message) message = parsed.message;
        } catch {
            if (errorText) message = errorText;
        }
        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function getStatusMonitorIds() {
    const raw = localStorage.getItem('pingra_status_monitors');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function loadStatusPage() {
    const table = document.getElementById('status-table');
    table.innerHTML = '<div class="loading">Loading status...</div>';

    const statusIds = getStatusMonitorIds();
    if (statusIds.length === 0) {
        table.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Services on Status Page</div><div class="empty-state-text">Go to Monitors and click "Add Status"</div></div>';
        return;
    }

    try {
        const data = await apiRequest('/monitors');
        const allMonitors = data.monitors || data;
        const selected = allMonitors.filter(m => statusIds.includes(m.id));

        if (selected.length === 0) {
            table.innerHTML = '<div class="empty-state"><div class="empty-state-title">No Services on Status Page</div><div class="empty-state-text">Go to Monitors and click "Add Status"</div></div>';
            return;
        }

        statusMonitors = await Promise.all(selected.map(async monitor => {
            let status = 'degraded';
            let uptime = null;
            let uptimeValue = null;
            let latestCheck = null;
            let dailyStatusMap = {};

            try {
                const current = await apiRequest(`/monitors/${monitor.id}/status`);
                if (current && current.currentStatus) {
                    status = normalizeStatus(current.currentStatus);
                }
                if (current && current.latestCheck) {
                    latestCheck = current.latestCheck;
                }
            } catch {
                // No status yet
            }

            try {
                const stats = await apiRequest(`/monitors/${monitor.id}/uptime?period=7d`);
                if (stats && typeof stats.uptimePercentage === 'number') {
                    uptimeValue = Number(stats.uptimePercentage.toFixed(4));
                    uptime = uptimeValue.toFixed(4) + '%';
                }
            } catch {
                // Ignore stats errors
            }

            try {
                const daily = await apiRequest(`/monitors/${monitor.id}/daily-status?days=${historyWindowDays}&offsetDays=${historyOffsetDays}`);
                const rows = daily && daily.daily ? daily.daily : [];
                rows.forEach(row => {
                    if (row.date && row.status) {
                        dailyStatusMap[row.date] = normalizeStatus(row.status);
                    }
                });
            } catch {
                // Ignore daily status errors
            }

            return { ...monitor, status, uptime, uptimeValue, latestCheck, dailyStatusMap };
        }));

        renderStatusTable(statusMonitors);
        updateOverallUptime(statusMonitors);
        updateStatusKpis(statusMonitors);
        document.getElementById('last-updated').textContent = new Date().toLocaleString();
    } catch {
        table.innerHTML = '<div class="empty-state"><div class="empty-state-title">Failed to load status</div><div class="empty-state-text">Refresh the page to retry</div></div>';
    }
}

function updateOverallUptime(monitors) {
    const uptimeValues = monitors
        .map(m => m.uptime)
        .filter(Boolean)
        .map(value => parseFloat(value));

    const overall = uptimeValues.length
        ? (uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length).toFixed(4) + '%'
        : '--';

    document.getElementById('overall-uptime').textContent = `Overall Uptime: ${overall}`;
    const inline = document.getElementById('overall-uptime-inline');
    if (inline) inline.textContent = `\u2303 ${overall} Overall Uptime`;
}

function updateStatusKpis(monitors) {
    const total = monitors.length;
    const operational = monitors.filter((m) => normalizeStatus(m.status) === 'up').length;
    const degraded = monitors.filter((m) => normalizeStatus(m.status) === 'degraded').length;
    const outage = monitors.filter((m) => normalizeStatus(m.status) === 'down').length;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    };

    setText('kpi-operational', operational);
    setText('kpi-degraded', degraded);
    setText('kpi-outage', outage);
    setText('kpi-total', total);
}

function renderStatusTable(monitors) {
    const table = document.getElementById('status-table');
    if (!monitors.length) {
        table.innerHTML = '<div class="empty-state"><div class="empty-state-title">No matching services</div><div class="empty-state-text">Try a different search</div></div>';
        return;
    }

    const days = getLastDays(historyWindowDays, historyOffsetDays);
    const currentDayKey = new Date().toISOString().slice(0, 10);

    const serviceClass = compactMode ? 'status-service-name compact' : 'status-service-name';
    const uptimeClass = compactMode ? 'status-uptime compact' : 'status-uptime';

    table.innerHTML = `
        <div class="status-table-header">
            <div>Service</div>
            <div>Uptime</div>
            ${days.map(day => `<div>${day.label}</div>`).join('')}
        </div>
        ${monitors.map(monitor => `
            <div class="status-table-row">
                <div class="status-service">
                    <span class="status-dot status-${normalizeStatus(monitor.status)}"></span>
                    <div>
                        <div class="${serviceClass}">${escapeHtml(monitor.name)}</div>
                        <div class="status-service-url">${escapeHtml(monitor.url)}</div>
                        <div class="status-service-state status-${normalizeStatus(monitor.status)}">${getReadableStatus(normalizeStatus(monitor.status))}</div>
                    </div>
                </div>
                <div class="${uptimeClass}">
                    <div>${monitor.uptime || '—'}</div>
                    <div class="status-uptime-track">
                        <div class="status-uptime-fill" style="width:${Math.max(0, Math.min(100, Number(monitor.uptimeValue || 0)))}%"></div>
                    </div>
                </div>
                ${days.map(day => {
                    const key = day.key;
                    const dayStatus = (historyOffsetDays === 0 && key === currentDayKey)
                        ? normalizeStatus(monitor.status)
                        : normalizeStatus(monitor.dailyStatusMap && monitor.dailyStatusMap[key] ? monitor.dailyStatusMap[key] : 'degraded');
                    return `<div class="status-day"><span class="status-pill status-${dayStatus}" title="${dayStatus}">${getStatusSymbol(dayStatus)}</span></div>`;
                }).join('')}
            </div>
        `).join('')}
    `;
}

function filterStatusMonitors(term) {
    if (!term) return statusMonitors;
    const lower = term.toLowerCase();
    return statusMonitors.filter(monitor =>
        monitor.name.toLowerCase().includes(lower) ||
        monitor.url.toLowerCase().includes(lower)
    );
}

function getLastDays(count, offsetDays = 0) {
    const days = [];
    const now = new Date();
    now.setDate(now.getDate() - offsetDays);
    for (let i = count - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const key = date.toISOString().slice(0, 10);
        const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        days.push({ key, label });
    }
    return days;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}




