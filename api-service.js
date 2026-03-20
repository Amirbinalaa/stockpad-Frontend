// ==================== API CONFIGURATION ====================
const API_BASE_URL = 'http://127.0.0.1:8000/api';
const AUTH_BASE_URL = 'http://127.0.0.1:8000/api/auth';

// ==================== AUTHENTICATION SERVICE ====================
class AuthService {

    static async login(username, password) {
        const response = await fetch(`http://127.0.0.1:8000/api/token/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            throw new Error(`Login failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.access && data.refresh) {
            localStorage.setItem('access_token', data.access);
            localStorage.setItem('refresh_token', data.refresh);

            // Fetch real user data
            try {
                const meResponse = await fetch('http://127.0.0.1:8000/api/auth/me/', {
                    headers: { 'Authorization': `Bearer ${data.access}` }
                });
                const userData = await meResponse.json();
                const user = {
                    id: userData.id,
                    username: userData.username,
                    email: userData.email,
                    firstName: userData.first_name,
                    lastName: userData.last_name,
                    role: userData.role
                };
                localStorage.setItem('currentUser', JSON.stringify(user));
                return { user, token: data.access };
            } catch {
                const user = this.getUserFromToken(data.access);
                localStorage.setItem('currentUser', JSON.stringify(user));
                return { user, token: data.access };
            }
        }

        throw new Error('No token received');
    }

    static async register(userData) {
        const response = await fetch('http://127.0.0.1:8000/api/auth/register/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (!response.ok) {
            // Extract Django validation errors
            const messages = [];
            for (const [field, errors] of Object.entries(data)) {
                const errList = Array.isArray(errors) ? errors : [errors];
                messages.push(`${field}: ${errList.join(', ')}`);
            }
            throw new Error(messages.join(' | ') || 'Registration failed.');
        }

        return data;
    }

    static async refreshAccessToken() {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return false;

        try {
            const response = await fetch(`http://127.0.0.1:8000/api/token/refresh/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh: refreshToken })
            });

            if (!response.ok) return false;

            const data = await response.json();
            if (data.access) {
                localStorage.setItem('access_token', data.access);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    static logout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('currentUser');
    }

    static getToken() {
        return localStorage.getItem('access_token');
    }

    static isAuthenticated() {
        return !!this.getToken() && !this.isTokenExpired();
    }

    // Decode JWT to get real user info (id, username)
    static getUserFromToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return {
                id: payload.user_id,
                username: payload.username || payload.name || 'User'
            };
        } catch {
            return { id: null, username: 'User' };
        }
    }

    // Check if access token is expired before making requests
    static isTokenExpired() {
        const token = this.getToken();
        if (!token) return true;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.exp * 1000 < Date.now();
        } catch {
            return true;
        }
    }

    static getCurrentUser() {
        const stored = localStorage.getItem('currentUser');
        return stored ? JSON.parse(stored) : null;
    }
}

// ==================== API SERVICE ====================
class ApiService {

    static async request(endpoint, options = {}) {
        // If token is expired, try to refresh before the request
        if (AuthService.isTokenExpired()) {
            const refreshed = await AuthService.refreshAccessToken();
            if (!refreshed) {
                AuthService.logout();
                throw new Error('Session expired. Please login again.');
            }
        }

        const token = AuthService.getToken();
        const url = `${API_BASE_URL}${endpoint}`;

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(token && { 'Authorization': `Bearer ${token}` }),
                ...options.headers
            },
            ...options
        };

        // Remove headers from options to avoid duplication
        delete config.headers['Content-Type'];
        config.headers['Content-Type'] = 'application/json';

        try {
            let response = await fetch(url, config);

            // If still 401 after proactive refresh, try once more
            if (response.status === 401) {
                const refreshed = await AuthService.refreshAccessToken();
                if (refreshed) {
                    config.headers['Authorization'] = `Bearer ${AuthService.getToken()}`;
                    response = await fetch(url, config);
                } else {
                    AuthService.logout();
                    throw new Error('Session expired. Please login again.');
                }
            }

            if (response.status === 204) return null; // No content (e.g. DELETE success)

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error(`API request failed [${endpoint}]:`, error.message);
            throw error;
        }
    }

    // ── Materials ──────────────────────────────────────────
    static getMaterials() {
        return this.request('/inventory/materials/');
    }

    static getMaterial(id) {
        return this.request(`/inventory/materials/${id}/`);
    }

    static createMaterial(materialData) {
        return this.request('/inventory/materials/', {
            method: 'POST',
            body: JSON.stringify(materialData)
        });
    }

    static updateMaterial(id, materialData) {
        return this.request(`/inventory/materials/${id}/`, {
            method: 'PUT',
            body: JSON.stringify(materialData)
        });
    }

    static patchMaterial(id, partialData) {
        return this.request(`/inventory/materials/${id}/`, {
            method: 'PATCH',
            body: JSON.stringify(partialData)
        });
    }

    static deleteMaterial(id) {
        return this.request(`/inventory/materials/${id}/`, {
            method: 'DELETE'
        });
    }

    // ── Transactions ───────────────────────────────────────
    static getTransactions() {
        return this.request('/inventory/transactions/');
    }

    static createTransaction(transactionData) {
        return this.request('/inventory/transactions/', {
            method: 'POST',
            body: JSON.stringify(transactionData)
        });
    }

    // ── Dashboard ──────────────────────────────────────────
    static getDashboardSummary() {
        return this.request('/inventory/dashboard/');
    }
}

// ==================== DATA MANAGER ====================
class DataManager {
    constructor() {
        this.materials = [];
        this.transactions = [];
    }

    async initialize() {
        try {
            await Promise.all([
                this.loadMaterials(),
                this.loadTransactions()
            ]);
            return true;
        } catch (error) {
            console.error('Failed to initialize data:', error);
            throw error; // Let the UI show a proper error — no silent dummy data
        }
    }

    // ── Materials ──────────────────────────────────────────
    async loadMaterials() {
        const data = await ApiService.getMaterials();
        this.materials = data.map(this._toFrontendMaterial);
        return this.materials;
    }

    async addMaterial(materialData) {
        const backendData = {
            name: materialData.name,
            unit: materialData.unit,
            initial_quantity: materialData.qty,
            max_quantity: materialData.maxQty,
            low_stock_threshold_percent: materialData.lowStockThreshold
        };

        const created = await ApiService.createMaterial(backendData);
        const material = this._toFrontendMaterial(created);
        this.materials.push(material);
        return material;
    }

    async updateMaterial(id, materialData) {
        const backendData = {
            name: materialData.name,
            unit: materialData.unit,
            max_quantity: materialData.maxQty,
            low_stock_threshold_percent: materialData.lowStockThreshold
        };

        const updated = await ApiService.updateMaterial(id, backendData);
        const material = this._toFrontendMaterial(updated);
        const index = this.materials.findIndex(m => m.id === id);
        if (index !== -1) this.materials[index] = material;
        return material;
    }

    async deleteMaterial(id) {
        await ApiService.deleteMaterial(id);
        this.materials = this.materials.filter(m => m.id !== id);
    }

    // ── Transactions ───────────────────────────────────────
    async loadTransactions() {
        const data = await ApiService.getTransactions();
        this.transactions = data.map(this._toFrontendTransaction);
        return this.transactions;
    }

    async addTransaction(transactionData) {
        const backendData = {
            material: transactionData.materialId,
            type: transactionData.type,
            quantity: transactionData.qty,
            notes: transactionData.notes
        };

        const created = await ApiService.createTransaction(backendData);
        const transaction = this._toFrontendTransaction(created);
        this.transactions.push(transaction);

        // Reload materials to get accurate updated quantity from backend
        await this.loadMaterials();

        return transaction;
    }

    // ── Auth ───────────────────────────────────────────────
    async login(username, password) {
        const response = await AuthService.login(username, password);
        return response;
    }

    logout() {
        AuthService.logout();
    }

    // ── Getters ────────────────────────────────────────────
    getMaterials() {
        return this.materials;
    }

    getTransactions() {
        return this.transactions;
    }

    getCurrentUser() {
        return AuthService.getCurrentUser();
    }

    // ── Private Transformers ───────────────────────────────
    _toFrontendMaterial(m) {
        return {
            id: m.id,
            name: m.name,
            qty: parseFloat(m.current_quantity) || 0,
            maxQty: parseFloat(m.max_quantity) || 100,
            unit: m.unit,
            lowStockThreshold: m.low_stock_threshold_percent,
            lastUpdated: m.updated_at ? m.updated_at.split('T')[0] : null
        };
    }

    _toFrontendTransaction(t) {
        return {
            id: t.id,
            date: t.created_at ? t.created_at.split('T')[0] : null,
            materialId: t.material,
            type: t.type,
            qty: t.quantity,
            notes: t.notes
        };
    }
}

// ==================== GLOBAL INSTANCE ====================
const dataManager = new DataManager();
