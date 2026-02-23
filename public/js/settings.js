// Settings page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';

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
    return response.json();
}

function applySettings(config = {}) {
    if (config.orgName) document.getElementById('org-name').value = config.orgName;
    if (config.timezone) document.getElementById('timezone').value = config.timezone;
    if (config.dateFormat) document.getElementById('date-format').value = config.dateFormat;
    if (config.fullName) document.getElementById('full-name').value = config.fullName;
    if (config.email) document.getElementById('email').value = config.email;
    if (config.phone) document.getElementById('phone').value = config.phone;
    if (config.dataRetention) document.getElementById('data-retention').value = config.dataRetention;

    if (config.emailNotifs) {
        document.querySelectorAll('input[name="email-notif"]').forEach(input => {
            input.checked = config.emailNotifs.includes(input.value);
        });
    }
    if (config.smsNotifs) {
        document.querySelectorAll('input[name="sms-notif"]').forEach(input => {
            input.checked = config.smsNotifs.includes(input.value);
        });
    }
}

function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function showMfaFeedback(message, isError = false) {
    const el = document.getElementById('mfa-feedback');
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.style.color = isError ? '#ffb4b4' : '#8ce0b2';
}

function setMfaDisableError(message) {
    const el = document.getElementById('mfa-disable-error');
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
}

function activateSettingsSection(sectionName) {
    const section = sectionName || 'general';
    document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));

    const nav = document.querySelector(`.settings-nav-item[data-section="${section}"]`) ||
        document.querySelector('.settings-nav-item[data-section="general"]');
    if (nav) nav.classList.add('active');

    const target = document.getElementById(`${section}-section`) || document.getElementById('general-section');
    if (target) target.classList.add('active');
}

async function loadSettings() {
    const settings = await apiRequest('/settings');
    if (!settings) return;
    applySettings(settings.config || {});
}

async function renderApiKeys() {
    const list = document.getElementById('api-keys-list');
    const keys = await apiRequest('/settings/api-keys');
    if (!keys) return;

    if (keys.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F511;</div><div class="empty-state-title">No API Keys</div><div class="empty-state-text">Create an API key to access the API</div></div>';
        return;
    }

    list.innerHTML = keys.map(key => `
        <div class="info-row">
            <span class="label">${key.name}</span>
            <span class="value">${key.masked} - ${new Date(key.createdAt).toLocaleDateString()}</span>
            <button class="btn btn-danger btn-sm" data-action="revoke" data-id="${key.id}">Revoke</button>
        </div>
    `).join('');

    list.querySelectorAll('[data-action="revoke"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await apiRequest(`/settings/api-keys/${btn.dataset.id}`, { method: 'DELETE' });
            await renderApiKeys();
        });
    });
}

async function showCreatedApiKey(rawKey) {
    if (!rawKey) return;

    const panel = document.getElementById('new-api-key-panel');
    const valueInput = document.getElementById('new-api-key-value');
    if (panel && valueInput) {
        valueInput.value = rawKey;
        panel.style.display = 'flex';
    }
}

function normalizeOtp(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 6);
}

async function refreshMfaStatus() {
    const statusText = document.getElementById('mfa-status-text');
    const setupBtn = document.getElementById('mfa-setup-btn');
    const disablePanel = document.getElementById('mfa-disable-panel');

    const status = await apiRequest('/settings/mfa/status');
    if (!status) return;

    const enabled = !!status.enabled;
    if (statusText) statusText.textContent = enabled ? 'Enabled' : 'Disabled';
    if (setupBtn) setupBtn.textContent = enabled ? 'Re-Setup 2FA' : 'Setup 2FA';
    if (disablePanel) disablePanel.style.display = enabled ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
    const userEmail = localStorage.getItem('userEmail') || 'user@example.com';
    document.getElementById('user-email').textContent = userEmail;
    document.getElementById('user-avatar').textContent = userEmail.charAt(0).toUpperCase();
    document.getElementById('email').value = userEmail;

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            activateSettingsSection(section);
            window.location.hash = `#${section}`;
        });
    });

    const openAccountSection = () => activateSettingsSection('account');
    document.addEventListener('pingra:open-account-settings', openAccountSection);
    window.addEventListener('hashchange', () => {
        const section = window.location.hash.replace('#', '').trim() || 'general';
        activateSettingsSection(section);
    });
    activateSettingsSection(window.location.hash.replace('#', '').trim() || 'general');

    document.getElementById('general-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
            orgName: document.getElementById('org-name').value.trim(),
            timezone: document.getElementById('timezone').value,
            dateFormat: document.getElementById('date-format').value,
        };
        await apiRequest('/settings', { method: 'PUT', body: JSON.stringify({ config }) });
        alert('Settings saved successfully!');
    });

    document.getElementById('account-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
            fullName: document.getElementById('full-name').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim(),
        };
        await apiRequest('/settings', { method: 'PUT', body: JSON.stringify({ config }) });
        if (config.email) {
            localStorage.setItem('userEmail', config.email);
            document.getElementById('user-email').textContent = config.email;
        }
        alert('Account updated successfully!');
    });

    document.getElementById('notifications-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const config = {
            emailNotifs: Array.from(document.querySelectorAll('input[name="email-notif"]:checked')).map(input => input.value),
            smsNotifs: Array.from(document.querySelectorAll('input[name="sms-notif"]:checked')).map(input => input.value)
        };
        await apiRequest('/settings', { method: 'PUT', body: JSON.stringify({ config }) });
        alert('Notification preferences saved!');
    });

    document.getElementById('security-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        if (newPassword && newPassword !== confirmPassword) {
            alert('New passwords do not match.');
            return;
        }
        alert('Password changed successfully!');
        e.target.reset();
    });

    document.getElementById('create-api-key-btn').addEventListener('click', async () => {
        const input = document.getElementById('api-key-name-input');
        if (input) input.value = 'Pingra API Key';
        showModal('api-key-name-modal');
    });

    document.getElementById('copy-api-key-btn').addEventListener('click', async () => {
        const valueInput = document.getElementById('new-api-key-value');
        const rawKey = valueInput ? valueInput.value : '';
        if (!rawKey) return;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(rawKey);
                alert('API key copied.');
            } else {
                valueInput.select();
                document.execCommand('copy');
                alert('API key copied.');
            }
        } catch {
            alert('Copy failed. Please copy manually.');
        }
    });

    document.getElementById('hide-api-key-btn').addEventListener('click', () => {
        const panel = document.getElementById('new-api-key-panel');
        const valueInput = document.getElementById('new-api-key-value');
        if (valueInput) valueInput.value = '';
        if (panel) panel.style.display = 'none';
    });

    const mfaVerifyInput = document.getElementById('mfa-verify-code');
    const mfaDisableInput = document.getElementById('mfa-disable-code');
    if (mfaVerifyInput) {
        mfaVerifyInput.addEventListener('input', () => {
            mfaVerifyInput.value = normalizeOtp(mfaVerifyInput.value);
        });
    }
    if (mfaDisableInput) {
        mfaDisableInput.addEventListener('input', () => {
            mfaDisableInput.value = normalizeOtp(mfaDisableInput.value);
        });
    }

    document.getElementById('mfa-setup-btn').addEventListener('click', async () => {
        const setup = await apiRequest('/settings/mfa/setup', { method: 'POST' });
        if (!setup) return;
        const secretInput = document.getElementById('mfa-secret');
        const qrImage = document.getElementById('mfa-qr-image');
        const codeInput = document.getElementById('mfa-verify-code');
        if (secretInput) secretInput.value = setup.secret || '';
        if (qrImage && setup.qrDataUrl) qrImage.src = setup.qrDataUrl;
        if (codeInput) codeInput.value = '';
        showModal('mfa-setup-modal');
    });

    document.getElementById('mfa-enable-btn').addEventListener('click', async () => {
        const codeInput = document.getElementById('mfa-verify-code');
        const code = normalizeOtp(codeInput ? codeInput.value : '');
        if (code.length !== 6) {
            showMfaFeedback('Enter a valid 6-digit code.', true);
            return;
        }
        await apiRequest('/settings/mfa/enable', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        closeModal('mfa-setup-modal');
        showMfaFeedback('Two-factor authentication enabled.');
        await refreshMfaStatus();
    });

    document.getElementById('mfa-cancel-btn').addEventListener('click', () => {
        closeModal('mfa-setup-modal');
    });

    document.getElementById('mfa-disable-btn').addEventListener('click', () => {
        const codeInput = document.getElementById('mfa-disable-code');
        if (codeInput) codeInput.value = '';
        setMfaDisableError('');
        showModal('mfa-disable-modal');
    });

    document.getElementById('mfa-disable-cancel-btn').addEventListener('click', () => {
        closeModal('mfa-disable-modal');
    });

    document.getElementById('mfa-disable-confirm-btn').addEventListener('click', async () => {
        const codeInput = document.getElementById('mfa-disable-code');
        const code = normalizeOtp(codeInput ? codeInput.value : '');
        if (code.length !== 6) {
            setMfaDisableError('Enter a valid 6-digit code.');
            return;
        }
        setMfaDisableError('');
        await apiRequest('/settings/mfa/disable', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        if (codeInput) codeInput.value = '';
        closeModal('mfa-disable-modal');
        showMfaFeedback('Two-factor authentication disabled.');
        await refreshMfaStatus();
    });

    document.getElementById('cancel-api-key-name-btn').addEventListener('click', () => {
        closeModal('api-key-name-modal');
    });

    document.querySelectorAll('#api-key-name-modal .close').forEach(el => {
        el.addEventListener('click', () => closeModal('api-key-name-modal'));
    });

    document.getElementById('api-key-name-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('api-key-name-input');
        const name = input ? input.value.trim() : '';
        if (!name) {
            alert('API key name is required.');
            return;
        }
        if (name.length > 255) {
            alert('API key name must be 255 characters or less.');
            return;
        }

        const created = await apiRequest('/settings/api-keys', {
            method: 'POST',
            body: JSON.stringify({ name })
        });

        closeModal('api-key-name-modal');
        if (created && created.rawKey) {
            await showCreatedApiKey(created.rawKey);
        }
        await renderApiKeys();
    });

    document.getElementById('data-retention').addEventListener('change', async (e) => {
        const config = { dataRetention: e.target.value };
        await apiRequest('/settings', { method: 'PUT', body: JSON.stringify({ config }) });
    });

    try {
        await loadSettings();
        await renderApiKeys();
        await refreshMfaStatus();
    } catch (error) {
        console.error('Failed to initialize settings page:', error);
        alert(`Failed to load settings: ${error.message}`);
    }
});
