// Users page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';
let users = [];
let groups = [];
let currentUserId = null;

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

function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No Users</div><div class="empty-state-text">Add team members to receive alerts</div></td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.name || 'User'}</td>
            <td>${user.email}</td>
            <td>${user.role || 'member'}</td>
            <td>${(user.alertPreferences || []).join(', ')}</td>
            <td>${user.status || 'active'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${user.id}" type="button">Edit</button>
                <button class="btn btn-danger btn-sm" data-action="remove" data-id="${user.id}" type="button">Remove</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => openUserModal(btn.dataset.id));
    });
    tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remove this user?')) return;
            await apiRequest(`/users/${btn.dataset.id}`, { method: 'DELETE' });
            await loadUsers();
        });
    });
}

function renderGroups() {
    const container = document.getElementById('groups-grid');
    if (groups.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No Alert Groups</div><div class="empty-state-text">Create groups to organize alert recipients</div></div>';
        return;
    }

    container.innerHTML = groups.map(group => `
        <div class="stat-card">
            <div class="stat-content">
                <div class="stat-value">${group.name}</div>
                <div class="stat-label">${group.description || 'Alert Group'}</div>
            </div>
            <div class="stat-label">Members: ${group.members.length}</div>
        </div>
    `).join('');
}

function populateGroupMembers() {
    const container = document.getElementById('group-members');
    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state-text">No users available</div>';
        return;
    }

    container.innerHTML = users.map(user => `
        <label>
            <input type="checkbox" value="${user.id}" />
            ${user.name || user.email} (${user.email})
        </label>
    `).join('');
}

function openUserModal(userId = null) {
    currentUserId = userId;
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const form = document.getElementById('user-form');

    if (userId) {
        const user = users.find(u => u.id === userId);
        if (!user) return;
        title.textContent = 'Edit User';
        document.getElementById('user-name').value = user.name || '';
        document.getElementById('user-email-input').value = user.email || '';
        document.getElementById('user-role').value = user.role || 'member';
        document.getElementById('user-phone').value = user.phone || '';
        document.querySelectorAll('input[name="alert-type"]').forEach(input => {
            input.checked = (user.alertPreferences || []).includes(input.value);
        });
    } else {
        title.textContent = 'Add User';
        form.reset();
    }

    modal.classList.add('active');
}

function closeUserModal() {
    document.getElementById('user-modal').classList.remove('active');
    currentUserId = null;
}

async function loadUsers() {
    try {
        users = await apiRequest('/users');
        renderUsers();
        populateGroupMembers();
    } catch (error) {
        users = [];
        renderUsers();
        populateGroupMembers();
        console.error('Failed to load users:', error);
    }
}

async function loadGroups() {
    try {
        groups = await apiRequest('/users/groups');
        renderGroups();
    } catch (error) {
        groups = [];
        renderGroups();
        console.error('Failed to load groups:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    document.getElementById('add-user-btn').addEventListener('click', () => openUserModal());
    document.getElementById('add-group-btn').addEventListener('click', () => {
        document.getElementById('group-form').reset();
        populateGroupMembers();
        document.getElementById('group-modal').classList.add('active');
    });

    document.querySelectorAll('#user-modal .close, #cancel-user-btn').forEach(el => {
        el.addEventListener('click', closeUserModal);
    });

    document.querySelectorAll('#group-modal .close, #cancel-group-btn').forEach(el => {
        el.addEventListener('click', () => document.getElementById('group-modal').classList.remove('active'));
    });

    document.getElementById('user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const alerts = Array.from(document.querySelectorAll('input[name="alert-type"]:checked')).map(input => input.value);
        const payload = {
            name: document.getElementById('user-name').value.trim(),
            email: document.getElementById('user-email-input').value.trim(),
            role: document.getElementById('user-role').value,
            alertPreferences: alerts,
            phone: document.getElementById('user-phone').value.trim(),
            status: 'active'
        };
        if (!payload.name || !payload.email) return;

        try {
            if (currentUserId) {
                await apiRequest(`/users/${currentUserId}`, { method: 'PUT', body: JSON.stringify(payload) });
            } else {
                await apiRequest('/users', { method: 'POST', body: JSON.stringify(payload) });
            }

            await loadUsers();
            closeUserModal();
        } catch (error) {
            alert(`Failed to save user: ${error.message}`);
        }
    });

    document.getElementById('group-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const members = Array.from(document.querySelectorAll('#group-members input[type="checkbox"]:checked')).map(input => input.value);
        const payload = {
            name: document.getElementById('group-name').value.trim(),
            description: document.getElementById('group-description').value.trim(),
            members
        };
        if (!payload.name) return;

        try {
            await apiRequest('/users/groups', { method: 'POST', body: JSON.stringify(payload) });
            await loadGroups();
            document.getElementById('group-modal').classList.remove('active');
        } catch (error) {
            alert(`Failed to create group: ${error.message}`);
        }
    });

    await Promise.allSettled([loadUsers(), loadGroups()]);
});
