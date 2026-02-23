const API_BASE_URL = window.API_BASE_URL || '/api';
let contactLists = [];
let selectedListId = null;
let listMemberStats = new Map();
let listMemberPreview = new Map();

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

    if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
        return null;
    }

    if (!response.ok) {
        const text = await response.text();
        let message = 'Request failed';
        try {
            const parsed = text ? JSON.parse(text) : null;
            if (parsed && parsed.message) message = parsed.message;
        } catch {
            if (text) message = text;
        }
        throw new Error(message);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

async function loadContactLists() {
    try {
        const data = await apiRequest('/contact-lists');
        contactLists = Array.isArray(data) ? data : [];
        await loadListMemberStats();
        renderContactLists();

        if (contactLists.length > 0) {
            if (!selectedListId || !contactLists.some(list => list.id === selectedListId)) {
                selectedListId = contactLists[0].id;
            }
            await loadMembers();
        } else {
            selectedListId = null;
            renderMembers([]);
            document.getElementById('add-member-btn').disabled = true;
        }
    } catch (error) {
        console.error('Failed to load contact lists:', error);
        contactLists = [];
        listMemberStats = new Map();
        listMemberPreview = new Map();

        const tbody = document.querySelector('#contact-list-table tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">Failed to load contact lists. Please refresh.</td></tr>';
        }
    }
}

async function loadListMemberStats() {
    listMemberStats = new Map();
    listMemberPreview = new Map();

    await Promise.all(contactLists.map(async (list) => {
        try {
            const members = await apiRequest(`/contact-lists/${list.id}/members`);
            const safeMembers = Array.isArray(members) ? members : [];
            const enabled = safeMembers.filter(m => m && m.enabled !== false);
            const emailCount = enabled.filter(m => m.channelType === 'email').length;
            const phoneCount = enabled.filter(m => m.channelType === 'phone').length;
            const labels = [...new Set(enabled.map(m => (m.label || '').trim()).filter(Boolean))];
            const emails = [...new Set(enabled.filter(m => m.channelType === 'email').map(m => (m.contact || '').trim()).filter(Boolean))];
            const phones = [...new Set(enabled.filter(m => m.channelType === 'phone').map(m => (m.contact || '').trim()).filter(Boolean))];

            listMemberStats.set(list.id, {
                total: enabled.length,
                emailCount,
                phoneCount
            });
            listMemberPreview.set(list.id, {
                labels,
                emails,
                phones
            });
        } catch {
            listMemberStats.set(list.id, {
                total: 0,
                emailCount: 0,
                phoneCount: 0
            });
            listMemberPreview.set(list.id, {
                labels: [],
                emails: [],
                phones: []
            });
        }
    }));
}

function renderContactLists() {
    const tbody = document.querySelector('#contact-list-table tbody');
    if (!contactLists.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No contact lists yet.</td></tr>';
        return;
    }

    tbody.innerHTML = contactLists.map(list => `
        <tr data-id="${list.id}">
            <td>${escapeHtml(list.name)}</td>
            <td>${escapeHtml(list.description || '')}</td>
            <td>${formatMemberSummary(list.id)}</td>
            <td>${formatContactPreview(list.id)}</td>
            <td>
                <button class="btn btn-secondary btn-sm" data-action="view" data-id="${list.id}">View Members</button>
                <button class="btn btn-danger btn-sm" data-action="delete" data-id="${list.id}">Delete</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedListId = btn.dataset.id;
            loadMembers();
        });
    });

    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this list?')) return;
            await apiRequest(`/contact-lists/${btn.dataset.id}`, { method: 'DELETE' });
            if (selectedListId === btn.dataset.id) {
                selectedListId = null;
            }
            await loadContactLists();
            renderMembers([]);
        });
    });
}

function formatMemberSummary(listId) {
    const stats = listMemberStats.get(listId);
    if (!stats || stats.total === 0) {
        return '<span class="status-badge status-unknown">No members</span>';
    }

    return `<span class="status-badge status-up">${stats.total} members</span> (${stats.emailCount} email, ${stats.phoneCount} mobile)`;
}

function formatContactPreview(listId) {
    const preview = listMemberPreview.get(listId);
    if (!preview) {
        return '<span class="text-muted">No contacts</span>';
    }

    const label = preview.labels.length ? escapeHtml(preview.labels.join(', ')) : 'N/A';
    const email = preview.emails.length ? escapeHtml(preview.emails.slice(0, 2).join(', ')) : 'N/A';
    const phone = preview.phones.length ? escapeHtml(preview.phones.slice(0, 2).join(', ')) : 'N/A';

    return `${label}<br><small>${email} / ${phone}</small>`;
}

async function loadMembers() {
    if (!selectedListId) return;
    try {
        const members = await apiRequest(`/contact-lists/${selectedListId}/members`);
        renderMembers(Array.isArray(members) ? members : []);
        document.getElementById('add-member-btn').disabled = false;
    } catch (error) {
        console.error('Failed to load members:', error);
        renderMembers([]);
        document.getElementById('add-member-btn').disabled = true;
    }
}

function renderMembers(members) {
    const tbody = document.querySelector('#member-table tbody');
    if (!members || !members.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No members found.</td></tr>';
        return;
    }

    const grouped = groupMembersByUser(members);

    tbody.innerHTML = grouped.map(user => `
        <tr>
            <td>${escapeHtml(user.label || '')}</td>
            <td>${escapeHtml(user.email || '')}</td>
            <td>${escapeHtml(user.phone || '')}</td>
            <td>${user.enabled ? 'Active' : 'Disabled'}</td>
            <td>
                <button class="btn btn-danger btn-sm" data-action="delete-member" data-ids="${user.memberIds.join(',')}">Delete</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="delete-member"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!selectedListId) return;
            if (!confirm('Delete this member?')) return;
            const memberIds = (btn.dataset.ids || '').split(',').filter(Boolean);
            for (const memberId of memberIds) {
                await apiRequest(`/contact-lists/${selectedListId}/members/${memberId}`, { method: 'DELETE' });
            }
            await loadListMemberStats();
            renderContactLists();
            await loadMembers();
        });
    });
}

function groupMembersByUser(members) {
    const map = new Map();

    members.forEach((member) => {
        const key = member.label && member.label.trim().length > 0
            ? member.label.trim().toLowerCase()
            : member.id;

        if (!map.has(key)) {
            map.set(key, {
                label: member.label || '',
                email: '',
                phone: '',
                enabled: false,
                memberIds: [],
            });
        }

        const user = map.get(key);
        user.memberIds.push(member.id);
        user.enabled = user.enabled || !!member.enabled;

        if (member.channelType === 'email') {
            user.email = member.contact;
        } else if (member.channelType === 'phone') {
            user.phone = member.contact;
        }
    });

    return Array.from(map.values());
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    document.getElementById('add-list-btn').addEventListener('click', () => {
        document.getElementById('contact-list-form').reset();
        showModal('contact-list-modal');
    });

    document.getElementById('cancel-list-btn').addEventListener('click', () => closeModal('contact-list-modal'));
    document.querySelectorAll('#contact-list-modal .close').forEach(el => el.addEventListener('click', () => closeModal('contact-list-modal')));

    document.getElementById('contact-list-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('list-name').value.trim();
        const description = document.getElementById('list-description').value.trim();
        const firstMemberLabel = document.getElementById('first-member-label').value.trim();
        const firstMemberEmail = document.getElementById('first-member-email').value.trim();
        const firstMemberPhone = document.getElementById('first-member-phone').value.trim();
        if (!name) return;
        try {
            const createdList = await apiRequest('/contact-lists', {
                method: 'POST',
                body: JSON.stringify({ name, description })
            });

            const hasFirstContact = !!(firstMemberLabel || firstMemberEmail || firstMemberPhone);
            if (hasFirstContact && createdList && createdList.id) {
                if (!firstMemberLabel || (!firstMemberEmail && !firstMemberPhone)) {
                    alert('To add first contact now, provide contact name and at least email or mobile.');
                } else {
                    await apiRequest(`/contact-lists/${createdList.id}/members`, {
                        method: 'POST',
                        body: JSON.stringify({
                            label: firstMemberLabel,
                            email: firstMemberEmail,
                            phone: firstMemberPhone
                        })
                    });
                }
            }

            closeModal('contact-list-modal');
            await loadContactLists();
        } catch (error) {
            alert(`Failed to create contact list: ${error.message}`);
        }
    });

    document.getElementById('add-member-btn').addEventListener('click', () => {
        if (!selectedListId) return;
        document.getElementById('member-form').reset();
        showModal('member-modal');
    });

    document.getElementById('cancel-member-btn').addEventListener('click', () => closeModal('member-modal'));
    document.querySelectorAll('#member-modal .close').forEach(el => el.addEventListener('click', () => closeModal('member-modal')));

    document.getElementById('member-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!selectedListId) return;
        const email = document.getElementById('member-email').value.trim();
        const phone = document.getElementById('member-phone').value.trim();
        const label = document.getElementById('member-label').value.trim();
        if (!label || (!email && !phone)) return;
        try {
            await apiRequest(`/contact-lists/${selectedListId}/members`, {
                method: 'POST',
                body: JSON.stringify({ label, email, phone })
            });
            closeModal('member-modal');
            await loadListMemberStats();
            renderContactLists();
            await loadMembers();
        } catch (error) {
            alert(`Failed to add contact member: ${error.message}`);
        }
    });

    await loadContactLists();
});
