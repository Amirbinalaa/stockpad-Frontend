// ==================== DOM ELEMENTS ====================
const appWrapper = document.getElementById('appWrapper');
const logoutBtn  = document.getElementById('logoutBtn');
const navItems   = document.querySelectorAll('.nav-item[data-page]');
const pages      = document.querySelectorAll('.page');

// ==================== GLOBAL STATE ====================
let appLoaded = false;
let notificationSystem = null;

function getMaterials()    { return dataManager.getMaterials(); }
function getTransactions() { return dataManager.getTransactions(); }

// ==================== SHOW / HIDE SCREENS ====================
function showAppScreen() {
    const authPage = document.getElementById('auth-page');
    if (authPage) {
        authPage.classList.add('hidden');
        authPage.classList.remove('visible');
    }
    const appWrapper = document.getElementById('appWrapper');
    if (appWrapper) appWrapper.classList.remove('hidden');
}

function showAuthPage() {
    const authPage = document.getElementById('auth-page');
    if (authPage) {
        authPage.classList.remove('hidden');
        requestAnimationFrame(() => requestAnimationFrame(() => authPage.classList.add('visible')));
    }
    const appWrapper = document.getElementById('appWrapper');
    if (appWrapper) appWrapper.classList.add('hidden');
}
// ==================== LOAD APP ====================
async function loadApp() {
    if (appLoaded) return;
        appLoaded = true;
    if (!notificationSystem) {
        notificationSystem = new NotificationSystem();
    }

    try {
        await dataManager.initialize();
    } catch (e) {
        console.warn('Data load failed, showing empty dashboard:', e);
    }

    showAppScreen();
    renderDashboard();
    populateMaterialSelects();
    checkNotifications();
    loadProfileForm();

    const user = dataManager.getCurrentUser();
    const display = document.getElementById('settings-username-display');
    if (user && display) {
        display.innerHTML = `
    <strong>Username:</strong> ${user.username} <span class="readonly-badge">(read-only)</span><br>
    <strong>Email:</strong> ${user.email || '—'} <span class="readonly-badge">(read-only)</span><br>
    <strong>Role:</strong> ${user.role || '—'}`;
    }

    showNotification('Welcome', user ? `Welcome back, ${user.username}!` : 'StockPad is ready!', 'success');
}

// ==================== NOTIFICATION CHECKS ====================
function checkNotifications() {
    if (!notificationSystem) return;
    const materials = getMaterials();
    const now = new Date();

    materials.forEach(material => {
        // LOW STOCK ALERT
        const maxQty = material.maxQty || 100;
        const percent = (material.qty / maxQty) * 100;
        const threshold = material.lowStockThreshold ?? 30;

        if (percent <= threshold) {
            notificationSystem.add(
                '⚠️ Low Stock Alert',
                `${material.name} is at ${percent.toFixed(1)}% — below the ${threshold}% threshold.`,
                'alert'
            );
        }
        // Start request polling
    setInterval(async () => {
        try {
            const requests = await dataManager.loadMaterialRequests('pending');
            const badge = document.querySelector('#requestsNotificationIndicator .notification-badge');
            const indicator = document.getElementById('requestsNotificationIndicator');
            if (requests.length > 0) {
                badge.textContent = requests.length;
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
            }
        } catch (e) {
            console.error('Failed to load requests:', e);
        }
    }, 10000); // Poll every 10 seconds

        // REMINDER — unused for 30+ days
        if (material.lastUpdated) {
            const lastUpdated = new Date(material.lastUpdated);
            const daysSince = Math.floor((now - lastUpdated) / (1000 * 60 * 60 * 24));
            if (daysSince >= 30) {
                notificationSystem.add(
                    '🕐 Inactivity Reminder',
                    `${material.name} hasn't been updated in ${daysSince} days.`,
                    'reminder'
                );
            }
        }
    });
}

// ==================== SPLASH DONE EVENT ====================
document.addEventListener('splashDone', async () => {
    if (typeof AuthService !== 'undefined' && AuthService.isAuthenticated()) {
        try {
            await loadApp();
        } catch {
            showAuthPage();
        }
    } else {
        const remembered = localStorage.getItem('rememberedUsername');
        if (remembered) {
            const el = document.getElementById('login-username');
            const cb = document.getElementById('login-remember');
            if (el) el.value = remembered;
            if (cb) cb.checked = true;
        }
        showAuthPage();
    }
});

// ==================== LOGOUT ====================
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        appLoaded = false;
        dataManager.logout();
        showAuthPage();
        const reportContainer = document.getElementById('reportContainer');
        if (reportContainer) reportContainer.style.display = 'none';
        showNotification('Logged Out', 'You have been logged out successfully.', 'info');
    });
}

// ==================== SIDEBAR NAVIGATION ====================
navItems.forEach(item => {
    item.addEventListener('click', () => {
        // Handle requests page - redirect to separate page
        if (item.dataset.page === 'requests') {
            window.location.href = 'requests.html';
            return;
        }

        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        const pageId = item.dataset.page + 'Page';
        pages.forEach(p => p.classList.remove('active-page'));
        const target = document.getElementById(pageId);
        if (target) target.classList.add('active-page');

        if (item.dataset.page === 'activity') populateMaterialSelects();
        else if (item.dataset.page === 'dashboard') renderDashboard();
        else if (item.dataset.page === 'settings') loadProfileForm();
    });
});

// ==================== NOTIFICATION HELPER ====================
function showNotification(title, message, type = 'info', duration = 5000) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `notification ${type}`;
    const icons = { success: 'fas fa-check-circle', error: 'fas fa-exclamation-circle', info: 'fas fa-info-circle' };
    el.innerHTML = `
        <div class="notification-icon"><i class="${icons[type] || icons.info}"></i></div>
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;
    container.appendChild(el);
    setTimeout(() => {
        if (el.parentElement) { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }
    }, duration);
}

// ==================== SEARCH ====================
const materialSearchInput = document.getElementById('materialSearch');
const clearSearchBtn       = document.getElementById('clearSearch');
const searchResultsInfo    = document.getElementById('searchResultsInfo');
const searchResultsCount   = document.getElementById('searchResultsCount');

if (materialSearchInput && clearSearchBtn) {
    materialSearchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        clearSearchBtn.style.display = term ? 'flex' : 'none';

        let count = 0;
        document.querySelectorAll('.material-bar-item').forEach(bar => {
            const name    = bar.querySelector('.material-name')?.textContent.toLowerCase() || '';
            const visible = name.includes(term);
            bar.style.display = visible ? 'block' : 'none';
            if (visible) count++;
        });

        if (term && searchResultsInfo && searchResultsCount) {
            searchResultsInfo.style.display = 'flex';
            searchResultsCount.textContent  = count === 0
                ? `No materials found for "${term}"`
                : `Found ${count} material${count !== 1 ? 's' : ''} for "${term}"`;
            searchResultsInfo.style.color = count === 0 ? 'var(--error-red)' : 'var(--burnt-orange)';
        } else if (searchResultsInfo) {
            searchResultsInfo.style.display = 'none';
        }
    });

    clearSearchBtn.addEventListener('click', () => {
        materialSearchInput.value = '';
        materialSearchInput.dispatchEvent(new Event('input'));
        materialSearchInput.focus();
    });

    materialSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { materialSearchInput.value = ''; materialSearchInput.dispatchEvent(new Event('input')); }
    });
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    const container = document.getElementById('dashboardMaterials');
    if (!container) return;

    const materials = getMaterials();
    container.innerHTML = '';

    if (materials.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:2rem;opacity:0.6;">No materials yet. Add some in Activity tab.</p>';
        return;
    }

    materials.forEach(material => {
        const maxQty = material.maxQty || 100;
        const percent = Math.min((material.qty / maxQty) * 100, 100);
        const threshold = material.lowStockThreshold ?? 30;
        const isLow     = percent <= threshold;
        const status    = isLow ? 'Low Stock' : 'Good Stock';
        const color     = isLow ? 'var(--error-red)' : 'var(--success-green)';

        const bar = document.createElement('div');
        bar.className = 'material-bar-item';
        bar.innerHTML = `
            <div class="material-bar-header">
                <div class="material-info">
                    <span class="material-name">${material.name}</span>
                    <span class="percentage-value">${percent.toFixed(1)}%</span>
                </div>
                <div class="progress-bar-bg"><div class="progress-fill" style="width:${percent}%"></div></div>
            </div>
            <div class="material-details">
                <div class="detail-item"><span class="detail-label">Name</span><span class="detail-value">${material.name}</span></div>
                <div class="detail-item"><span class="detail-label">Quantity</span><span class="detail-value">${material.qty} ${material.unit}</span></div>
                <div class="detail-item"><span class="detail-label">Stock Level</span><span class="detail-value" style="color:${color}">${percent.toFixed(1)}% (${status})</span></div>
                <div class="detail-item"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDate(material.lastUpdated)}</span></div>
            </div>
        `;
        bar.addEventListener('click', () => bar.classList.toggle('expanded'));
        container.appendChild(bar);
    });
}

// ==================== MATERIAL SELECTS ====================
function populateMaterialSelects() {
    const materials = getMaterials();

    const transactionSelect = document.getElementById('transactionMaterial');
    const reportSelect      = document.getElementById('reportMaterial');

    if (transactionSelect) {
        transactionSelect.innerHTML = '<option value="">-- Choose material --</option>';
        materials.forEach(m => {
            transactionSelect.innerHTML += `<option value="${m.id}">${m.name} (${m.qty} ${m.unit})</option>`;
        });
    }

    if (reportSelect) {
        reportSelect.innerHTML = '<option value="all">All Materials</option>';
        materials.forEach(m => {
            reportSelect.innerHTML += `<option value="${m.id}">${m.name}</option>`;
        });
    }
}

// ==================== TRANSACTION TYPE SELECTOR ====================
const selectInBtn    = document.getElementById('selectInBtn');
const selectOutBtn   = document.getElementById('selectOutBtn');
const transactionType = document.getElementById('transactionType');

if (selectInBtn && selectOutBtn) {
    selectInBtn.addEventListener('click', () => {
        selectInBtn.classList.add('active-type');
        selectOutBtn.classList.remove('active-type');
        if (transactionType) transactionType.value = 'in';
    });
    selectOutBtn.addEventListener('click', () => {
        selectOutBtn.classList.add('active-type');
        selectInBtn.classList.remove('active-type');
        if (transactionType) transactionType.value = 'out';
    });
}

// ==================== ADD MATERIAL ====================
const addMaterialForm = document.getElementById('addMaterialForm');
if (addMaterialForm) {
    addMaterialForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name              = document.getElementById('materialName').value.trim();
        const qty               = parseFloat(document.getElementById('initialQty').value);
        const maxQty = parseFloat(document.getElementById('maxQty').value);
        const unit              = document.getElementById('materialUnit').value;
        const lowStockThreshold = parseFloat(document.getElementById('lowStockThreshold').value) || null;

        try {
            await dataManager.addMaterial({ name, qty, maxQty, unit, lowStockThreshold });
            e.target.reset();
            renderDashboard();
            populateMaterialSelects();
            if (notificationSystem) {
                notificationSystem.add('✅ New Material Added', `"${name}" has been added to inventory.`, 'alert');
            }
            showNotification('Success', `Material "${name}" added!`, 'success');
        } catch (error) {
            console.error('Failed to add material:', error);
            showNotification('Error', 'Failed to add material. Please try again.', 'error');
        }
    });
}

// ==================== TRANSACTION FORM ====================
const transactionForm = document.getElementById('transactionForm');
if (transactionForm) {
    transactionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type       = document.getElementById('transactionType').value;
        const materialId = parseInt(document.getElementById('transactionMaterial').value);
        const qty        = parseFloat(document.getElementById('transactionQty').value);
        const notes      = document.getElementById('transactionNotes').value || (type === 'in' ? 'Stock IN' : 'Stock OUT');

        const material = getMaterials().find(m => m.id === materialId);
        if (!material) { showNotification('Error', 'Please select a material', 'error'); return; }

        try {
            await dataManager.addTransaction({ date: new Date().toISOString().split('T')[0], materialId, type, qty, notes });
            e.target.reset();
            renderDashboard();
            populateMaterialSelects();
            // Check if stock went low after transaction
            const updatedMaterial = getMaterials().find(m => m.id === materialId);
            if (updatedMaterial && notificationSystem) {
                const maxQty = updatedMaterial.maxQty || 100;
                const percent = (updatedMaterial.qty / maxQty) * 100;
                const threshold = updatedMaterial.lowStockThreshold ?? 30;
                if (percent <= threshold) {
                    notificationSystem.add(
                        '⚠️ Low Stock Alert',
                        `${updatedMaterial.name} dropped to ${percent.toFixed(1)}% — below the ${threshold}% threshold.`,
                        'alert'
                    );
                }
            }
            const action = type === 'in' ? 'Added' : 'Removed';
            showNotification(`Stock ${action}`, `${action} ${qty} ${material.unit} ${type === 'in' ? 'to' : 'from'} ${material.name}`, 'success');
        } catch (error) {
            console.error('Failed to process transaction:', error);
            showNotification('Error', 'Failed to process transaction.', 'error');
        }
    });
}

// ==================== REPORTS ====================
const reportPeriod = document.getElementById('reportPeriod');
if (reportPeriod) {
    reportPeriod.addEventListener('change', (e) => {
        const group = document.getElementById('specificDateGroup');
        if (!group) return;
        group.style.display = e.target.value === 'specific' ? 'block' : 'none';
        if (e.target.value === 'specific') {
            const d = document.getElementById('specificDate');
            if (d) d.value = new Date().toISOString().split('T')[0];
        }
    });
}

const generateReportBtn = document.getElementById('generateReportBtn');
if (generateReportBtn) {
    generateReportBtn.addEventListener('click', () => {
        const transactions   = getTransactions();
        const materials      = getMaterials();
        const materialFilter = document.getElementById('reportMaterial').value;
        const typeFilter     = document.getElementById('reportType').value;
        const periodFilter   = document.getElementById('reportPeriod').value;
        const specificDate   = document.getElementById('specificDate')?.value;
        const today          = new Date();

        const reportContainer = document.getElementById('reportContainer');
        if (reportContainer) reportContainer.style.display = 'block';

        const filtered = transactions.filter(t => {
            if (materialFilter !== 'all' && t.materialId !== parseInt(materialFilter)) return false;
            if (typeFilter !== 'both' && t.type !== typeFilter) return false;
            const d = new Date(t.date);
            if (periodFilter === 'today')    return d.toDateString() === today.toDateString();
            if (periodFilter === 'week')     return d >= new Date(today - 7 * 86400000);
            if (periodFilter === 'month')    return d >= new Date(today - 30 * 86400000);
            if (periodFilter === 'specific') return specificDate && d.toDateString() === new Date(specificDate).toDateString();
            return true;
        });

        const summaryDiv = document.getElementById('reportSummary');
        if (summaryDiv) {
            summaryDiv.innerHTML = `<div style="display:flex;gap:2rem;flex-wrap:wrap;">
                <span><strong>📋 Total:</strong> ${filtered.length}</span>
                <span><strong>📥 IN:</strong> ${filtered.filter(t => t.type === 'in').length}</span>
                <span><strong>📤 OUT:</strong> ${filtered.filter(t => t.type === 'out').length}</span>
            </div>`;
        }

        const reportTable = document.getElementById('reportTable');
        if (reportTable) {
            if (filtered.length === 0) { reportTable.innerHTML = '<p style="text-align:center;padding:2rem;">No transactions found</p>'; return; }
            reportTable.innerHTML = `
                <table><thead><tr><th>Date</th><th>Material</th><th>Type</th><th>Quantity</th><th>Notes</th></tr></thead>
                <tbody>${filtered.map(t => {
                    const m = materials.find(m => m.id === t.materialId);
                    const c = t.type === 'in' ? 'var(--success-green)' : 'var(--error-red)';
                    return `<tr>
                        <td>${formatDate(t.date)}</td>
                        <td>${m?.name || 'Unknown'}</td>
                        <td><span style="color:${c};font-weight:600;">${t.type === 'in' ? '📥' : '📤'} ${t.type.toUpperCase()}</span></td>
                        <td>${t.qty} ${m?.unit || ''}</td>
                        <td>${t.notes}</td>
                    </tr>`;
                }).join('')}</tbody></table>`;
        }
    });
}

// ==================== NOTIFICATION SYSTEM ====================
class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.currentPage   = 'all';
        this.init();
    }

    init() {
        this.center    = document.getElementById('notificationCenter');
        this.bellBtn   = document.getElementById('globalNotificationBtn');
        this.list      = document.getElementById('notificationList');
        this.empty     = document.getElementById('notificationEmpty');
        this.clearBtn  = document.getElementById('clearAllNotifications');
        this.tabBtns   = document.querySelectorAll('.tab-btn');

        this.bellBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
        document.addEventListener('click', (e) => {
            if (this.center && !this.center.contains(e.target) && !this.bellBtn?.contains(e.target)) this.hide();
        });
        this.tabBtns.forEach(btn => btn.addEventListener('click', () => this.switchTab(btn.dataset.tab)));
        this.clearBtn?.addEventListener('click', () => this.clearAll());

        this.load();
        this.updateBadge();
    }

    toggle() { this.center?.style.display === 'block' ? this.hide() : this.show(); }
    show()   { if (this.center) { this.center.style.display = 'block'; this.render(); this.markAllRead(); } }
    hide()   { if (this.center) this.center.style.display = 'none'; }

    switchTab(tab) {
        this.currentPage = tab;
        this.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        this.render();
    }

    add(title, message, type = 'info') {
        this.notifications.unshift({ id: Date.now(), title, message, type, timestamp: new Date(), read: false });
        this.save();
        this.updateBadge();
    }

    updateBadge() {
        const count     = this.notifications.filter(n => !n.read).length;
        const indicator = document.getElementById('globalNotificationIndicator');
        const badge     = indicator?.querySelector('.notification-badge');
        if (indicator && badge) {
            indicator.style.display = count > 0 ? 'block' : 'none';
            badge.textContent       = count > 99 ? '99+' : count;
        }
    }

    markAllRead() { this.notifications.forEach(n => n.read = true); this.save(); this.updateBadge(); }

    clearAll() { this.notifications = []; this.save(); this.updateBadge(); this.render(); }

    render() {
        if (!this.list || !this.empty) return;
        const filtered = this.currentPage === 'all' ? this.notifications : this.notifications.filter(n => n.type === this.currentPage);
        if (filtered.length === 0) { this.list.style.display = 'none'; this.empty.style.display = 'block'; return; }
        this.list.style.display  = 'block';
        this.empty.style.display = 'none';
        this.list.innerHTML = filtered.map(n => `
            <div class="notification-item ${n.type} ${!n.read ? 'unread' : ''}">
                <div class="notification-title">${n.title}</div>
                <div class="notification-message">${n.message}</div>
                <div class="notification-time">${this.timeAgo(n.timestamp)}</div>
            </div>`).join('');
    }

    timeAgo(ts) {
        const d = Date.now() - new Date(ts);
        const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), days = Math.floor(d / 86400000);
        if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`;
        if (days < 7) return `${days}d ago`; return new Date(ts).toLocaleDateString();
    }

    getKey() {
        const user = AuthService.getCurrentUser();
        return user ? `stockpad_notifications_${user.id}` : 'stockpad_notifications';
    }
    save() { localStorage.setItem(this.getKey(), JSON.stringify(this.notifications)); }
    load() {
        const s = localStorage.getItem(this.getKey());
        if (s) this.notifications = JSON.parse(s).map(n => ({ ...n, timestamp: new Date(n.timestamp) }));
    }
}

// ==================== SETTINGS ====================
const darkModeToggle = document.getElementById('darkModeToggle');
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sp_theme', next);
        const sun  = document.getElementById('g-icon-sun');
        const moon = document.getElementById('g-icon-moon');
        if (sun)  sun.style.display  = next === 'dark' ? 'block' : 'none';
        if (moon) moon.style.display = next === 'dark' ? 'none'  : 'block';
    });
}

// ==================== UTILITY ====================
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ==================== PROFILE SETTINGS ====================

// Load user data into form
function loadProfileForm() {
    const user = dataManager.getCurrentUser();
    if (!user) return;
    document.getElementById('editFirstName').value = user.firstName || '';
    document.getElementById('editLastName').value  = user.lastName  || '';
    document.getElementById('editUsername').value  = user.username  || '';
    const emailInput = document.getElementById('editEmail');
    if (emailInput) {
        emailInput.value = user.email || '';
    }
    ['editFirstName','editLastName','editUsername'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        document.getElementById('saveProfileBtn').style.display = 'inline-flex';
        document.getElementById('changePasswordBtn').style.display = 'inline-flex';
    });
});

    // Load saved profile pic
const picKey = user ? `profilePic_${user.id}` : 'profilePic';
const savedPic = localStorage.getItem(picKey);
    if (savedPic) {
        document.getElementById('profilePicPreview').src     = savedPic;
        document.getElementById('profilePicPreview').style.display  = 'block';
        document.getElementById('profilePicFallback').style.display = 'none';
    }
    const preview = document.getElementById('profilePicPreview');
    if (preview) {
        preview.style.cursor = 'pointer';
        const freshPreview = preview.cloneNode(true);
        preview.parentNode.replaceChild(freshPreview, preview);
        freshPreview.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
            const img = document.createElement('img');
            img.src = freshPreview.src;
            img.style.cssText = 'width:450px;height:450px;object-fit:cover;display:block;border-radius: 8%;';
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width:400px;height:400px;min-width:400px;min-height:400px;border-radius:50%;overflow:hidden;border:4px solid var(--burnt-orange);box-shadow:0 20px 60px rgba(0,0,0,0.5);';       
            overlay.appendChild(img);
            overlay.addEventListener('click', () => overlay.remove());
            document.body.appendChild(overlay);
        });
    }
}

// Profile picture upload
const profilePicInput = document.getElementById('profilePicInput');
if (profilePicInput) {
    profilePicInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showNotification('Error', 'Image must be under 2MB.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const base64 = ev.target.result;
            const user = dataManager.getCurrentUser();
const picKey = user ? `profilePic_${user.id}` : 'profilePic';
localStorage.setItem(picKey, base64);
            document.getElementById('profilePicPreview').src     = base64;
            document.getElementById('profilePicPreview').style.display  = 'block';
            document.getElementById('profilePicFallback').style.display = 'none';
            showNotification('Success', 'Profile picture updated!', 'success');
        };
        reader.readAsDataURL(file);
    });
}

// Save profile changes
const saveProfileBtn = document.getElementById('saveProfileBtn');
if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        const firstName = document.getElementById('editFirstName').value.trim();
        const lastName  = document.getElementById('editLastName').value.trim();
        const username  = document.getElementById('editUsername').value.trim();
        const msg = document.getElementById('profileSaveMsg');

        try {
            const response = await fetch('https://stockpad-backend-production.up.railway.app/api/auth/profile/', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AuthService.getToken()}`
                },
                body: JSON.stringify({ first_name: firstName, last_name: lastName, username })
            });

            if (!response.ok) throw new Error('Failed to update profile');

            const updated = await response.json();
            const currentUser = dataManager.getCurrentUser();
            const newUser = { ...currentUser, firstName, lastName, username: updated.username, email: updated.email };
            localStorage.setItem('currentUser', JSON.stringify(newUser));

            // Refresh settings display
            const display = document.getElementById('settings-username-display');
            if (display) {
                display.innerHTML = `
                    <strong>Username:</strong> ${updated.username} <span class="readonly-badge">(read-only)</span><br>
                    <strong>Email:</strong> ${updated.email || '—'} <span class="readonly-badge">(read-only)</span><br>
                    <strong>Role:</strong> ${updated.role || '—'}
                `;
            }

            msg.textContent = '✅ Profile updated successfully!';
            msg.style.color = 'var(--success-green)';
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
            showNotification('Success', 'Profile updated!', 'success');
            document.getElementById('saveProfileBtn').style.display = 'none';
            document.getElementById('changePasswordBtn').style.display = 'none';

        } catch (err) {
            msg.textContent = '❌ Failed to save changes.';
            msg.style.color = 'var(--error-red)';
            msg.style.display = 'block';
        }
    });
}

// Change Password Modal
const changePasswordBtn = document.getElementById('changePasswordBtn');
const changePasswordModal = document.getElementById('changePasswordModal');
const closePasswordModal = document.getElementById('closePasswordModal');
const submitPasswordBtn = document.getElementById('submitPasswordBtn');

    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            changePasswordModal.style.display = 'flex';
        });
    }

    if (closePasswordModal) {
        closePasswordModal.addEventListener('click', () => {
            changePasswordModal.style.display = 'none';
            document.getElementById('oldPassword').value     = '';
            document.getElementById('newPassword').value     = '';
            document.getElementById('confirmPassword').value = '';
            document.getElementById('passwordChangeError').style.display = 'none';
        });
    }

    if (submitPasswordBtn) {
        submitPasswordBtn.addEventListener('click', async () => {
            const oldPassword     = document.getElementById('oldPassword').value;
            const newPassword     = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const errorEl         = document.getElementById('passwordChangeError');

            errorEl.style.display = 'none';

            if (newPassword.length < 8) {
                errorEl.textContent = 'New password must be at least 8 characters.';
                errorEl.style.display = 'block';
                return;
            }
            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'Passwords do not match.';
                errorEl.style.display = 'block';
                return;
            }

            try {
                const response = await fetch('https://stockpad-backend-production.up.railway.app/api/auth/change-password/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${AuthService.getToken()}`
                    },
                    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.detail || 'Failed to change password');
                }

                changePasswordModal.style.display = 'none';
                document.getElementById('oldPassword').value     = '';
                document.getElementById('newPassword').value     = '';
                document.getElementById('confirmPassword').value = '';
                showNotification('Success', 'Password changed successfully!', 'success');

            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.style.display = 'block';
            }
        });
    }

// ==================== PANEL HEADLINE & DOTS SLIDER ====================
const slides = document.querySelectorAll('.panel-headline-slider .slide-item');
const dots = document.querySelectorAll('#sliderDots .dot');
let currentSlide = 0;

if (slides.length > 0) {
    setInterval(() => {
        // Exit current
        slides[currentSlide].classList.add('slide-out');
        slides[currentSlide].classList.remove('slide-active');
        dots[currentSlide].classList.remove('active');

        currentSlide = (currentSlide + 1) % slides.length;

        // Enter next
        slides[currentSlide].classList.remove('slide-out');
        slides[currentSlide].classList.add('slide-active');
        dots[currentSlide].classList.add('active');
    }, 3000);
}
