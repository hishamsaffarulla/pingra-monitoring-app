/**
 * Dashboard Application
 * Main application logic for the URL monitoring dashboard
 */

const API_BASE_URL = window.API_BASE_URL || '/api';
let monitors = [];
let currentMonitor = null;
let channels = [];
let refreshInterval = null;
let pendingDeleteMonitorId = null;

// Check authentication
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
}

// API helper function
async function apiRequest(endpoint, options = {}) {
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

function formatUptime(value) {
    if (value === null || value === undefined || value === '') {
        return 'N/A';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return `${value.toFixed(2)}%`;
    }
    return 'N/A';
}

function formatResponseTime(value) {
    if (value === null || value === undefined || value === '') {
        return 'N/A';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return `${Math.round(value)}ms`;
    }
    return 'N/A';
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadMonitors();
    loadChannels();
    
    // Auto-refresh every 30 seconds
    refreshInterval = setInterval(loadMonitors, 30000);
});

// Event Listeners
function initializeEventListeners() {
    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // Add monitor
    const addMonitorBtn = document.getElementById('add-monitor-btn');
    if (addMonitorBtn) {
        addMonitorBtn.addEventListener('click', () => {
            currentMonitor = null;
            showMonitorForm();
        });
    }
    
    // Refresh
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadMonitors();
            loadChannels();
        });
    }
    
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterMonitors(e.target.value);
        });
    }
    
    // Monitor form
    const monitorForm = document.getElementById('monitor-form');
    if (monitorForm) {
        monitorForm.addEventListener('submit', saveMonitor);
    }
    const cancelFormBtn = document.getElementById('cancel-form-btn');
    if (cancelFormBtn) {
        cancelFormBtn.addEventListener('click', () => {
            closeModal('monitor-form-modal');
        });
    }
    
    // Monitor details modal
    const editMonitorBtn = document.getElementById('edit-monitor-btn');
    if (editMonitorBtn) {
        editMonitorBtn.addEventListener('click', editCurrentMonitor);
    }
    const deleteMonitorBtn = document.getElementById('delete-monitor-btn');
    if (deleteMonitorBtn) {
        deleteMonitorBtn.addEventListener('click', deleteCurrentMonitor);
    }

    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', confirmDeleteMonitor);
    }

    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            pendingDeleteMonitorId = null;
            closeModal('delete-confirm-modal');
        });
    }
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });
    
    // Close modals
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                closeModal(modal.id);
            }
        });
    });
    
    // Add channel
    const addChannelBtn = document.getElementById('add-channel-btn');
    if (addChannelBtn) {
        addChannelBtn.addEventListener('click', () => {
            showChannelForm();
        });
    }
    
    // Channel form
    const channelForm = document.getElementById('channel-form');
    if (channelForm) {
        channelForm.addEventListener('submit', saveChannel);
    }
    const cancelChannelBtn = document.getElementById('cancel-channel-btn');
    if (cancelChannelBtn) {
        cancelChannelBtn.addEventListener('click', () => {
            closeModal('channel-form-modal');
        });
    }
    
    // Channel type change
    const channelType = document.getElementById('channel-type');
    if (channelType) {
        channelType.addEventListener('change', (e) => {
            updateChannelConfigFields(e.target.value);
        });
    }
}

// Logout
async function logout() {
    try {
        await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
    }
}

// Load monitors
async function loadMonitors() {
    try {
        const data = await apiRequest('/monitors');
        monitors = data.monitors || data;
        localStorage.setItem('pingra_cached_monitors', JSON.stringify(monitors));
        renderMonitors(monitors);
        await hydrateMonitorTelemetry();
    } catch (error) {
        console.error('Failed to load monitors:', error);
        const cached = localStorage.getItem('pingra_cached_monitors');
        if (cached) {
            monitors = JSON.parse(cached);
            renderMonitors(monitors);
            await hydrateMonitorTelemetry();
        } else {
            showError('Failed to load monitors');
        }
    }
}

async function hydrateMonitorTelemetry() {
    if (!Array.isArray(monitors) || monitors.length === 0) {
        return;
    }

    const updated = await Promise.all(monitors.map(async (monitor) => {
        const next = { ...monitor };

        try {
            const status = await apiRequest(`/monitors/${monitor.id}/status`);
            if (status && status.currentStatus) {
                next.status = status.currentStatus;
            }
            if (status && status.latestCheck) {
                const check = status.latestCheck;
                if (typeof check.responseTime === 'number') {
                    next.avgResponseTime = check.responseTime;
                }
                if (check.timestamp) {
                    next.lastCheckTime = check.timestamp;
                }
            }
        } catch (error) {
            // Fallback to latest check endpoint below
        }

        try {
            const latest = await apiRequest(`/monitors/${monitor.id}/latest-check`);
            const check = latest && latest.latestCheck ? latest.latestCheck : null;
            if (check && !next.status) {
                next.status = check.success ? 'up' : 'down';
            }
            if (check) {
                next.avgResponseTime = typeof check.responseTime === 'number' ? check.responseTime : next.avgResponseTime;
                next.lastCheckTime = check.timestamp || next.lastCheckTime;
            }
        } catch (error) {
            // No check results yet or endpoint error - keep unknown
        }

        try {
            const uptime = await apiRequest(`/monitors/${monitor.id}/uptime?period=24h`);
            if (uptime && typeof uptime.uptimePercentage === 'number') {
                next.uptime = `${uptime.uptimePercentage.toFixed(2)}%`;
                if (!next.avgResponseTime && typeof uptime.averageResponseTime === 'number') {
                    next.avgResponseTime = uptime.averageResponseTime;
                }
            }
        } catch (error) {
            // Ignore uptime errors for now
        }

        return next;
    }));

    monitors = updated;
    localStorage.setItem('pingra_cached_monitors', JSON.stringify(monitors));
    renderMonitors(monitors);
}

// Render monitors
function renderMonitors(monitorsToRender) {
    const grid = document.getElementById('monitor-grid');
    
    if (monitorsToRender.length === 0) {
        grid.innerHTML = '<div class="loading">No monitors found. Click "Add Monitor" to create one.</div>';
        return;
    }
    
    grid.innerHTML = monitorsToRender.map(monitor => `
        <div class="monitor-card" data-id="${monitor.id}">
            <div class="monitor-card-header">
                <div class="monitor-info">
                    <div class="monitor-name">${escapeHtml(monitor.name)}</div>
                    <div class="monitor-url">${escapeHtml(monitor.url)}</div>
                </div>
                <div class="monitor-header-actions">
                    <span class="status-badge status-${monitor.status || 'unknown'}">
                        ${monitor.status || 'unknown'}
                    </span>
                    <div class="monitor-actions">
                        <button class="btn btn-ghost btn-xs monitor-action" data-action="run" data-id="${monitor.id}" type="button">Run Check</button>
                        <button class="btn btn-ghost btn-xs monitor-action" data-action="status" data-id="${monitor.id}" type="button">
                            ${isMonitorOnStatusPage(monitor.id) ? 'On Status' : 'Add Status'}
                        </button>
                        <button class="btn btn-secondary btn-xs monitor-action" data-action="edit" data-id="${monitor.id}" type="button">Edit</button>
                        <button class="btn btn-danger btn-xs monitor-action" data-action="delete" data-id="${monitor.id}" type="button">Delete</button>
                    </div>
                </div>
            </div>
            <div class="monitor-metrics">
                <div class="metric">
                    <span class="metric-label">Uptime</span>
                    <span class="metric-value">${formatUptime(monitor.uptime)}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Response Time</span>
                    <span class="metric-value">${formatResponseTime(monitor.avgResponseTime)}</span>
                </div>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.monitor-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.getAttribute('data-id');
            if (id) {
                showMonitorDetails(id);
            }
        });
    });

    grid.querySelectorAll('.monitor-action').forEach(button => {
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const action = button.getAttribute('data-action');
            const monitorId = button.getAttribute('data-id');
            if (!action || !monitorId) return;

            if (action === 'run') {
                await runMonitorCheck(monitorId);
            } else if (action === 'edit') {
                const monitor = monitors.find(m => m.id === monitorId);
                if (monitor) {
                    currentMonitor = monitor;
                    showMonitorForm(monitor);
                }
            } else if (action === 'delete') {
                deleteMonitorById(monitorId);
            } else if (action === 'status') {
                toggleStatusMonitor(monitorId);
                renderMonitors(monitors);
            }
        });
    });
}

async function runMonitorCheck(monitorId) {
    try {
        await apiRequest(`/monitors/${monitorId}/run`, { method: 'POST' });
        await hydrateMonitorTelemetry();
    } catch (error) {
        console.error('Failed to run monitor check:', error);
        showError('Failed to run monitor check');
    }
}

// Filter monitors
function filterMonitors(searchTerm) {
    const filtered = monitors.filter(monitor => 
        monitor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        monitor.url.toLowerCase().includes(searchTerm.toLowerCase())
    );
    renderMonitors(filtered);
}

// Show monitor details
async function showMonitorDetails(monitorId) {
    currentMonitor = monitors.find(m => m.id === monitorId);
    if (!currentMonitor) return;
    
    // Update overview tab
    document.getElementById('modal-monitor-name').textContent = currentMonitor.name;
    document.getElementById('detail-url').textContent = currentMonitor.url;
    document.getElementById('detail-status').textContent = currentMonitor.status || 'unknown';
    document.getElementById('detail-status').className = `status-badge status-${currentMonitor.status || 'unknown'}`;
    document.getElementById('detail-interval').textContent = formatInterval(currentMonitor.checkInterval);
    document.getElementById('detail-locations').textContent = currentMonitor.probeLocations.map(formatProbeLocation).join(', ');
    
    // Load uptime data
    loadUptimeData(monitorId);
    
    // Load alerts
    loadAlerts(monitorId);
    
    // Switch to overview tab
    switchTab('overview');
    
    // Show modal
    showModal('monitor-details-modal');
}

// Load uptime data
async function loadUptimeData(monitorId) {
    try {
        const data = await apiRequest(`/monitors/${monitorId}/uptime?period=30d`);
        document.getElementById('detail-uptime').textContent = `${data.uptimePercentage.toFixed(2)}%`;
        document.getElementById('detail-last-outage').textContent = data.lastOutageDuration 
            ? `${data.lastOutageDuration} minutes` 
            : 'None';
    } catch (error) {
        console.error('Failed to load uptime data:', error);
        document.getElementById('detail-uptime').textContent = 'N/A';
        document.getElementById('detail-last-outage').textContent = 'N/A';
    }
}

// Load response time chart
async function loadResponseTimeChart(monitorId) {
    try {
        const data = await apiRequest(`/monitors/${monitorId}/response-times?period=24h`);
        renderResponseTimeChart(data);
    } catch (error) {
        console.error('Failed to load response time data:', error);
    }
}

// Render response time chart (simple implementation without chart library)
function renderResponseTimeChart(data) {
    const canvas = document.getElementById('response-time-chart');
    const ctx = canvas.getContext('2d');
    
    // Simple chart rendering
    // In production, use a library like Chart.js
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#64748b';
    ctx.font = '14px sans-serif';
    ctx.fillText('Response time chart (requires Chart.js library)', 10, 50);
}

// Load alerts
async function loadAlerts(monitorId) {
    const alertsList = document.getElementById('alerts-list');
    alertsList.innerHTML = '<div class="loading">Loading alerts...</div>';
    
    try {
        const data = await apiRequest(`/alerts/monitors/${monitorId}/alerts`);
        const alerts = data.alerts || data;
        
        if (!alerts || alerts.length === 0) {
            alertsList.innerHTML = '<div class="loading">No alerts found</div>';
            return;
        }
        
        alertsList.innerHTML = alerts.map(alert => `
            <div class="alert-item">
                <div class="alert-item-header">
                    <span class="alert-type">${alert.alertType}</span>
                    <span class="alert-time">${formatDate(alert.triggeredAt)}</span>
                </div>
                <div class="alert-message">${escapeHtml(alert.message || '')}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load alerts:', error);
        alertsList.innerHTML = '<div class="loading">Failed to load alerts</div>';
    }
}

// Show monitor form
function showMonitorForm(monitor = null) {
    const form = document.getElementById('monitor-form');
    const title = document.getElementById('form-title');
    
    if (monitor) {
        title.textContent = 'Edit Monitor';
        document.getElementById('monitor-name').value = monitor.name;
        document.getElementById('monitor-url').value = monitor.url;
        document.getElementById('monitor-interval').value = monitor.checkInterval;
        document.getElementById('monitor-timeout').value = monitor.timeoutSeconds;
        document.getElementById('monitor-status-codes').value = monitor.expectedStatusCodes.join(',');
        document.getElementById('monitor-threshold').value = monitor.failureThreshold;
        
        // Set locations
        document.querySelectorAll('input[name="location"]').forEach(checkbox => {
            checkbox.checked = monitor.probeLocations.includes(checkbox.value);
        });
    } else {
        title.textContent = 'Add Monitor';
        form.reset();
    }
    
    showModal('monitor-form-modal');
}

// Save monitor
async function saveMonitor(e) {
    e.preventDefault();
    
    const locations = Array.from(document.querySelectorAll('input[name="location"]:checked'))
        .map(cb => cb.value);
    
    if (locations.length === 0) {
        alert('Please select at least one probe location');
        return;
    }
    
    const monitorData = {
        name: document.getElementById('monitor-name').value,
        url: document.getElementById('monitor-url').value,
        checkInterval: parseInt(document.getElementById('monitor-interval').value),
        timeoutSeconds: parseInt(document.getElementById('monitor-timeout').value),
        expectedStatusCodes: document.getElementById('monitor-status-codes').value
            .split(',')
            .map(code => parseInt(code.trim()))
            .filter(code => !isNaN(code)),
        probeLocations: locations,
        failureThreshold: parseInt(document.getElementById('monitor-threshold').value)
    };
    
    try {
        if (currentMonitor) {
            await apiRequest(`/monitors/${currentMonitor.id}`, {
                method: 'PUT',
                body: JSON.stringify(monitorData)
            });
        } else {
            await apiRequest('/monitors', {
                method: 'POST',
                body: JSON.stringify(monitorData)
            });
        }
        
        closeModal('monitor-form-modal');
        loadMonitors();
    } catch (error) {
        alert('Failed to save monitor: ' + error.message);
    }
}

// Edit current monitor
function editCurrentMonitor() {
    closeModal('monitor-details-modal');
    showMonitorForm(currentMonitor);
}

// Delete current monitor
async function deleteCurrentMonitor() {
    if (!currentMonitor) return;
    pendingDeleteMonitorId = currentMonitor.id;
    showModal('delete-confirm-modal');
}

async function confirmDeleteMonitor() {
    if (!pendingDeleteMonitorId) return;
    
    try {
        await apiRequest(`/monitors/${pendingDeleteMonitorId}`, {
            method: 'DELETE'
        });
        
        closeModal('monitor-details-modal');
        closeModal('delete-confirm-modal');
        pendingDeleteMonitorId = null;
        loadMonitors();
    } catch (error) {
        alert('Failed to delete monitor: ' + error.message);
    }
}

function deleteMonitorById(monitorId) {
    pendingDeleteMonitorId = monitorId;
    showModal('delete-confirm-modal');
}

// Load channels
async function loadChannels() {
    const channelsList = document.getElementById('channels-list');
    if (!channelsList) {
        return;
    }
    channelsList.innerHTML = '<div class="loading">Loading channels...</div>';
    
    try {
        const data = await apiRequest('/alerts/notification-channels');
        channels = data;
        
        if (channels.length === 0) {
            channelsList.innerHTML = '<div class="loading">No notification channels configured</div>';
            return;
        }
        
        channelsList.innerHTML = channels.map(channel => `
            <div class="channel-card">
                <div class="channel-info">
                    <div class="channel-type">${channel.type}</div>
                    <div class="channel-details">${getChannelDetails(channel)}</div>
                </div>
                <div class="channel-actions">
                    <button class="btn btn-secondary" onclick="editChannel('${channel.id}')">Edit</button>
                    <button class="btn btn-danger" onclick="deleteChannel('${channel.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load channels:', error);
        channelsList.innerHTML = '<div class="loading">Failed to load channels</div>';
    }
}

// Get channel details
function getChannelDetails(channel) {
    const config = channel.configuration;
    switch (channel.type) {
        case 'email':
            return config.to || 'Email notification';
        case 'webhook':
            return config.url || 'Webhook notification';
        case 'sms':
            return config.phoneNumber || 'SMS notification';
        case 'voice':
            return config.phoneNumber || 'Voice notification';
        default:
            return 'Notification channel';
    }
}

// Show channel form
function showChannelForm(channel = null) {
    const form = document.getElementById('channel-form');
    const title = document.getElementById('channel-form-title');
    
    if (channel) {
        title.textContent = 'Edit Notification Channel';
        document.getElementById('channel-type').value = channel.type;
        document.getElementById('channel-enabled').checked = channel.enabled;
        updateChannelConfigFields(channel.type, channel.configuration);
    } else {
        title.textContent = 'Add Notification Channel';
        form.reset();
        updateChannelConfigFields('email');
    }
    
    showModal('channel-form-modal');
}

// Update channel config fields
function updateChannelConfigFields(type, config = {}) {
    const configDiv = document.getElementById('channel-config');
    
    let html = '';
    switch (type) {
        case 'email':
            html = `
                <div class="form-group">
                    <label for="email-to">Email Address *</label>
                    <input type="email" id="email-to" required value="${config.to || ''}" />
                </div>
                <div class="form-group">
                    <label for="email-from">From Address</label>
                    <input type="email" id="email-from" value="${config.from || ''}" placeholder="alerts@yourdomain.com" />
                </div>
                <div class="form-group">
                    <label for="smtp-host">SMTP Host</label>
                    <input type="text" id="smtp-host" value="${config.host || ''}" placeholder="smtp.yourdomain.com" />
                </div>
                <div class="form-group">
                    <label for="smtp-port">SMTP Port</label>
                    <input type="number" id="smtp-port" value="${config.port || 587}" />
                </div>
                <div class="form-group">
                    <label for="smtp-user">SMTP Username</label>
                    <input type="text" id="smtp-user" value="${config.username || ''}" />
                </div>
                <div class="form-group">
                    <label for="smtp-pass">SMTP Password</label>
                    <input type="password" id="smtp-pass" value="${config.password || ''}" />
                </div>
                <div class="form-group">
                    <label for="email-subject">Subject Template</label>
                    <input type="text" id="email-subject" value="${config.subject || 'Alert: {monitor_name}'}" />
                </div>
            `;
            break;
        case 'webhook':
            html = `
                <div class="form-group">
                    <label for="webhook-url">Webhook URL *</label>
                    <input type="url" id="webhook-url" required value="${config.url || ''}" />
                </div>
                <div class="form-group">
                    <label for="webhook-method">HTTP Method</label>
                    <select id="webhook-method">
                        <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST</option>
                        <option value="PUT" ${config.method === 'PUT' ? 'selected' : ''}>PUT</option>
                    </select>
                </div>
            `;
            break;
        case 'sms':
            html = `
                <div class="form-group">
                    <label for="sms-phone">Phone Number *</label>
                    <input type="tel" id="sms-phone" required value="${config.phoneNumber || ''}" />
                </div>
                <div class="form-group">
                    <label for="sms-provider">Provider</label>
                    <input type="text" id="sms-provider" value="${config.provider || 'twilio'}" />
                </div>
            `;
            break;
        case 'voice':
            html = `
                <div class="form-group">
                    <label for="voice-phone">Phone Number *</label>
                    <input type="tel" id="voice-phone" required value="${config.phoneNumber || ''}" />
                </div>
                <div class="form-group">
                    <label for="voice-provider">Provider</label>
                    <input type="text" id="voice-provider" value="${config.provider || 'twilio'}" />
                </div>
            `;
            break;
    }
    
    configDiv.innerHTML = html;
}

// Save channel
async function saveChannel(e) {
    e.preventDefault();
    
    const type = document.getElementById('channel-type').value;
    const enabled = document.getElementById('channel-enabled').checked;
    
    let configuration = {};
    switch (type) {
        case 'email':
            configuration = {
                to: document.getElementById('email-to').value,
                from: document.getElementById('email-from').value,
                host: document.getElementById('smtp-host').value,
                port: parseInt(document.getElementById('smtp-port').value, 10),
                username: document.getElementById('smtp-user').value,
                password: document.getElementById('smtp-pass').value,
                subject: document.getElementById('email-subject').value
            };
            break;
        case 'webhook':
            configuration = {
                url: document.getElementById('webhook-url').value,
                method: document.getElementById('webhook-method').value
            };
            break;
        case 'sms':
            configuration = {
                phoneNumber: document.getElementById('sms-phone').value,
                provider: document.getElementById('sms-provider').value
            };
            break;
        case 'voice':
            configuration = {
                phoneNumber: document.getElementById('voice-phone').value,
                provider: document.getElementById('voice-provider').value
            };
            break;
    }
    
    const channelData = { type, configuration, enabled };
    
    try {
        await apiRequest('/alerts/notification-channels', {
            method: 'POST',
            body: JSON.stringify(channelData)
        });
        
        closeModal('channel-form-modal');
        loadChannels();
    } catch (error) {
        alert('Failed to save channel: ' + error.message);
    }
}

// Edit channel
function editChannel(channelId) {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
        showChannelForm(channel);
    }
}

// Delete channel
async function deleteChannel(channelId) {
    if (!confirm('Are you sure you want to delete this notification channel?')) {
        return;
    }
    
    try {
        await apiRequest(`/alerts/notification-channels/${channelId}`, {
            method: 'DELETE'
        });
        
        loadChannels();
    } catch (error) {
        alert('Failed to delete channel: ' + error.message);
    }
}

// Switch tab
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Load data for specific tabs
    if (tabName === 'metrics' && currentMonitor) {
        loadResponseTimeChart(currentMonitor.id);
    }
}

// Modal helpers
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Utility functions
function formatInterval(seconds) {
    if (seconds === 60) return '1 minute';
    if (seconds === 300) return '5 minutes';
    return `${seconds} seconds`;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

function formatProbeLocation(location) {
    const labels = {
        'us-east': 'US East',
        'eu-west': 'EU West',
        'me-central': 'ME Central',
        'in-mumbai': 'India (Mumbai)',
        'in-hyderabad': 'India (Hyderabad)'
    };
    return labels[location] || location;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    // Simple error display - could be enhanced with a toast notification
    console.error(message);
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

function setStatusMonitorIds(ids) {
    localStorage.setItem('pingra_status_monitors', JSON.stringify(ids));
}

function isMonitorOnStatusPage(monitorId) {
    return getStatusMonitorIds().includes(monitorId);
}

function toggleStatusMonitor(monitorId) {
    const ids = getStatusMonitorIds();
    if (ids.includes(monitorId)) {
        setStatusMonitorIds(ids.filter(id => id !== monitorId));
    } else {
        ids.push(monitorId);
        setStatusMonitorIds(ids);
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});
