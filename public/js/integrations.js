// Integrations page JavaScript
const API_BASE_URL = window.API_BASE_URL || '/api';
let integrations = [];
let pendingDisconnectId = null;

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

function renderActiveIntegrations() {
    const container = document.getElementById('active-integrations');
    if (integrations.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#x1F517;</div><div class="empty-state-title">No Active Integrations</div><div class="empty-state-text">Connect your first integration below</div></div>';
        return;
    }

    container.innerHTML = integrations.map(integration => `
        <div class="integration-card">
            <div class="integration-logo">${integration.type.toUpperCase()}</div>
            <h4>${integration.name}</h4>
            <p>${formatIntegrationEndpoint(integration)}</p>
            <div class="integration-status">
                <span class="status-pill status-up"></span>
                Active
            </div>
            <button class="btn btn-secondary btn-sm" data-action="disconnect" data-id="${integration.id}" type="button">Disconnect</button>
        </div>
    `).join('');

    container.querySelectorAll('[data-action="disconnect"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            pendingDisconnectId = btn.dataset.id;
            showModal('disconnect-confirm-modal');
        });
    });
}

function formatIntegrationEndpoint(integration) {
    if (!integration) return '';
    const type = integration.type;
    const config = integration.configuration || {};

    if (type === 'jira') {
        const base = config.baseUrl || integration.endpoint;
        const project = config.projectKey ? ` • ${config.projectKey}` : '';
        return `${base || 'Jira'}${project}`;
    }

    if (type === 'call') {
        const provider = (config.provider || 'twilio').toLowerCase();
        if (provider === 'asterisk' || provider === 'freepbx') {
            return config.apiUrl || integration.endpoint || 'Asterisk/FreePBX API';
        }
        const from = config.fromNumber || integration.endpoint;
        return from ? `Calls from ${from}` : 'Voice alerts';
    }

    if (type === 'email') {
        return config.email || integration.endpoint;
    }

    if (type === 'twilio') {
        const from = config.fromNumber || integration.endpoint;
        return from ? `SMS from ${from}` : 'Twilio SMS';
    }

    return integration.endpoint || '';
}

async function loadIntegrations() {
    try {
        integrations = await apiRequest('/integrations');
        renderActiveIntegrations();
    } catch (error) {
        console.error(error);
    }
}

async function loadContactRecipientSummary() {
    const summaryEl = document.getElementById('recipient-summary');
    if (!summaryEl) return;

    try {
        const lists = await apiRequest('/contact-lists');
        const listArray = Array.isArray(lists) ? lists : [];

        let totalMembers = 0;
        for (const list of listArray) {
            const members = await apiRequest(`/contact-lists/${list.id}/members`);
            if (Array.isArray(members)) {
                totalMembers += members.filter(member => member && member.enabled !== false).length;
            }
        }

        summaryEl.textContent = `${totalMembers} contact recipient(s) from ${listArray.length} contact list(s) will receive integration alerts.`;
    } catch (error) {
        summaryEl.textContent = 'Unable to load contact recipient summary.';
        console.error(error);
    }
}

function openIntegrationModal(integration) {
    const modal = document.getElementById('integration-modal');
    const title = document.getElementById('integration-modal-title');
    const fields = document.getElementById('integration-config-fields');

    title.textContent = `Configure ${integration.charAt(0).toUpperCase() + integration.slice(1)}`;

    fields.innerHTML = buildIntegrationFields(integration);
    if (integration === 'call') {
        setupCallProviderVisibility();
    }

    modal.dataset.integration = integration;
    modal.classList.add('active');
}

function setupCallProviderVisibility() {
    const providerSelect = document.getElementById('call-provider');
    const twilioFields = document.getElementById('call-twilio-fields');
    const asteriskFields = document.getElementById('call-asterisk-fields');
    if (!providerSelect || !twilioFields || !asteriskFields) return;

    const update = () => {
        const provider = providerSelect.value;
        const isAsterisk = provider === 'asterisk' || provider === 'freepbx';
        twilioFields.style.display = isAsterisk ? 'none' : 'block';
        asteriskFields.style.display = isAsterisk ? 'block' : 'none';
    };

    providerSelect.addEventListener('change', update);
    update();
}

function buildIntegrationFields(type) {
    if (type === 'jira') {
        return `
            <div class="form-group">
                <label>Integration Name</label>
                <input type="text" id="integration-name" placeholder="My Jira Integration" required />
            </div>
            <div class="form-group">
                <label>Jira Base URL</label>
                <input type="url" id="jira-base-url" placeholder="https://your-domain.atlassian.net" required />
            </div>
            <div class="form-group">
                <label>Jira Email</label>
                <input type="email" id="jira-email" placeholder="you@company.com" required />
            </div>
            <div class="form-group">
                <label>Jira API Token</label>
                <input type="password" id="jira-token" placeholder="Enter API token" required />
            </div>
            <div class="form-group">
                <label>Project Key</label>
                <input type="text" id="jira-project" placeholder="OPS" required />
            </div>
            <div class="form-group">
                <label>Issue Type</label>
                <input type="text" id="jira-issue-type" placeholder="Incident" />
            </div>
        `;
    }

    if (type === 'call') {
        return `
            <div class="form-group">
                <label>Integration Name</label>
                <input type="text" id="integration-name" placeholder="Critical Call Alerts" required />
            </div>
            <div class="form-group">
                <label>Default Number (Optional)</label>
                <input type="tel" id="call-phone" placeholder="+1 (555) 123-4567" />
            </div>
            <div class="form-group">
                <label>Provider</label>
                <select id="call-provider">
                    <option value="twilio">Twilio</option>
                    <option value="asterisk">Asterisk / FreePBX</option>
                </select>
            </div>
            <div id="call-twilio-fields">
                <div class="form-group">
                    <label>Twilio Account SID</label>
                    <input type="text" id="call-account-sid" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </div>
                <div class="form-group">
                    <label>Twilio Auth Token</label>
                    <input type="password" id="call-auth-token" placeholder="Auth Token" />
                </div>
                <div class="form-group">
                    <label>From Number</label>
                    <input type="tel" id="call-from-number" placeholder="+15551234567" />
                </div>
            </div>
            <div id="call-asterisk-fields" style="display:none;">
                <div class="form-group">
                    <label>Asterisk/FreePBX API URL</label>
                    <input type="url" id="call-api-url" placeholder="http://pbx.local/api/originate" />
                </div>
                <div class="form-group">
                    <label>HTTP Method</label>
                    <select id="call-api-method">
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>API Token (Optional)</label>
                    <input type="password" id="call-api-token" placeholder="Bearer token" />
                </div>
            </div>
        `;
    }

    if (type === 'twilio') {
        return `
            <div class="form-group">
                <label>Integration Name</label>
                <input type="text" id="integration-name" placeholder="Twilio SMS Alerts" required />
            </div>
            <div class="form-group">
                <label>From Number</label>
                <input type="tel" id="integration-endpoint" placeholder="+15551234567" required />
            </div>
            <div class="form-group">
                <label>Twilio Account SID</label>
                <input type="text" id="twilio-account-sid" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" required />
            </div>
            <div class="form-group">
                <label>Twilio Auth Token</label>
                <input type="password" id="twilio-auth-token" placeholder="Auth Token" required />
            </div>
        `;
    }

    if (type === 'sendgrid') {
        return `
            <div class="form-group">
                <label>Integration Name</label>
                <input type="text" id="integration-name" placeholder="SendGrid Alerts" required />
            </div>
            <div class="form-group">
                <label>From Email</label>
                <input type="email" id="integration-endpoint" placeholder="alerts@example.com" required />
            </div>
            <div class="form-group">
                <label>SendGrid API Key</label>
                <input type="password" id="integration-secret" placeholder="SG.xxxxxx" />
            </div>
        `;
    }

    let endpointLabel = 'Webhook URL';
    let endpointPlaceholder = 'https://hooks.example.com/...';
    let helper = '';

    if (type === 'email') {
        endpointLabel = 'Email Address';
        endpointPlaceholder = 'alerts@example.com';
    } else if (type === 'twilio') {
        endpointLabel = 'Phone Number';
        endpointPlaceholder = '+1 (555) 123-4567';
    } else if (type === 'pagerduty' || type === 'opsgenie') {
        endpointLabel = 'API Key';
        endpointPlaceholder = 'Enter API key';
    } else if (type === 'victorops') {
        endpointLabel = 'Routing Key';
        endpointPlaceholder = 'Enter routing key';
    } else if (type === 'zapier') {
        endpointLabel = 'Zapier Webhook';
        endpointPlaceholder = 'https://hooks.zapier.com/...';
    } else if (type === 'slack' || type === 'teams' || type === 'discord' || type === 'webhook') {
        endpointLabel = 'Webhook URL';
        endpointPlaceholder = 'https://hooks.example.com/...';
    }

    if (type === 'pagerduty') {
        helper = '<small>Events API v2 routing key</small>';
    }

    return `
        <div class="form-group">
            <label>Integration Name</label>
            <input type="text" id="integration-name" placeholder="My ${type} Integration" required />
        </div>
        <div class="form-group">
            <label>${endpointLabel}</label>
            <input type="text" id="integration-endpoint" placeholder="${endpointPlaceholder}" required />
            ${helper}
        </div>
    `;
}

function closeIntegrationModal() {
    const modal = document.getElementById('integration-modal');
    modal.classList.remove('active');
    modal.dataset.integration = '';
}

function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function showCenteredMessage(message, title = 'Notice') {
    const titleEl = document.getElementById('integration-feedback-title');
    const messageEl = document.getElementById('integration-feedback-message');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message || '';
    showModal('integration-feedback-modal');
}

function openSmtpModal() {
    showModal('smtp-modal');
    loadSmtpConfig();
}

function closeSmtpModal() {
    closeModal('smtp-modal');
}

function setSmtpStatus(message, isError = false) {
    const el = document.getElementById('smtp-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#ffb4b4' : '#9fd0ff';
}

async function loadSmtpConfig() {
    const smtpHost = document.getElementById('smtp-host');
    if (!smtpHost) return;

    try {
        const smtp = await apiRequest('/settings/smtp');
        if (!smtp) return;

        document.getElementById('smtp-host').value = smtp.host || '';
        document.getElementById('smtp-port').value = smtp.port || 587;
        document.getElementById('smtp-username').value = smtp.username || '';
        document.getElementById('smtp-from').value = smtp.from || '';
        document.getElementById('smtp-secure').checked = !!smtp.secure;

        if (smtp.hasPassword) {
            setSmtpStatus('SMTP password is already configured. Leave password blank to keep it.');
        } else {
            setSmtpStatus('Configure SMTP to enable real email delivery.');
        }
    } catch (error) {
        setSmtpStatus(`Failed to load SMTP settings: ${error.message}`, true);
    }
}

async function saveSmtpConfig() {
    const payload = {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value || 587),
        username: document.getElementById('smtp-username').value.trim(),
        from: document.getElementById('smtp-from').value.trim(),
        secure: document.getElementById('smtp-secure').checked,
        password: document.getElementById('smtp-password').value || '',
    };

    await apiRequest('/settings/smtp', {
        method: 'PUT',
        body: JSON.stringify(payload),
    });

    document.getElementById('smtp-password').value = '';
    setSmtpStatus('SMTP settings saved successfully.');
}

async function testSmtpConfig() {
    const to = document.getElementById('smtp-test-recipient').value.trim();
    const result = await apiRequest('/settings/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to }),
    });

    setSmtpStatus((result && result.message) || 'Test email sent.');
}

function filterAvailableIntegrations(term, category) {
    const cards = document.querySelectorAll('.available-integrations-section .integration-card');
    const search = (term || '').toLowerCase();
    cards.forEach(card => {
        const type = (card.dataset.type || '').toLowerCase();
        const title = card.querySelector('h4')?.textContent?.toLowerCase() || '';
        const matchesSearch = !search || type.includes(search) || title.includes(search);
        const matchesCategory = category === 'all' || card.dataset.category === category;
        card.style.display = matchesSearch && matchesCategory ? 'block' : 'none';
    });
}

function buildIntegrationPayload(type) {
    if (type === 'jira') {
        const baseUrl = document.getElementById('jira-base-url').value.trim();
        const email = document.getElementById('jira-email').value.trim();
        const token = document.getElementById('jira-token').value.trim();
        const projectKey = document.getElementById('jira-project').value.trim();
        const issueType = document.getElementById('jira-issue-type').value.trim() || 'Incident';
        return {
            endpoint: baseUrl,
            configuration: { baseUrl, email, token, projectKey, issueType }
        };
    }

    if (type === 'call') {
        const phone = document.getElementById('call-phone').value.trim();
        const provider = document.getElementById('call-provider').value;
        const accountSid = document.getElementById('call-account-sid').value.trim();
        const authToken = document.getElementById('call-auth-token').value.trim();
        const fromNumber = document.getElementById('call-from-number').value.trim();
        const apiUrl = (document.getElementById('call-api-url')?.value || '').trim();
        const method = (document.getElementById('call-api-method')?.value || 'POST').trim();
        const apiToken = (document.getElementById('call-api-token')?.value || '').trim();
        if (provider === 'asterisk') {
            return {
                endpoint: apiUrl,
                configuration: { phone, provider, apiUrl, method, apiToken }
            };
        }
        return {
            endpoint: fromNumber || phone,
            configuration: { phone, provider, accountSid, authToken, fromNumber }
        };
    }

    if (type === 'sendgrid') {
        const fromEmail = document.getElementById('integration-endpoint').value.trim();
        const apiKey = document.getElementById('integration-secret')?.value.trim() || '';
        return {
            endpoint: fromEmail,
            configuration: { fromEmail, apiKey }
        };
    }

    if (type === 'email') {
        const email = document.getElementById('integration-endpoint').value.trim();
        return {
            endpoint: email,
            configuration: { email }
        };
    }

    if (type === 'twilio') {
        const fromNumber = document.getElementById('integration-endpoint').value.trim();
        const accountSid = document.getElementById('twilio-account-sid').value.trim();
        const authToken = document.getElementById('twilio-auth-token').value.trim();
        return {
            endpoint: fromNumber,
            configuration: { provider: 'twilio', fromNumber, accountSid, authToken }
        };
    }

    const endpoint = document.getElementById('integration-endpoint').value.trim();
    return {
        endpoint,
        configuration: {}
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadIntegrations();
    await loadContactRecipientSummary();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userEmail');
        window.location.href = '/login.html';
    });

    const searchInput = document.getElementById('integration-search');
    const filterSelect = document.getElementById('integration-filter');
    if (searchInput && filterSelect) {
        searchInput.addEventListener('input', () => {
            filterAvailableIntegrations(searchInput.value, filterSelect.value);
        });
        filterSelect.addEventListener('change', () => {
            filterAvailableIntegrations(searchInput.value, filterSelect.value);
        });
    }

    document.querySelectorAll('[data-integration]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const integration = e.target.dataset.integration;
            openIntegrationModal(integration);
        });
    });

    document.querySelectorAll('#integration-modal .close, #cancel-integration-btn').forEach(el => {
        el.addEventListener('click', closeIntegrationModal);
    });

    document.querySelectorAll('#disconnect-confirm-modal .close, #cancel-disconnect-btn').forEach(el => {
        el.addEventListener('click', () => {
            pendingDisconnectId = null;
            closeModal('disconnect-confirm-modal');
        });
    });

    const smtpSettingsBtn = document.getElementById('smtp-settings-btn');
    if (smtpSettingsBtn) {
        smtpSettingsBtn.addEventListener('click', openSmtpModal);
    }

    document.querySelectorAll('#smtp-modal .close, #smtp-cancel-btn').forEach(el => {
        el.addEventListener('click', closeSmtpModal);
    });

    const confirmDisconnectBtn = document.getElementById('confirm-disconnect-btn');
    confirmDisconnectBtn.addEventListener('click', async () => {
        if (!pendingDisconnectId) return;
        await apiRequest(`/integrations/${pendingDisconnectId}`, { method: 'DELETE' });
        pendingDisconnectId = null;
        closeModal('disconnect-confirm-modal');
        await loadIntegrations();
    });

    document.getElementById('integration-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const modal = document.getElementById('integration-modal');
        const integrationType = modal.dataset.integration;
        if (!integrationType) return;

        const name = document.getElementById('integration-name').value.trim();
        if (!name) return;

        const payload = buildIntegrationPayload(integrationType);
        if (!payload.endpoint) return;

        try {
            await apiRequest('/integrations', {
                method: 'POST',
                body: JSON.stringify({
                    type: integrationType,
                    name,
                    endpoint: payload.endpoint,
                    configuration: payload.configuration
                })
            });

            e.target.reset();
            closeIntegrationModal();
            await loadIntegrations();
            await loadContactRecipientSummary();
        } catch (error) {
            showCenteredMessage(`Failed to save integration: ${error.message}`, 'Integration Error');
        }
    });

    const smtpForm = document.getElementById('smtp-form');
    if (smtpForm) {
        smtpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await saveSmtpConfig();
                closeSmtpModal();
            } catch (error) {
                setSmtpStatus(`Failed to save SMTP settings: ${error.message}`, true);
            }
        });
    }

    const smtpTestBtn = document.getElementById('smtp-test-btn');
    if (smtpTestBtn) {
        smtpTestBtn.addEventListener('click', async () => {
            try {
                await testSmtpConfig();
            } catch (error) {
                setSmtpStatus(`SMTP test failed: ${error.message}`, true);
            }
        });
    }

    const feedbackOkBtn = document.getElementById('integration-feedback-ok-btn');
    if (feedbackOkBtn) {
        feedbackOkBtn.addEventListener('click', () => closeModal('integration-feedback-modal'));
    }
});

