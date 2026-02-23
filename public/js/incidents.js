// Incidents page JavaScript
const API_BASE_URL = '/api';
let incidents = [];
let users = [];
let monitors = [];
let activeFilter = 'all';
let activeSeverity = '';
let activeSearch = '';
let currentIncidentId = null;

const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
}

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
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Request failed');
    }

    if (response.status === 204) return null;
    return response.json();
}

function formatDateTime(value) {
    return new Date(value).toLocaleString();
}

function durationMinutes(start, end) {
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(0, Math.round(diffMs / 60000));
}

function parseIncidentDiagnostics(description) {
    const text = String(description || '');
    const getValue = (key) => {
        const regex = new RegExp(`${key}\\s*:\\s*(.+)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : 'N/A';
    };

    return {
        rootCause: getValue('Root Cause'),
        statusCode: getValue('Status Code'),
        failedIp: getValue('Failed IP'),
        affectedRegions: getValue('Affected Regions'),
    };
}

async function loadReferenceData() {
    try {
        const monitorResponse = await apiRequest('/monitors');
        monitors = monitorResponse.monitors || monitorResponse;
    } catch {
        monitors = [];
    }

    try {
        users = await apiRequest('/users');
    } catch {
        users = [];
    }

    const serviceSelect = document.getElementById('new-incident-service');
    serviceSelect.innerHTML = '<option value="">Select a monitor...</option>';
    monitors.forEach(monitor => {
        const option = document.createElement('option');
        option.value = monitor.id;
        option.textContent = monitor.name || monitor.url;
        serviceSelect.appendChild(option);
    });

    const assigneeSelect = document.getElementById('new-incident-assignee');
    assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.name || user.email} (${user.email})`;
        assigneeSelect.appendChild(option);
    });
}

async function loadIncidents() {
    const params = new URLSearchParams();
    if (activeFilter && activeFilter !== 'all') params.set('status', activeFilter);
    if (activeSeverity) params.set('severity', activeSeverity);
    if (activeSearch) params.set('search', activeSearch);

    try {
        incidents = await apiRequest(`/incidents?${params.toString()}`);
        renderStats();
        renderIncidents();
    } catch (error) {
        console.error(error);
    }
}

function renderStats() {
    const activeCount = incidents.filter(i => i.status !== 'resolved').length;
    const resolved = incidents.filter(i => i.status === 'resolved' && i.resolvedAt);
    const avgResolution = resolved.length
        ? Math.round(resolved.reduce((sum, inc) => sum + durationMinutes(inc.createdAt, inc.resolvedAt), 0) / resolved.length)
        : 0;

    const now = new Date();
    const resolvedThisMonth = resolved.filter(inc => {
        const date = new Date(inc.resolvedAt);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }).length;

    document.getElementById('active-incidents-count').textContent = activeCount.toString();
    document.getElementById('avg-resolution-time').textContent = `${avgResolution}m`;
    document.getElementById('resolved-this-month').textContent = resolvedThisMonth.toString();
}

function renderIncidents() {
    const container = document.getElementById('incidents-list');
    if (incidents.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-title">No Incidents</div><div class="empty-state-text">All systems are running smoothly</div></div>';
        return;
    }

    container.innerHTML = incidents.map(incident => `
        <div class="incident-card" data-id="${incident.id}">
            <div class="monitor-card-header">
                <div>
                    <div class="monitor-name">${incident.title}</div>
                    <div class="monitor-url">${incident.monitorName || incident.monitorUrl || 'Unassigned Service'}</div>
                </div>
                <span class="severity-badge ${incident.severity}">${incident.severity}</span>
            </div>
            <div class="info-row">
                <span class="label">Status</span>
                <span class="status-badge status-${incident.status}">${incident.status}</span>
            </div>
            <div class="info-row">
                <span class="label">Started</span>
                <span class="value">${formatDateTime(incident.createdAt)}</span>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.incident-card').forEach(card => {
        card.addEventListener('click', () => openIncident(card.dataset.id));
    });
}

async function openIncident(id) {
    try {
        const incident = await apiRequest(`/incidents/${id}`);
        currentIncidentId = incident.id;
        document.getElementById('incident-title').textContent = incident.title;
        document.getElementById('incident-severity').textContent = incident.severity;
        document.getElementById('incident-severity').className = `severity-badge ${incident.severity}`;
        document.getElementById('incident-status').textContent = incident.status;
        document.getElementById('incident-status').className = `status-badge status-${incident.status}`;
        document.getElementById('incident-id').textContent = incident.id;
        document.getElementById('incident-service').textContent = incident.monitorName || incident.monitorUrl || 'Unassigned';
        document.getElementById('incident-started').textContent = formatDateTime(incident.createdAt);
        document.getElementById('incident-duration').textContent = `${durationMinutes(incident.createdAt, incident.resolvedAt || new Date())}m`;
        document.getElementById('incident-assignee').textContent = incident.assigneeName || 'Unassigned';
        const diagnostics = parseIncidentDiagnostics(incident.description);
        document.getElementById('incident-root-cause').textContent = diagnostics.rootCause;
        document.getElementById('incident-failed-ip').textContent = diagnostics.failedIp;
        document.getElementById('incident-affected-regions').textContent = diagnostics.affectedRegions;
        document.getElementById('incident-status-code').textContent = diagnostics.statusCode;

        const timeline = document.getElementById('incident-timeline');
        const updates = incident.updates || [];
        if (updates.length === 0) {
            timeline.innerHTML = '<div class="empty-state"><div class="empty-state-text">No updates yet</div></div>';
        } else {
            timeline.innerHTML = updates.map(update => `
                <div class="info-row">
                    <span class="label">${update.status}</span>
                    <span class="value">${update.message} • ${formatDateTime(update.createdAt)}</span>
                </div>
            `).join('');
        }

        document.getElementById('incident-modal').classList.add('active');
    } catch (error) {
        console.error(error);
    }
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function closeAnyOpenModal() {
    document.querySelectorAll('.modal.active').forEach(modal => modal.classList.remove('active'));
}

document.addEventListener('DOMContentLoaded', async () => {
    const createIncidentBtn = document.getElementById('create-incident-btn');
    if (createIncidentBtn) {
        createIncidentBtn.textContent = '+ Create Incident';
    }

    const dangerIcon = document.querySelector('.incident-stats .stat-icon.danger');
    if (dangerIcon) dangerIcon.textContent = '\uD83D\uDEA8';
    const warningIcon = document.querySelector('.incident-stats .stat-icon.warning');
    if (warningIcon) warningIcon.textContent = '\u23F1\uFE0F';
    const successIcon = document.querySelector('.incident-stats .stat-icon.success');
    if (successIcon) successIcon.textContent = '\u2713';

    const userEmail = localStorage.getItem('userEmail') || 'user@example.com';
    document.getElementById('user-email').textContent = userEmail;
    document.getElementById('user-avatar').textContent = userEmail.charAt(0).toUpperCase();

    await loadReferenceData();
    await loadIncidents();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    document.getElementById('create-incident-btn').addEventListener('click', () => {
        document.getElementById('create-incident-modal').classList.add('active');
    });

    document.getElementById('cancel-create-incident').addEventListener('click', () => {
        closeModal('create-incident-modal');
    });

    document.querySelectorAll('[data-close-modal]').forEach(el => {
        el.addEventListener('click', () => closeModal(el.dataset.closeModal));
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModal(modal.id);
            }
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAnyOpenModal();
        }
    });

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', async (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            activeFilter = e.target.dataset.filter;
            await loadIncidents();
        });
    });

    document.getElementById('severity-filter').addEventListener('change', async (e) => {
        activeSeverity = e.target.value;
        await loadIncidents();
    });

    document.getElementById('incident-search').addEventListener('input', async (e) => {
        activeSearch = e.target.value;
        await loadIncidents();
    });

    document.getElementById('create-incident-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            title: document.getElementById('new-incident-title').value.trim(),
            description: document.getElementById('new-incident-description').value.trim(),
            monitorId: document.getElementById('new-incident-service').value || null,
            severity: document.getElementById('new-incident-severity').value,
            assigneeUserId: document.getElementById('new-incident-assignee').value || null
        };
        if (!payload.title) return;
        await apiRequest('/incidents', { method: 'POST', body: JSON.stringify(payload) });
        e.target.reset();
        closeModal('create-incident-modal');
        await loadIncidents();
    });

    document.getElementById('incident-update-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentIncidentId) return;
        const message = document.getElementById('update-message').value.trim();
        const status = document.getElementById('update-status').value;
        if (!message) return;
        await apiRequest(`/incidents/${currentIncidentId}/updates`, {
            method: 'POST',
            body: JSON.stringify({ status, message })
        });
        document.getElementById('update-message').value = '';
        await openIncident(currentIncidentId);
        await loadIncidents();
    });

    document.getElementById('close-incident-btn').addEventListener('click', async () => {
        if (!currentIncidentId) return;
        await apiRequest(`/incidents/${currentIncidentId}/close`, { method: 'POST' });
        await openIncident(currentIncidentId);
        await loadIncidents();
    });

    document.getElementById('assign-incident-btn').addEventListener('click', async () => {
        if (!currentIncidentId || users.length === 0) return;
        const list = users.map((user, idx) => `${idx + 1}. ${user.name || user.email} (${user.email})`).join('\n');
        const choice = window.prompt(`Assign to:\n${list}`);
        const index = Number(choice) - 1;
        if (Number.isNaN(index) || !users[index]) return;
        const assignee = users[index];
        await apiRequest(`/incidents/${currentIncidentId}`, {
            method: 'PUT',
            body: JSON.stringify({ assigneeUserId: assignee.id })
        });
        await openIncident(currentIncidentId);
        await loadIncidents();
    });
});
