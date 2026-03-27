/**
 * OWASP BLT - Main Application Module
 */
// ===================================
// Configuration    
// Configuration    
// ===================================
const CONFIG = {
    // API endpoint - should be set to your Cloudflare Worker URL
    // For production, use absolute URL like: 'https://api.owaspblt.org'
    // For local development with worker: 'http://localhost:8787'
    API_BASE_URL: window.location.hostname === 'localhost'
        ? 'http://localhost:8787'
        : 'https://api.owaspblt.org', // TODO: Replace with your actual worker URL
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
    ENABLE_ANALYTICS: true,
};

const TOKEN_KEY = 'authToken';

function getAuthToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

function persistAuthToken(token, remember = true) {
    if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.removeItem(TOKEN_KEY);
    } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
    }
}

function clearAuthToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
}

// ===================================
// State Management
// ===================================
class AppState {
    constructor() {
        this.user = null;
        this.isAuthenticated = false;
        this.listeners = new Map();
    }

    subscribe(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(callback => callback(data));
    }

    setUser(user) {
        this.user = user;
        this.isAuthenticated = !!user;
        this.emit('user:changed', user);
    }

    getUser() {
        return this.user;
    }
}

const state = new AppState();

// ===================================
// API Client
// ===================================
class APIClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.cache = new Map();
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        // Add auth token if available
        const token = getAuthToken();
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, { ...defaultOptions, ...options });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    async get(endpoint, useCache = false) {
        if (useCache && this.cache.has(endpoint)) {
            const cached = this.cache.get(endpoint);
            if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
                return cached.data;
            }
        }

        const data = await this.request(endpoint, { method: 'GET' });

        if (useCache) {
            this.cache.set(endpoint, {
                data,
                timestamp: Date.now(),
            });
        }

        return data;
    }

    async post(endpoint, body) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    async put(endpoint, body) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE',
        });
    }

    clearCache() {
        this.cache.clear();
    }
}

const api = new APIClient(CONFIG.API_BASE_URL);

// ===================================
// Authentication Module
// ===================================
class AuthModule {
    constructor(apiClient, appState) {
        this.api = apiClient;
        this.state = appState;
    }

    async login(email, password, remember = false) {
        try {
            const response = await this.api.post('/api/auth/login', { email, password });

            if (response.token) {
                persistAuthToken(response.token, remember);
                this.state.setUser(response.user);
                return { success: true, user: response.user };
            }

            return { success: false, error: 'Invalid credentials' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signup(userData) {
        try {
            const response = await this.api.post('/api/auth/signup', userData);

            if (response.token) {
                persistAuthToken(response.token, true);
                this.state.setUser(response.user);
                return { success: true, user: response.user };
            }

            return { success: false, error: 'Signup failed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async logout() {
        try {
            await this.api.post('/api/auth/logout', {});
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            clearAuthToken();
            this.state.setUser(null);
            this.api.clearCache();
        }
    }

    async checkAuth() {
        const token = getAuthToken();
        if (!token) {
            this.state.setUser(null);
            return false;
        }

        try {
            const response = await this.api.get('/api/auth/me');
            if (response.user) {
                this.state.setUser(response.user);
                return true;
            }
        } catch (error) {
            // Token invalid, clear it
            clearAuthToken();
            this.state.setUser(null);
        }

        this.state.setUser(null);
        return false;
    }
}

const auth = new AuthModule(api, state);

// ===================================
// UI Components
// ===================================
class UIComponents {
    static showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            background-color: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            border-radius: 0.5rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            z-index: 9999;
            animation: slideIn 0.3s ease-out;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    static showModal(content) {
        UIComponents.hideModal();

        const overlay = document.createElement('div');
        overlay.id = 'blt-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(4px);
            z-index: 9998;
        `;

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                UIComponents.hideModal();
            }
        });

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                UIComponents.hideModal();
            }
        };

        UIComponents.modalKeydownHandler = onKeyDown;
        document.addEventListener('keydown', onKeyDown);
        document.body.style.overflow = 'hidden';

        if (content && content instanceof HTMLElement) {
            overlay.appendChild(content);
        }
        document.body.appendChild(overlay);
    }

    static hideModal() {
        const overlay = document.getElementById('blt-modal-overlay');
        if (overlay) {
            overlay.remove();
        }

        if (UIComponents.modalKeydownHandler) {
            document.removeEventListener('keydown', UIComponents.modalKeydownHandler);
            UIComponents.modalKeydownHandler = null;
        }

        document.body.style.overflow = '';
    }

    static createLoginForm() {
        const isDark = document.documentElement.classList.contains('dark');
        const container = UIComponents.createModalCard('Welcome Back', 'Sign in to your account');
        const form = document.createElement('form');
        form.id = 'modal-loginForm';
        form.style.cssText = 'display: flex; flex-direction: column; gap: 1rem;';

        form.appendChild(UIComponents.createInputGroup({
            label: 'Email',
            id: 'email',
            name: 'email',
            type: 'email',
            placeholder: 'you@example.com',
            required: true,
            isDark,
        }));

        form.appendChild(UIComponents.createInputGroup({
            label: 'Password',
            id: 'password',
            name: 'password',
            type: 'password',
            placeholder: '********',
            required: true,
            isDark,
        }));

        const optionsRow = document.createElement('div');
        optionsRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-size: 0.875rem;';

        const rememberLabel = document.createElement('label');
        rememberLabel.style.cssText = `display: flex; align-items: center; gap: 0.5rem; color: ${isDark ? '#9ca3af' : '#4b5563'};`;
        const remember = document.createElement('input');
        remember.type = 'checkbox';
        remember.name = 'remember';
        remember.id = 'rememberMe';
        remember.style.cssText = 'width: 1rem; height: 1rem;';
        rememberLabel.appendChild(remember);
        rememberLabel.appendChild(document.createTextNode('Remember me'));

        const forgotLink = document.createElement('a');
        forgotLink.href = getPageHref('forgot-password');
        forgotLink.textContent = 'Forgot password?';
        forgotLink.style.cssText = 'color: #dc2626; font-weight: 600; text-decoration: none;';

        optionsRow.appendChild(rememberLabel);
        optionsRow.appendChild(forgotLink);
        form.appendChild(optionsRow);

        const submit = UIComponents.createSubmitButton('Sign In');
        form.appendChild(submit);
        container.appendChild(form);

        return container;
    }

    static createSignupForm() {
        const isDark = document.documentElement.classList.contains('dark');
        const container = UIComponents.createModalCard('Create Your Account', 'Join the BLT community today.');
        const form = document.createElement('form');
        form.id = 'modal-signupForm';
        form.style.cssText = 'display: flex; flex-direction: column; gap: 1rem;';

        form.appendChild(UIComponents.createInputGroup({
            label: 'Username',
            id: 'username',
            name: 'username',
            type: 'text',
            placeholder: 'johndoe',
            required: true,
            minLength: 3,
            isDark,
        }));

        form.appendChild(UIComponents.createInputGroup({
            label: 'Email Address',
            id: 'email',
            name: 'email',
            type: 'email',
            placeholder: 'you@example.com',
            required: true,
            isDark,
        }));

        const passwordGroup = UIComponents.createInputGroup({
            label: 'Password',
            id: 'password',
            name: 'password',
            type: 'password',
            placeholder: '********',
            required: true,
            minLength: 8,
            isDark,
        });
        const passwordHint = document.createElement('p');
        passwordHint.textContent = 'Must be at least 8 characters';
        passwordHint.style.cssText = `margin: 0.375rem 0 0; font-size: 0.75rem; color: ${isDark ? '#9ca3af' : '#6b7280'};`;
        passwordGroup.appendChild(passwordHint);
        form.appendChild(passwordGroup);

        form.appendChild(UIComponents.createInputGroup({
            label: 'Confirm Password',
            id: 'confirmPassword',
            name: 'confirmPassword',
            type: 'password',
            placeholder: '********',
            required: true,
            minLength: 8,
            isDark,
        }));

        const termsLabel = document.createElement('label');
        termsLabel.style.cssText = `display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.75rem; line-height: 1.5; color: ${isDark ? '#9ca3af' : '#4b5563'};`;
        const terms = document.createElement('input');
        terms.type = 'checkbox';
        terms.id = 'terms';
        terms.required = true;
        terms.style.cssText = 'width: 1rem; height: 1rem; margin-top: 0.125rem;';
        const termsText = document.createElement('span');
        termsText.textContent = 'I agree to the Terms of Service and Privacy Policy';
        termsLabel.appendChild(terms);
        termsLabel.appendChild(termsText);
        form.appendChild(termsLabel);

        const submit = UIComponents.createSubmitButton('Create Account');
        form.appendChild(submit);
        container.appendChild(form);

        return container;
    }

    static createModalCard(title, subtitle) {
        const isDark = document.documentElement.classList.contains('dark');
        const card = document.createElement('div');
        card.style.cssText = `
            position: relative;
            width: min(100%, 28rem);
            max-height: calc(100vh - 2rem);
            overflow: auto;
            border-radius: 0.75rem;
            border: 1px solid ${isDark ? '#1f2937' : '#e5e7eb'};
            background: ${isDark ? '#111827' : '#ffffff'};
            color: ${isDark ? '#f9fafb' : '#111827'};
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
            padding: 1.5rem;
        `;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close dialog');
        closeButton.textContent = 'Close';
        closeButton.style.cssText = `
            position: absolute;
            top: 1rem;
            right: 1rem;
            border: 0;
            background: transparent;
            color: ${isDark ? '#9ca3af' : '#6b7280'};
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 600;
        `;
        closeButton.onclick = () => UIComponents.hideModal();

        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom: 1.5rem; padding-right: 4rem;';

        const heading = document.createElement('h2');
        heading.textContent = title;
        heading.style.cssText = 'margin: 0 0 0.5rem; font-size: 1.75rem; font-weight: 700;';

        const description = document.createElement('p');
        description.textContent = subtitle;
        description.style.cssText = `margin: 0; color: ${isDark ? '#9ca3af' : '#6b7280'};`;

        header.appendChild(heading);
        header.appendChild(description);

        card.appendChild(closeButton);
        card.appendChild(header);

        return card;
    }

    static createInputGroup({ label, id, name, type, placeholder, required, minLength, isDark }) {
        const group = document.createElement('div');

        const labelElement = document.createElement('label');
        labelElement.htmlFor = id;
        labelElement.textContent = label;
        labelElement.style.cssText = `display: block; margin-bottom: 0.375rem; font-size: 0.875rem; font-weight: 600; color: ${isDark ? '#d1d5db' : '#374151'};`;

        const input = document.createElement('input');
        input.id = id;
        input.name = name;
        input.type = type;
        input.placeholder = placeholder;
        input.required = Boolean(required);
        if (minLength) {
            input.minLength = minLength;
        }
        input.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            padding: 0.75rem 0.875rem;
            border-radius: 0.375rem;
            border: 1px solid ${isDark ? '#374151' : '#d1d5db'};
            background: ${isDark ? '#1f2937' : '#ffffff'};
            color: ${isDark ? '#f9fafb' : '#111827'};
            font-size: 0.875rem;
        `;

        group.appendChild(labelElement);
        group.appendChild(input);

        return group;
    }

    static createSubmitButton(text) {
        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = text;
        button.style.cssText = `
            width: 100%;
            border: 0;
            border-radius: 0.375rem;
            background: #dc2626;
            color: #ffffff;
            padding: 0.75rem 1rem;
            font-size: 0.875rem;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        `;

        return button;
    }
}

function isButtonElement(element) {
    return element && element.tagName.toLowerCase() === 'button';
}

function isLinkElement(element) {
    return element && element.tagName.toLowerCase() === 'a';
}

function getPageHref(pageName) {
    const isPagesRoute = window.location.pathname.includes('/pages/');
    return isPagesRoute ? `${pageName}.html` : `pages/${pageName}.html`;
}

function navigateTo(href) {
    window.location.href = href;
}

function bindFormSubmit(form, handler) {
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        await handler(new FormData(form));
    };
}

function openLoginModal() {
    if (window.uiComponents && UIComponents.showModal && UIComponents.createLoginForm) {
        UIComponents.showModal(UIComponents.createLoginForm());

        const form = document.getElementById('modal-loginForm');
        bindFormSubmit(form, async (formData) => {
            const email = formData.get('email');
            const password = formData.get('password');
            const remember = formData.has('remember');

            const result = await auth.login(email, password, remember);
            if (result.success) {
                 if (window.uiComponents && UIComponents.hideModal) {
        UIComponents.hideModal();
    }

    UIComponents.showNotification('Logged in successfully!', 'success');
    updateUIForAuth();
    
            } else {
                UIComponents.showNotification(result.error, 'error');
            }
        });

    } else {
        // ✅ REQUIRED fallback
        window.location.href = getPageHref('login');
    }
}

function openSignupModal() {
    if (window.uiComponents && UIComponents.showModal && UIComponents.createSignupForm) {
        UIComponents.showModal(UIComponents.createSignupForm());

        const form = document.getElementById('modal-signupForm');
        bindFormSubmit(form, async (formData) => {
            const userData = {
                username: formData.get('username'),
                email: formData.get('email'),
                password: formData.get('password'),
            };
            const confirmPassword = formData.get('confirmPassword');

            if (userData.password !== confirmPassword) {
                UIComponents.showNotification('Passwords do not match', 'error');
                return;
            }

            const result = await auth.signup(userData);
            if (result.success) {
               if (window.uiComponents && UIComponents.hideModal) {
                UIComponents.hideModal();
    }

            UIComponents.showNotification('Account created successfully!', 'success');
            updateUIForAuth();
            } else {
                UIComponents.showNotification(result.error, 'error');
            }
        });

    } else {
        // ✅ REQUIRED fallback
        window.location.href = getPageHref('signup');
    }
}

async function handleLogout(event) {
    if (event) {
        event.preventDefault();
    }

    await auth.logout();
    UIComponents.showNotification('Logged out successfully', 'success');
    updateUIForAuth();
}

function setAuthControlState(element, { text, href, onClick }) {
    if (!element) return;

    element.textContent = text;
    element.onclick = null;

    if (isLinkElement(element)) {
        if (href) {
            element.href = href;
        } else {
            element.removeAttribute('href');
        }
    } else {
        element.removeAttribute('href');
        element.type = 'button';
    }

    if (typeof onClick === 'function') {
        element.onclick = onClick;
    }
}

// ===================================
// Event Handlers
// ===================================
function setupEventHandlers() {
    // Theme Toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');

            // Re-emit theme change for other components
            if (window.bltApp && window.bltApp.state) {
                window.bltApp.state.emit('theme:changed', isDark ? 'dark' : 'light');
            }
        });
    }

    // Login page handlers (bound in external JS to avoid inline event attributes)
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        const loginEmail = loginForm.querySelector('#email');
        const loginPassword = loginForm.querySelector('#password');
        const loginPasswordToggle = loginForm.querySelector('#loginPasswordToggle');

        if (loginEmail) {
            loginEmail.addEventListener('input', () => {
                if (typeof window.validateLoginEmail === 'function') {
                    window.validateLoginEmail(loginEmail);
                }
            });
            loginEmail.addEventListener('blur', () => {
                if (typeof window.validateLoginEmail === 'function') {
                    window.validateLoginEmail(loginEmail);
                }
            });
        }

        if (loginPassword) {
            loginPassword.addEventListener('input', () => {
                if (typeof window.validateLoginPassword === 'function') {
                    window.validateLoginPassword(loginPassword);
                }
            });
            loginPassword.addEventListener('blur', () => {
                if (typeof window.validateLoginPassword === 'function') {
                    window.validateLoginPassword(loginPassword);
                }
            });
        }

        if (loginPasswordToggle) {
            loginPasswordToggle.addEventListener('click', () => {
                if (typeof window.togglePassword === 'function') {
                    window.togglePassword('password', loginPasswordToggle);
                }
            });
        }

        // Handle submit for standalone login page
        bindFormSubmit(loginForm, async (formData) => {
            const email = formData.get('email');
            const password = formData.get('password');
            const remember = formData.has('remember');

            const result = await auth.login(email, password, remember);
            if (result.success) {
                UIComponents.showNotification('Logged in successfully!', 'success');
                updateUIForAuth();
                // Keep user on the site; redirect to home if on the standalone login page
                if (window.location.pathname.includes('/pages/')) {
                    window.location.href = '../index.html';
                }
            } else {
                UIComponents.showNotification(result.error, 'error');
            }
        });
    }

    // Signup page handlers (bound in external JS to avoid inline event attributes)
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        bindFormSubmit(signupForm, async (formData) => {
            const userData = {
                username: formData.get('username'),
                email: formData.get('email'),
                password: formData.get('password'),
            };
            const confirmPassword = formData.get('confirmPassword');

            if (userData.password !== confirmPassword) {
                UIComponents.showNotification('Passwords do not match', 'error');
                return;
            }

            const result = await auth.signup(userData);
            if (result.success) {
                UIComponents.showNotification('Account created successfully!', 'success');
                updateUIForAuth();
                if (window.location.pathname.includes('/pages/')) {
                    window.location.href = '../index.html';
                }
            } else {
                UIComponents.showNotification(result.error, 'error');
            }
        });
    }

    // Keep auth controls consistent for both links and buttons.
    updateUIForAuth();
}

// ===================================
// UI Updates
// ===================================
function updateUIForAuth() {
    const user = state.getUser();
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const loginHref = getPageHref('login');
    const signupHref = getPageHref('signup');
    const profileHref = getPageHref('profile');

    if (user && state.isAuthenticated) {
        setAuthControlState(loginBtn, {
            text: user.username,
            href: isLinkElement(loginBtn) ? profileHref : null,
            onClick: isButtonElement(loginBtn) ? () => navigateTo(profileHref) : null,
        });

        setAuthControlState(signupBtn, {
            text: 'Logout',
            href: isLinkElement(signupBtn) ? '#' : null,
            onClick: handleLogout,
        });
    } else {
        setAuthControlState(loginBtn, {
            text: 'Login',
            href: isLinkElement(loginBtn) ? loginHref : null,
            onClick: isButtonElement(loginBtn) ? openLoginModal : null,
        });

        setAuthControlState(signupBtn, {
            text: 'Sign Up',
            href: isLinkElement(signupBtn) ? signupHref : null,
            onClick: isButtonElement(signupBtn) ? openSignupModal : null,
        });
    }
}

// ===================================
// Footer Last Updated
// ===================================
function updateFooterLastUpdated() {
    const el = document.getElementById('footer-last-updated');
    //document.body.addEventListener("htmx:afterSwap", updateFooterLastUpdated);
    if (!el) return;

    const lastModified = new Date(document.lastModified);
    const now = new Date();
    const diffMins = Math.max(0, Math.floor((now - lastModified) / 60000));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    const dateStr = lastModified.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });

    let agoStr;
    if (hours > 0 && mins > 0) {
        agoStr = `${hours} hour${hours !== 1 ? 's' : ''} and ${mins} minute${mins !== 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        agoStr = `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (mins > 0) {
        agoStr = `${mins} minute${mins !== 1 ? 's' : ''} ago`;
    } else {
        agoStr = 'just now';
    }

    el.textContent = `Last updated: ${dateStr} (${agoStr})`;
}

document.body.addEventListener("htmx:afterSwap", function (event) {
    if (document.getElementById("footer-last-updated")) {
        updateFooterLastUpdated();
    }
});

// ===================================
// Initialization
// ===================================
async function init() {
    // Setup event handlers immediately so UI is responsive
    try {
        setupEventHandlers();
    } catch (error) {
        // Silently fail or log sparingly in production
    }

    // Check authentication status in background
    try {
        await auth.checkAuth();
        updateUIForAuth();
    } catch (error) {
        // Auth check failure is handled by UI state
    }

    // Update footer with last modified date
    updateFooterLastUpdated();

    // Update state to ready
    state.emit('app:ready');

    // Add CSS animations
    if (!document.getElementById('blt-animations')) {
        const style = document.createElement('style');
        style.id = 'blt-animations';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// ===================================
// Export to window for global access
// ===================================
window.bltApp = {
    state,
    api,
    auth,
};

window.uiComponents = UIComponents;

// ===================================
// Start the application
// ===================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ===================================
// Bug Report Form Validation
// ===================================
window.addEventListener('htmx:beforeRequest', (event) => {
    // Reference the element triggering the HTMX request
    const form = event.detail.elt;

    // Validate only if the request originates from the bug report form
    if (form && form.id === 'bugReportForm') {
        const description = document.getElementById('bugDescription');
        const errorBox = document.getElementById('custom-error-box');

        // Check for empty input or strings containing only whitespace
        if (description && description.value.trim().length === 0) {
            // Cancel the request to prevent unnecessary 405 errors
            event.preventDefault();

            if (errorBox) {
                // Display the custom Tailwind error alert
                errorBox.classList.remove('hidden');

                // Auto-hide the alert after 5 seconds for a cleaner UI
                setTimeout(() => {
                    errorBox.classList.add('hidden');
                }, 5000);
            }
        }
    }
});

const rowsPerPage = 5;
let currentPage = 1;
let totalResearchers = 3500;

function updateLeaderboardPagination() {
  const rows = document.querySelectorAll("#leaderboard-body .leaderboard-row");

  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;

  rows.forEach((row, index) => {
    if (index >= start && index < end) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });

  const info = document.getElementById("pagination-info");

  if (info) {
    const displayStart = start + 1;
    const displayEnd = Math.min(end, totalResearchers);
    info.textContent = `Showing ${displayStart}-${displayEnd} of ${totalResearchers} researchers`;
  }
}

function updateActiveButton() {
  const buttons = document.querySelectorAll(".page-btn");

  buttons.forEach((btn) => {
    btn.classList.remove("bg-red-600", "text-white");
    btn.removeAttribute("aria-current");

    const page = parseInt(btn.textContent.trim());

    if (page === currentPage) {
      btn.classList.add("bg-red-600", "text-white");
      btn.setAttribute("aria-current", "page");
    }
  });
  const maxVisiblePage = buttons.length;

if (currentPage > maxVisiblePage) {
  currentPage = maxVisiblePage;
}
}

document.addEventListener("htmx:afterSwap", () => {
  updateLeaderboardPagination();
  updateActiveButton();
});

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page);
      if (!isNaN(page)) {
        currentPage = page;
        updateLeaderboardPagination();
        updateActiveButton();
      }
    });
  });
});

document.getElementById("next-page")?.addEventListener("click", () => {
  const maxPage = document.querySelectorAll(".page-btn").length;
  if (currentPage < maxPage) {
    currentPage++;
    updateLeaderboardPagination();
    updateActiveButton();
  }
});

document.getElementById("prev-page")?.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    updateLeaderboardPagination();
    updateActiveButton();
  }
});
