// ==================== API FOUNDATION ====================

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

const ROOT_URL = typeof CONFIG_ROOT_URL !== 'undefined'
    ? CONFIG_ROOT_URL
    : StockPadConfig.ROOT_URL;

const API_BASE_URL = typeof CONFIG_API_BASE_URL !== 'undefined'
    ? CONFIG_API_BASE_URL
    : StockPadConfig.API_BASE_URL;

const AUTH_BASE_URL = typeof CONFIG_AUTH_BASE_URL !== 'undefined'
    ? CONFIG_AUTH_BASE_URL
    : StockPadConfig.AUTH_BASE_URL;

const TOKEN_STORAGE_KEY = 'access_token';
const REFRESH_STORAGE_KEY = 'refresh_token';
const USER_STORAGE_KEY = 'currentUser';
const REMEMBER_ME_KEY = 'rememberMe';

function resolveMediaUrl(path) {
    if (!path) return '';
    const raw = String(path).trim();
    if (!raw || raw.startsWith('data:') || /^https?:\/\//i.test(raw)) return raw;
    const root = StockPadConfig.stripTrailingSlashes(ROOT_URL);
    return raw.startsWith('/') ? `${root}${raw}` : `${root}/${raw}`;
}

// ==================== ERRORS ====================

class SessionExpiredError extends Error {
    constructor(message = 'Session expired. Please login again.') {
        super(message);
        this.name = 'SessionExpiredError';
        this.code = 'SESSION_EXPIRED';
        this.silent = true;
    }
}

// ==================== HTTP CLIENT (INTERCEPTOR PIPELINE) ====================

class HttpClient {
    constructor(baseURL) {
        this.baseURL = StockPadConfig.stripTrailingSlashes(baseURL);
        this._requestInterceptors = [];
        this._responseInterceptors = [];
    }

    useRequest(interceptor) {
        this._requestInterceptors.push(interceptor);
        return this;
    }

    useResponse(interceptor) {
        this._responseInterceptors.push(interceptor);
        return this;
    }

    resolveUrl(endpoint, options = {}) {
        if (/^https?:\/\//i.test(endpoint)) {
            return options.trailingSlash === false
                ? StockPadConfig.stripTrailingSlashes(endpoint)
                : StockPadConfig.withTrailingSlash(endpoint);
        }

        const cleanEndpoint = String(endpoint || '').trim();
        if (!cleanEndpoint) return this.baseURL;

        const [pathPart, queryPart] = cleanEndpoint.split('?');
        const normalizedPath = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
        let url = `${this.baseURL}${normalizedPath}`;

        if (options.trailingSlash !== false) {
            const queryIndex = url.indexOf('?');
            const base = queryIndex === -1 ? url : url.slice(0, queryIndex);
            url = StockPadConfig.withTrailingSlash(base) + (queryIndex === -1 ? '' : url.slice(queryIndex));
        }

        return queryPart ? `${url}?${queryPart}` : url;
    }

    buildHeaders(options = {}) {
        const headers = { ...(options.headers || {}) };
        const hasFormData = options.body instanceof FormData;

        if (!hasFormData && !headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
        }

        if (hasFormData) {
            delete headers['Content-Type'];
            delete headers['content-type'];
        }

        const csrfToken = getCookie('csrftoken');
        if (csrfToken) {
            headers['X-CSRFToken'] = csrfToken;
        }

        return headers;
    }

    async request(endpoint, options = {}) {
        const {
            skipAuth = false,
            raw = false,
            trailingSlash = true,
            _retry = false,
            ...fetchOptions
        } = options;

        let url = this.resolveUrl(endpoint, { trailingSlash });
        let config = {
            method: 'GET',
            credentials: 'omit',
            ...fetchOptions,
            headers: this.buildHeaders(fetchOptions),
        };

        const requestContext = {
            url,
            config,
            endpoint,
            skipAuth,
            raw,
            trailingSlash,
            isRetry: _retry,
            client: this,
        };

        for (const interceptor of this._requestInterceptors) {
            await interceptor(requestContext);
            url = requestContext.url;
            config = requestContext.config;
        }

        let response = await fetch(url, config);

        const responseContext = {
            ...requestContext,
            response,
            async retry() {
                return this.client.request(endpoint, {
                    ...options,
                    _retry: true,
                });
            },
        };

        for (const interceptor of this._responseInterceptors) {
            const result = await interceptor(responseContext);
            if (result && Object.prototype.hasOwnProperty.call(result, 'response')) {
                response = result.response;
                responseContext.response = response;
            }
        }

        if (raw) return response;
        if (response.status === 204) return null;

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const detail = errorData.detail
                || errorData.message
                || (typeof errorData === 'object' ? Object.entries(errorData).map(([field, errors]) => {
                    const errList = Array.isArray(errors) ? errors : [errors];
                    return `${field}: ${errList.join(', ')}`;
                }).join(' | ') : null)
                || `HTTP error! status: ${response.status}`;

            if (response.status === 401 && !skipAuth) {
                throw new SessionExpiredError(
                    typeof detail === 'string' ? detail : 'Session expired. Please login again.'
                );
            }

            throw new Error(detail);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return response.json();
        }

        return response.text();
    }
}

const http = new HttpClient(API_BASE_URL);

// ==================== AUTHENTICATION SERVICE ====================

class AuthService {
    static async login(username, password, rememberMe = false) {
        const response = await fetch(StockPadConfig.resolveApiUrl('/token/'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Login failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.access || !data.refresh) {
            throw new Error('No token received');
        }

        this._persistTokens(data.access, data.refresh);
        this.setRememberMe(rememberMe);

        try {
            const userData = await http.request('/auth/me/', { skipAuth: false });
            const user = this._mapUser(userData);
            this.setCurrentUser(user, rememberMe);
            return { user, token: data.access };
        } catch {
            const user = this.getUserFromToken(data.access);
            this.setCurrentUser(user, rememberMe);
            return { user, token: data.access };
        }
    }

    static async register(userData) {
        const data = await http.request('/auth/register/', {
            method: 'POST',
            skipAuth: true,
            body: JSON.stringify(userData),
        });
        return data;
    }

    static async refreshAccessToken() {
        const refreshToken = localStorage.getItem(REFRESH_STORAGE_KEY);
        if (!refreshToken) return false;

        try {
            const response = await fetch(StockPadConfig.resolveApiUrl('/token/refresh/'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh: refreshToken }),
            });

            if (!response.ok) return false;

            const data = await response.json();
            if (!data.access) return false;

            localStorage.setItem(TOKEN_STORAGE_KEY, data.access);
            return true;
        } catch {
            return false;
        }
    }

    static async fetchProfile() {
        return http.request('/auth/profile/');
    }

    static async uploadProfilePicture(file) {
        const formData = new FormData();
        formData.append('profile_picture', file);

        return http.request('/auth/profile-picture/', {
            method: 'POST',
            body: formData,
        });
    }

    static async updateProfile(profileData) {
        return http.request('/auth/profile/', {
            method: 'PATCH',
            body: JSON.stringify(profileData),
        });
    }

    static async changePassword(oldPassword, newPassword) {
        return http.request('/auth/change-password/', {
            method: 'POST',
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword,
            }),
        });
    }

    static async forgotPassword(email) {
        const response = await fetch(StockPadConfig.resolveAuthUrl('forgot-password/'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.detail || 'Failed to send reset email.');
        }
        return data;
    }

    static async googleLogin(credential, isAccessToken = false) {
        const response = await fetch(StockPadConfig.resolveAuthUrl('google/'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential, isAccessToken }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.detail || 'Google login failed.');
        }
        if (!data.access || !data.refresh) {
            throw new Error('No token received from Google login.');
        }
        this._persistTokens(data.access, data.refresh);
        const user = data.user
            ? this._mapUser({
                ...data.user,
                first_name: data.user.first_name ?? data.user.firstName,
                last_name: data.user.last_name ?? data.user.lastName,
            })
            : this.getUserFromToken(data.access);
        this.setCurrentUser(user, Boolean(data.remember_me));
        return { user, token: data.access, refresh: data.refresh };
    }

    static logout() {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(REFRESH_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
    }

    static getToken() {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
    }

    static isAuthenticated() {
        return !!this.getToken() && !this.isTokenExpired();
    }

    static setRememberMe(enabled) {
        localStorage.setItem(REMEMBER_ME_KEY, enabled ? '1' : '0');
    }

    static isRememberMe() {
        return localStorage.getItem(REMEMBER_ME_KEY) === '1';
    }

    static setCurrentUser(user, rememberMe = this.isRememberMe()) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
        this.setRememberMe(rememberMe);
        if (rememberMe && user?.username) {
            localStorage.setItem('rememberedUsername', user.username);
        } else {
            localStorage.removeItem('rememberedUsername');
        }
    }

    static getUserFromToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return {
                id: payload.user_id,
                username: payload.username || payload.name || 'User',
            };
        } catch {
            return { id: null, username: 'User' };
        }
    }

    static isTokenExpired() {
        const token = this.getToken();
        if (!token) return true;

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (!payload.exp) return true;
            return payload.exp * 1000 < Date.now();
        } catch {
            return true;
        }
    }

    static getCurrentUser() {
        const stored = localStorage.getItem(USER_STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    }

    static _persistTokens(access, refresh) {
        localStorage.setItem(TOKEN_STORAGE_KEY, access);
        localStorage.setItem(REFRESH_STORAGE_KEY, refresh);
    }

    static _mapUser(userData) {
        return {
            id: userData.id,
            username: userData.username,
            email: userData.email,
            firstName: userData.first_name,
            lastName: userData.last_name,
            role: userData.role,
            profilePictureUrl: userData.profile_picture_url || null,
        };
    }
}

http
    .useRequest(async (ctx) => {
        if (ctx.skipAuth) return;

        if (AuthService.isTokenExpired()) {
            const refreshed = await AuthService.refreshAccessToken();
            if (!refreshed) {
                AuthService.logout();
                throw new SessionExpiredError();
            }
        }

        const token = AuthService.getToken();
        if (token) {
            ctx.config.headers = {
                ...ctx.config.headers,
                Authorization: `Bearer ${token}`,
            };
        }
    })
    .useResponse(async (ctx) => {
        if (ctx.skipAuth || ctx.isRetry || ctx.response.status !== 401) return;

        const refreshed = await AuthService.refreshAccessToken();
        if (!refreshed) {
            AuthService.logout();
            throw new SessionExpiredError();
        }

        ctx.config.headers = {
            ...ctx.config.headers,
            Authorization: `Bearer ${AuthService.getToken()}`,
        };

        return {
            response: await fetch(ctx.url, ctx.config),
        };
    });

// ==================== API SERVICE ====================

class ApiService {
    static isSessionExpiredError(error) {
        return error instanceof SessionExpiredError
            || error?.name === 'SessionExpiredError'
            || error?.code === 'SESSION_EXPIRED'
            || error?.silent === true;
    }

    static request(endpoint, options = {}) {
        return http.request(endpoint, options);
    }

    static getMaterials() {
        return this.request('/inventory/materials/');
    }

    static getMaterial(id) {
        return this.request(`/inventory/materials/${id}/`);
    }

    static createMaterial(materialData) {
        return this.request('/inventory/materials/', {
            method: 'POST',
            body: JSON.stringify(materialData),
        });
    }

    static updateMaterial(id, materialData) {
        return this.request(`/inventory/materials/${id}/`, {
            method: 'PUT',
            body: JSON.stringify(materialData),
        });
    }

    static patchMaterial(id, partialData) {
        const isFormData = partialData instanceof FormData;
        return this.request(`/inventory/materials/${id}/`, {
            method: 'PATCH',
            body: isFormData ? partialData : JSON.stringify(partialData),
        });
    }

    static deleteMaterial(id) {
        return this.request(`/inventory/materials/${id}/`, {
            method: 'DELETE',
        });
    }

    static uploadMaterialImage(id, file) {
        const formData = new FormData();
        formData.append('image', file);
        return this.request(`/inventory/materials/${id}/`, {
            method: 'PATCH',
            body: formData,
        });
    }

    static async quickCreateMaterial(materialData) {
        const isFormData = materialData instanceof FormData;
        if (isFormData) {
            try {
                return await this.request('/inventory/materials/quick-create/', {
                    method: 'POST',
                    body: materialData,
                });
            } catch (err) {
                return await this.request('/inventory/materials/', {
                    method: 'POST',
                    body: materialData,
                });
            }
        }
        const payload = {
            ...materialData,
            name: materialData.name,
            unit: materialData.unit || materialData.unit_of_measure || 'kg',
            unit_of_measure: materialData.unit_of_measure || materialData.unit || 'kg',
            initial_quantity: materialData.initial_quantity ?? 0,
        };
        try {
            return await this.request('/inventory/materials/quick-create/', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        } catch (err) {
            return await this.request('/inventory/materials/', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        }
    }

    static getProducts() {
        return this.request('/inventory/products/');
    }

    static getProduct(id) {
        return this.request(`/inventory/products/${id}/`);
    }

    static createProduct(productData) {
        const isFormData = productData instanceof FormData;
        return this.request('/inventory/products/', {
            method: 'POST',
            body: isFormData ? productData : JSON.stringify(productData),
        });
    }

    static updateProduct(id, productData) {
        const isFormData = productData instanceof FormData;
        return this.request(`/inventory/products/${id}/`, {
            method: 'PUT',
            body: isFormData ? productData : JSON.stringify(productData),
        });
    }

    static patchProduct(id, productData) {
        const isFormData = productData instanceof FormData;
        return this.request(`/inventory/products/${id}/`, {
            method: 'PATCH',
            body: isFormData ? productData : JSON.stringify(productData),
        });
    }

    static updateProductBom(id, bomLinesData) {
        return this.request(`/inventory/products/${id}/bom/`, {
            method: 'PUT',
            body: JSON.stringify(bomLinesData),
        });
    }

    static getTransactions() {
        return this.request('/inventory/transactions/');
    }

    static createTransaction(transactionData) {
        return this.request('/inventory/transactions/', {
            method: 'POST',
            body: JSON.stringify(transactionData),
        });
    }

    static getDashboardSummary() {
        return this.request('/inventory/dashboard/');
    }

    static getMaterialRequests(status = null, page = 1) {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (page > 1) params.set('page', String(page));
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/inventory/requests/list/${query}`);
    }

    static reviewMaterialRequest(id, status, reviewNotes = '') {
        return this.request(`/inventory/requests/${id}/review/`, {
            method: 'PATCH',
            body: JSON.stringify({
                status,
                review_notes: reviewNotes,
            }),
        });
    }

    static getAIInsights() {
        return this.request('/inventory/insights/');
    }

    static getImpliedDemandInsights(limit = 10, period = '30days') {
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        if (period) params.set('period', String(period));
        return this.request(`/inventory/products/insights/implied-demand/?${params.toString()}`);
    }

    static getPreferences() {
        return this.request('/settings/preferences/');
    }

    static updatePreferences(preferenceData) {
        return this.request('/settings/preferences/', {
            method: 'PUT',
            body: JSON.stringify(preferenceData),
        });
    }

    static getNotifications() {
        return this.request('/notifications/');
    }

    /**
     * Persist a notification via the backend.
     * The backend applies 24-hour deduplication using group_key.
     * @param {string} title
     * @param {string} message
     * @param {'alert'|'reminder'|'request'} category
     * @param {string|null} groupKey  - stable slug, e.g. 'low-stock-cement-42'
     */
    static createNotification(title, message, category, groupKey = null) {
        return this.request('/notifications/create/', {
            method: 'POST',
            body: JSON.stringify({
                title,
                message,
                category,
                group_key: groupKey,
            }),
        });
    }

    static getNotificationSummary() {
        return this.request('/notifications/summary/');
    }

    /** PATCH /notifications/<uuid>/read/ — mark a single notification read */
    static markNotificationRead(id) {
        return this.request(`/notifications/${id}/read/`, {
            method: 'PATCH',
        });
    }

    /** PATCH /notifications/read-all/ — bulk-mark all unread as read */
    static markAllNotificationsRead() {
        return this.request('/notifications/read-all/', {
            method: 'PATCH',
        });
    }

    /** DELETE /notifications/<uuid>/ — permanently remove one notification */
    static deleteNotification(id) {
        return this.request(`/notifications/${id}/`, {
            method: 'DELETE',
        });
    }

    static getConnectedEngineers() {
        return this.request('/inventory/connections/');
    }

    static addConnectedEngineer(email) {
        return this.request('/inventory/connections/', {
            method: 'POST',
            body: JSON.stringify({ engineer_email: email }),
        });
    }

    static deleteConnectedEngineer(id) {
        return this.request(`/inventory/connections/${id}/`, {
            method: 'DELETE',
        });
    }

    /**
     * GET /api/reports/procurement-planning/
     * Returns pre-computed server-side analytics: KPIs, material rows,
     * allocated stock, burn rate, days left, BOM yield breakdown.
     */
    static getProcurementPlanningReport() {
        return this.request('/reports/procurement-planning/');
    }
}

// ==================== DATA MANAGER ====================

class DataManager {
    constructor() {
        this.materials = [];
        this.transactions = [];
        this.materialRequests = [];
        // 30-second TTL cache for per-status request counts
        this._countsCache  = null;     // { counts, expiresAt } — null means stale
        this._COUNTS_TTL_MS = 30_000;
    }

    async initialize() {
        await Promise.all([
            this.loadMaterials(),
            this.loadTransactions(),
        ]);
        return true;
    }

    async loadMaterials() {
        const data = await ApiService.getMaterials();
        const items = Array.isArray(data) ? data : (data.results || []);
        this.materials = items.map((item) => this._toFrontendMaterial(item));
        return this.materials;
    }

    async addMaterial(materialData, imageFile = null) {
        const backendData = {
            name: materialData.name,
            unit: materialData.unit,
            initial_quantity: materialData.qty,
            max_quantity: materialData.maxQty,
            low_stock_threshold_percent: materialData.lowStockThreshold != null
                ? Math.round(materialData.lowStockThreshold)
                : null,
            cost_price: materialData.costPrice ?? 0,
            currency: materialData.currency || 'EGP',
            costing_method: materialData.costingMethod || 'MOVING_AVG',
        };
        const created = await ApiService.createMaterial(backendData);
        let payload = created;
        if (imageFile) {
            payload = await ApiService.uploadMaterialImage(created.id, imageFile);
        }
        const material = this._toFrontendMaterial(payload);
        this.materials.push(material);
        return material;
    }

    addMaterialLocal(item) {
        if (!item) return null;
        const material = (item.qty !== undefined && item.unit !== undefined && item.name !== undefined)
            ? item
            : this._toFrontendMaterial(item);
        const existingIdx = this.materials.findIndex((m) => String(m.id) === String(material.id));
        if (existingIdx >= 0) {
            this.materials[existingIdx] = material;
        } else {
            this.materials.push(material);
        }
        return material;
    }

    async updateMaterial(id, materialData) {
        const backendData = {
            name: materialData.name,
            unit: materialData.unit,
            max_quantity: materialData.maxQty,
            low_stock_threshold_percent: materialData.lowStockThreshold != null
                ? Math.round(materialData.lowStockThreshold)
                : null,
        };
        const updated = await ApiService.updateMaterial(id, backendData);
        const material = this._toFrontendMaterial(updated);
        const index = this.materials.findIndex((m) => m.id === id);
        if (index !== -1) this.materials[index] = material;
        return material;
    }

    async deleteMaterial(id) {
        await ApiService.deleteMaterial(id);
        this.materials = this.materials.filter((m) => m.id !== id);
    }

    async loadTransactions() {
        const data = await ApiService.getTransactions();
        const items = Array.isArray(data) ? data : (data.results || []);
        this.transactions = items.map((item) => this._toFrontendTransaction(item));
        return this.transactions;
    }

    async addTransaction(transactionData) {
        const backendData = {
            material: transactionData.materialId,
            type: transactionData.type,
            quantity: transactionData.qty,
            notes: transactionData.notes,
        };
        const created = await ApiService.createTransaction(backendData);
        const transaction = this._toFrontendTransaction(created);
        this.transactions.push(transaction);
        await this.loadMaterials();
        return transaction;
    }

    async loadMaterialRequests(status = null, page = 1) {
        const data = await ApiService.getMaterialRequests(status, page);
        // Handle both legacy plain array and new paginated {count, next, previous, results}
        const items = Array.isArray(data) ? data : (data.results || []);
        this.materialRequests = items.map((item) => this._toFrontendRequest(item));
        this.requestsPagination = {
            count: Array.isArray(data) ? items.length : (data.count || items.length),
            next: Array.isArray(data) ? null : (data.next || null),
            previous: Array.isArray(data) ? null : (data.previous || null),
            currentPage: page,
        };
        return this.materialRequests;
    }

    /**
     * Fetch accurate per-status counts using the `count` field from paginated responses.
     * Makes 3 parallel requests (pending, approved, denied) — each returns the total
     * for that status across ALL pages, not just the current page.
     *
     * Results are cached for 30 seconds to avoid redundant network calls on rapid
     * filter-tab clicks. The cache is explicitly invalidated after any approve/deny
     * action so counters update immediately when something actually changes.
     *
     * @param {boolean} forceRefresh - bypass the cache unconditionally
     */
    async getRequestStatusCounts(forceRefresh = false) {
        const now = Date.now();
        if (
            !forceRefresh &&
            this._countsCache &&
            now < this._countsCache.expiresAt
        ) {
            return this._countsCache.counts; // serve from cache
        }

        const [pending, approved, denied] = await Promise.all([
            ApiService.getMaterialRequests('pending'),
            ApiService.getMaterialRequests('approved'),
            ApiService.getMaterialRequests('denied'),
        ]);
        const extract = (d) => Array.isArray(d) ? d.length : (d.count || 0);
        const p = extract(pending);
        const a = extract(approved);
        const d = extract(denied);
        const counts = { pending: p, approved: a, denied: d, total: p + a + d };

        this._countsCache = { counts, expiresAt: now + this._COUNTS_TTL_MS };
        return counts;
    }

    /** Wipe the counts cache. Call immediately after any action that changes a request's status. */
    invalidateCountsCache() {
        this._countsCache = null;
    }

    async approveMaterialRequest(id, reviewNotes = '') {
        const updated = await ApiService.reviewMaterialRequest(id, 'approved', reviewNotes);
        const request = this._toFrontendRequest(updated);
        const index = this.materialRequests.findIndex((r) => r.id === id);
        if (index !== -1) this.materialRequests[index] = request;
        return request;
    }

    async denyMaterialRequest(id, reviewNotes = '') {
        const updated = await ApiService.reviewMaterialRequest(id, 'denied', reviewNotes);
        const request = this._toFrontendRequest(updated);
        const index = this.materialRequests.findIndex((r) => r.id === id);
        if (index !== -1) this.materialRequests[index] = request;
        return request;
    }

    async login(username, password, rememberMe = false) {
        return AuthService.login(username, password, rememberMe);
    }

    logout() {
        AuthService.logout();
    }

    getMaterials() {
        return this.materials;
    }

    getTransactions() {
        return this.transactions;
    }

    getMaterialRequests() {
        return this.materialRequests;
    }

    getCurrentUser() {
        return AuthService.getCurrentUser();
    }

    _toFrontendMaterial(m) {
        const imagePath = m.image || m.image_url || m.imageUrl || null;
        return {
            id: m.id,
            name: m.name,
            category: m.category || '',
            resolved_category: m.resolved_category || m.category_name || null,
            qty: parseFloat(m.current_quantity) || 0,
            maxQty: parseFloat(m.max_quantity) || 100,
            unit: m.unit || m.unit_of_measure || 'kg',
            lowStockThreshold: m.low_stock_threshold_percent,
            costPrice: parseFloat(m.cost_price) || 0,
            currency: m.currency || 'EGP',
            costingMethod: m.costing_method || 'MOVING_AVG',
            imageUrl: resolveMediaUrl(imagePath),
            image_url: resolveMediaUrl(imagePath),
            lastUpdated: m.updated_at ? m.updated_at.split('T')[0] : null,
        };
    }

    _toFrontendTransaction(t) {
        return {
            id: t.id,
            date: t.created_at ? t.created_at.split('T')[0] : null,
            materialId: t.material,
            type: t.type,
            qty: t.quantity,
            notes: t.notes,
        };
    }

    _toFrontendRequest(r) {
        return {
            id: r.id,
            materialId: r.material,
            materialName: r.material_name,
            materialUnit: r.material_unit,
            requesterEmail: r.requester_email,
            quantity: parseFloat(r.quantity),
            reason: r.reason,
            status: r.status,
            reviewedBy: r.reviewed_by,
            reviewNotes: r.review_notes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}

const dataManager = new DataManager();
