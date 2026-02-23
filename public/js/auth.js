/**
 * Authentication Module
 * Handles login, logout, and token management
 */

window.API_BASE_URL = window.API_BASE_URL || '/api';

// Check if on login/signup page
const isAuthPage = window.location.pathname === '/login.html' || window.location.pathname === '/signup.html';

// If on auth page and already logged in, redirect to home
if (isAuthPage && localStorage.getItem('token')) {
    window.location.href = '/home.html';
}

// Login form handler (only if login form exists)
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const otpInput = document.getElementById('otp');
        const otp = otpInput ? String(otpInput.value || '').replace(/\D/g, '').slice(0, 6) : '';
        const errorMessage = document.getElementById('error-message');
        
        if (errorMessage) {
            errorMessage.classList.remove('active');
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, otp: otp || undefined })
            });
            
            if (!response.ok) {
                const error = await response.json();
                if (error && error.requiresMfa && otpInput) {
                    otpInput.focus();
                }
                throw new Error(error.message || 'Login failed');
            }
            
            const data = await response.json();
            
            // Store token and email for UI personalization
            localStorage.setItem('token', data.token);
            localStorage.setItem('userEmail', email);
            
            // Redirect to home
            window.location.href = '/home.html';
        } catch (error) {
            if (errorMessage) {
                errorMessage.textContent = error.message;
                errorMessage.classList.add('active');
            }
        }
    });
}

// Check authentication for protected pages
if (!isAuthPage) {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
    }
}

function populateUserInfo() {
    const email = localStorage.getItem('userEmail') || 'User';
    const userEmailEl = document.getElementById('user-email');
    if (userEmailEl) {
        userEmailEl.textContent = email;
        userEmailEl.style.cursor = 'pointer';
        userEmailEl.title = 'Open account settings';
    }
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) {
        const initial = (email || 'U').trim().charAt(0).toUpperCase() || 'U';
        avatarEl.textContent = initial;
    }
}

function normalizeSidebarIcons() {
    const iconByPath = {
        '/home.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5"/></svg>',
        '/monitors.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 14v3M12 10v7M16 7v10"/></svg>',
        '/incidents.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3zM12 9v5M12 17.2v.3"/></svg>',
        '/reports.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16l4-4 3 2 4-5"/></svg>',
        '/status.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h3l2-4 4 8 2-4h5"/></svg>',
        '/contact-lists.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 20v-1c0-2.2 2.2-4 5-4s5 1.8 5 4v1M14 20v-1c0-1.5 1.5-2.8 3.5-2.8S21 17.5 21 19v1"/></svg>',
        '/integrations.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14 7.5 16.5a3 3 0 1 1-4.2-4.2L5.8 9.8M14 10l2.5-2.5a3 3 0 1 1 4.2 4.2L18.2 14.2M8.5 15.5l7-7"/></svg>',
        '/users.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.5 20v-1c0-2.2 2.2-4 5-4s5 1.8 5 4v1M14 20v-1c0-1.5 1.5-2.8 3.5-2.8S21 17.5 21 19v1"/></svg>',
        '/settings.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 3.5-2 .7a7.8 7.8 0 0 1-.6 1.5l1 1.8-1.9 1.9-1.8-1a7.8 7.8 0 0 1-1.5.6L14 21h-4l-.7-2a7.8 7.8 0 0 1-1.5-.6l-1.8 1-1.9-1.9 1-1.8a7.8 7.8 0 0 1-.6-1.5L3 12l.7-2a7.8 7.8 0 0 1 .6-1.5l-1-1.8 1.9-1.9 1.8 1a7.8 7.8 0 0 1 1.5-.6L10 3h4l.7 2a7.8 7.8 0 0 1 1.5.6l1.8-1 1.9 1.9-1 1.8a7.8 7.8 0 0 1 .6 1.5L21 12Z"/></svg>'
    };

    document.querySelectorAll('.nav-link').forEach((link) => {
        const span = link.querySelector('span');
        if (!span) return;

        const href = link.getAttribute('href') || '';
        const icon = iconByPath[href];
        if (icon) {
            span.classList.add('nav-icon');
            span.innerHTML = icon;
        }
    });
}

function setupGlobalModalControls() {
    const activeModals = () => document.querySelectorAll('.modal.active');

    document.querySelectorAll('.modal').forEach((modal) => {
        const header = modal.querySelector('.modal-header');
        const modalContent = modal.querySelector('.modal-content');
        if (!header || !modalContent || !modal.id) return;

        if (!header.querySelector('[data-close-modal]')) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'modal-close-btn';
            closeBtn.dataset.closeModal = modal.id;
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.innerHTML = '&times;';
            header.appendChild(closeBtn);
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    document.addEventListener('click', (event) => {
        const closeButton = event.target.closest('[data-close-modal]');
        if (closeButton) {
            const id = closeButton.getAttribute('data-close-modal');
            const modal = id ? document.getElementById(id) : null;
            if (modal) modal.classList.remove('active');
            return;
        }

        const legacyClose = event.target.closest('.modal .close');
        if (legacyClose) {
            const modal = legacyClose.closest('.modal');
            if (modal) modal.classList.remove('active');
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            activeModals().forEach((modal) => modal.classList.remove('active'));
        }
    });
}

function setupGlobalNavigationShortcuts() {
    const goHome = () => {
        if (window.location.pathname !== '/home.html') {
            window.location.href = '/home.html';
        }
    };

    document.querySelectorAll('.brand, .brand-name, .brand-mark, .hetrix-title').forEach((el) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', goHome);
    });

    const openSettingsSection = (section) => {
        const target = `/settings.html#${section}`;
        if (window.location.pathname === '/settings.html') {
            window.location.hash = `#${section}`;
            if (section === 'account') {
                document.dispatchEvent(new CustomEvent('pingra:open-account-settings'));
            }
            return;
        }
        window.location.href = target;
    };

    const userInfoEl = document.querySelector('.user-info');
    const userEmailEl = document.getElementById('user-email');
    if (!userInfoEl || !userEmailEl) return;

    userInfoEl.classList.add('user-menu-host');
    userInfoEl.setAttribute('role', 'button');
    userInfoEl.setAttribute('tabindex', '0');
    userInfoEl.setAttribute('aria-haspopup', 'menu');
    userInfoEl.setAttribute('aria-expanded', 'false');
    userInfoEl.title = 'Open account menu';

    const menu = document.createElement('div');
    menu.className = 'user-menu-dropdown';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
        <div class="user-menu-header">
            <div class="user-menu-email">${userEmailEl.textContent || ''}</div>
            <div class="user-menu-subtitle">Account Menu</div>
        </div>
        <button type="button" class="user-menu-item" data-action="account">Account Settings</button>
        <button type="button" class="user-menu-item" data-action="security">Security</button>
        <button type="button" class="user-menu-item" data-action="api">API Keys</button>
        <button type="button" class="user-menu-item danger" data-action="logout">Sign out</button>
    `;
    userInfoEl.appendChild(menu);

    const setOpen = (open) => {
        userInfoEl.classList.toggle('menu-open', open);
        userInfoEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    userInfoEl.addEventListener('click', (event) => {
        const item = event.target.closest('.user-menu-item');
        if (item) {
            const action = item.dataset.action;
            setOpen(false);
            if (action === 'account') openSettingsSection('account');
            if (action === 'security') openSettingsSection('security');
            if (action === 'api') openSettingsSection('api');
            if (action === 'logout') {
                localStorage.removeItem('token');
                localStorage.removeItem('userEmail');
                window.location.href = '/login.html';
            }
            return;
        }
        setOpen(!userInfoEl.classList.contains('menu-open'));
    });

    userInfoEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(!userInfoEl.classList.contains('menu-open'));
        }
        if (event.key === 'Escape') {
            setOpen(false);
        }
    });

    document.addEventListener('click', (event) => {
        if (!userInfoEl.contains(event.target)) {
            setOpen(false);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    populateUserInfo();
    normalizeSidebarIcons();
    setupGlobalModalControls();
    setupGlobalNavigationShortcuts();
});
