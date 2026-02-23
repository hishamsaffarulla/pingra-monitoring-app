// Home page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    const userEmail = localStorage.getItem('userEmail') || 'user@example.com';
    document.getElementById('user-email').textContent = userEmail;
    document.getElementById('user-avatar').textContent = userEmail.charAt(0).toUpperCase();

    await loadStats();
    loadRecentActivity();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });
});

async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
        return null;
    }

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function loadStats() {
    try {
        const monitorsResponse = await apiRequest('/monitors');
        const monitors = Array.isArray(monitorsResponse)
            ? monitorsResponse
            : (monitorsResponse?.monitors || []);

        let upCount = 0;
        let downCount = 0;

        await Promise.all(monitors.map(async (monitor) => {
            try {
                const status = await apiRequest(`/monitors/${monitor.id}/status`);
                if (status?.currentStatus === 'up') {
                    upCount += 1;
                } else if (status?.currentStatus === 'down') {
                    downCount += 1;
                }
            } catch {
                // Ignore single monitor status failures
            }
        }));

        let activeIncidents = 0;
        try {
            const incidentsResponse = await apiRequest('/incidents');
            const incidents = Array.isArray(incidentsResponse) ? incidentsResponse : [];
            activeIncidents = incidents.filter((incident) => incident.status !== 'resolved').length;
        } catch {
            // Ignore incident lookup failures
        }

        document.getElementById('total-monitors').textContent = String(monitors.length);
        document.getElementById('monitors-up').textContent = String(upCount);
        document.getElementById('monitors-down').textContent = String(downCount);
        document.getElementById('active-incidents').textContent = String(activeIncidents);
    } catch {
        document.getElementById('total-monitors').textContent = '0';
        document.getElementById('monitors-up').textContent = '0';
        document.getElementById('monitors-down').textContent = '0';
        document.getElementById('active-incidents').textContent = '0';
    }
}

function loadRecentActivity() {
    const activityList = document.getElementById('activity-list');
    activityList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-title">No Recent Activity</div><div class="empty-state-text">Activity will appear here once you start monitoring</div></div>';
}
