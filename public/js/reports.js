// Reports page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';

const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
}

let currentReportData = null;

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...(options.headers || {})
        }
    });

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

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleString();
}

function getSelectedMonth() {
    return document.getElementById('report-month').value;
}

function setCurrentMonthDefault() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const value = `${now.getFullYear()}-${month}`;
    document.getElementById('report-month').value = value;
}

function applySummary(summary) {
    document.getElementById('overall-uptime').textContent = `${Number(summary.overallUptime || 0).toFixed(2)}%`;
    document.getElementById('avg-response-time').textContent = `${summary.avgResponseTime || 0}ms`;
    document.getElementById('total-incidents').textContent = String(summary.totalIncidents || 0);
    document.getElementById('total-downtime').textContent = `${summary.totalDowntimeMinutes || 0}m`;
}

function renderMonthlyIncidents(incidents) {
    const container = document.getElementById('monthly-incidents-list');
    if (!incidents || incidents.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F4C5;</div><div class="empty-state-title">No Incidents</div><div class="empty-state-text">No incidents found for selected month</div></div>';
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Service</th>
                        <th>Started</th>
                        <th>Resolved</th>
                        <th>Downtime</th>
                    </tr>
                </thead>
                <tbody>
                    ${incidents.map(incident => `
                        <tr>
                            <td>${incident.title || '-'}</td>
                            <td>${incident.severity || '-'}</td>
                            <td>${incident.status || '-'}</td>
                            <td>${incident.monitorName || '-'}</td>
                            <td>${formatDate(incident.createdAt)}</td>
                            <td>${formatDate(incident.resolvedAt)}</td>
                            <td>${incident.downtimeMinutes || 0}m</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadMonthlyReport() {
    const month = getSelectedMonth();
    if (!month) {
        alert('Please select a month first.');
        return;
    }

    const data = await apiRequest(`/reports/incidents?month=${encodeURIComponent(month)}`);
    currentReportData = data;
    applySummary(data.summary || {});
    renderMonthlyIncidents(data.incidents || []);
}

async function loadScheduledReports() {
    const list = await apiRequest('/reports/scheduled');
    const container = document.getElementById('scheduled-reports-list');
    if (!list.length) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F4C4;</div><div class="empty-state-title">No Scheduled Reports</div><div class="empty-state-text">Create automated reports to receive regular updates</div></div>';
        return;
    }

    container.innerHTML = list.map(report => `
        <div class="info-row">
            <span class="label">${report.name}</span>
            <span class="value">${report.frequency} - ${report.format} - ${report.recipients}</span>
            <button class="btn btn-danger btn-sm" data-action="remove" data-id="${report.id}">Remove</button>
        </div>
    `).join('');

    container.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await apiRequest(`/reports/scheduled/${btn.dataset.id}`, { method: 'DELETE' });
            await loadScheduledReports();
        });
    });
}

function exportCsv() {
    if (!currentReportData) {
        alert('Generate the monthly report first.');
        return;
    }

    const rows = [['Month', currentReportData.month]];
    rows.push(['Overall Uptime', `${Number(currentReportData.summary.overallUptime || 0).toFixed(2)}%`]);
    rows.push(['Avg Response Time', `${currentReportData.summary.avgResponseTime || 0}ms`]);
    rows.push(['Total Incidents', String(currentReportData.summary.totalIncidents || 0)]);
    rows.push(['Total Downtime', `${currentReportData.summary.totalDowntimeMinutes || 0}m`]);
    rows.push([]);
    rows.push(['Title', 'Severity', 'Status', 'Service', 'Started', 'Resolved', 'DowntimeMinutes']);

    for (const incident of currentReportData.incidents || []) {
        rows.push([
            incident.title || '',
            incident.severity || '',
            incident.status || '',
            incident.monitorName || '',
            incident.createdAt || '',
            incident.resolvedAt || '',
            String(incident.downtimeMinutes || 0),
        ]);
    }

    const csv = rows.map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile(`pingra-incidents-${currentReportData.month}.csv`, csv, 'text/csv');
}

function exportJson() {
    if (!currentReportData) {
        alert('Generate the monthly report first.');
        return;
    }
    downloadFile(`pingra-incidents-${currentReportData.month}.json`, JSON.stringify(currentReportData, null, 2), 'application/json');
}

function exportPdf() {
    if (!currentReportData) {
        alert('Generate the monthly report first.');
        return;
    }
    window.print();
}

document.addEventListener('DOMContentLoaded', async () => {
    const userEmail = localStorage.getItem('userEmail') || 'user@example.com';
    document.getElementById('user-email').textContent = userEmail;
    document.getElementById('user-avatar').textContent = userEmail.charAt(0).toUpperCase();

    setCurrentMonthDefault();
    await loadMonthlyReport();
    await loadScheduledReports();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    document.getElementById('apply-filters-btn').addEventListener('click', loadMonthlyReport);
    document.getElementById('generate-report-btn').addEventListener('click', loadMonthlyReport);
    document.getElementById('report-month').addEventListener('change', loadMonthlyReport);

    document.getElementById('schedule-report').addEventListener('click', () => {
        document.getElementById('schedule-modal').classList.add('active');
    });

    document.querySelectorAll('#schedule-modal .close, #cancel-schedule').forEach(el => {
        el.addEventListener('click', () => {
            document.getElementById('schedule-modal').classList.remove('active');
        });
    });

    document.getElementById('export-pdf').addEventListener('click', exportPdf);
    document.getElementById('export-csv').addEventListener('click', exportCsv);
    document.getElementById('export-json').addEventListener('click', exportJson);

    document.getElementById('schedule-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            name: document.getElementById('schedule-name').value.trim(),
            frequency: document.getElementById('schedule-frequency').value,
            recipients: document.getElementById('schedule-recipients').value.trim(),
            format: document.getElementById('schedule-format').value
        };
        if (!payload.name || !payload.recipients) return;
        await apiRequest('/reports/scheduled', { method: 'POST', body: JSON.stringify(payload) });
        e.target.reset();
        document.getElementById('schedule-modal').classList.remove('active');
        await loadScheduledReports();
    });
});
