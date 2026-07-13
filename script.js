// ==================== DOM ELEMENTS ====================
const appWrapper = document.getElementById('appWrapper');
const logoutBtn  = document.getElementById('logoutBtn');
const navItems   = document.querySelectorAll('.nav-item[data-page]');
const pages      = document.querySelectorAll('.page');

// ==================== GLOBAL STATE ====================
let appLoaded = false;
let notificationSystem = null;
let isPendingFetching = false;
let pendingPollInterval = null;

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
    checkNotifications(); // async — fires backend calls, does not block app render
    loadProfileForm();

    // Requests Event Listeners
    document.getElementById('refreshRequestsBtn')?.addEventListener('click', loadRequestsPage);
    document.querySelectorAll('.requests-filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.requests-filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentRequestFilter = tab.dataset.status;
            renderRequestsTable();
        });
    });
    document.getElementById('cancelReviewBtn')?.addEventListener('click', closeReviewModal);
    document.getElementById('confirmReviewBtn')?.addEventListener('click', handleReviewAction);
    
    // Close modal on overlay click
    document.getElementById('reviewRequestModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'reviewRequestModal') closeReviewModal();
    });

    // Start request polling — Singleton Timer pattern to prevent interval stacking
    let _lastPendingCount = 0;
    if (pendingPollInterval) clearInterval(pendingPollInterval);
    pendingPollInterval = setInterval(async () => {
        if (isPendingFetching) return; // Guard: skip if a fetch is already in-flight
        isPendingFetching = true;
        try {
            const requests = await dataManager.loadMaterialRequests('pending');
            const count = requests.length;
            const badge = document.querySelector('#requestsNotificationIndicator .notification-badge');
            const indicator = document.getElementById('requestsNotificationIndicator');
            if (indicator && badge) {
                if (count > 0) {
                    badge.textContent = count;
                    indicator.style.display = 'block';
                } else {
                    indicator.style.display = 'none';
                }
            }
            // Bell notification for truly new arrivals
            if (count > _lastPendingCount && notificationSystem) {
                const diff = count - _lastPendingCount;
                notificationSystem.add(
                    `📬 New Material Request${diff > 1 ? 's' : ''}`,
                    `${diff} new pending request${diff > 1 ? 's' : ''} awaiting your review.`,
                    'requests'
                );
            }
            _lastPendingCount = count;
        } catch (e) {
            if (!(typeof ApiService !== 'undefined' && ApiService.isSessionExpiredError(e))) {
                console.error('Failed to load requests:', e);
            }
        } finally {
            isPendingFetching = false; // Always release the lock
        }
    }, 60000); // Poll every 60 seconds


    const user = dataManager.getCurrentUser();
    
    
        
    
    
    
    

    showNotification('Welcome', user ? `Welcome back, ${user.username}!` : 'StockPad is ready!', 'success');
    fetchAndRenderAIInsights();
}

// ==================== NOTIFICATION CHECKS ====================
/**
 * Scans loaded materials and sends alert/reminder notifications to the backend.
 * The backend's create_or_group() method applies a 24-hour dedup guard via
 * group_key, so calling this on every login never creates duplicate rows.
 */
async function checkNotifications() {
    if (typeof ApiService === 'undefined') return;
    const materials = getMaterials();
    if (!materials || materials.length === 0) return;
    const now = new Date();

    const jobs = [];

    materials.forEach(material => {
        const materialSlug = String(material.id)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-');

        // ── LOW STOCK ALERT ──────────────────────────────────────────────
        const maxQty    = material.maxQty || 100;
        const percent   = Math.min((material.qty / maxQty) * 100, 100);
        const threshold = (material.lowStockThreshold != null && material.lowStockThreshold > 0)
            ? material.lowStockThreshold
            : 30;

        if (percent <= threshold) {
            jobs.push(
                ApiService.createNotification(
                    '⚠️ Low Stock Alert',
                    `${material.name} is at ${percent.toFixed(1)}% — below the ${threshold}% threshold.`,
                    'alert',
                    `low-stock-${materialSlug}`
                ).catch(() => {}) // silent — don't block UI on notif failure
            );
        }

        // ── INACTIVITY REMINDER ───────────────────────────────────────────
        if (material.lastUpdated) {
            const lastUpdated = new Date(material.lastUpdated);
            const daysSince   = Math.floor((now - lastUpdated) / 86400000);
            if (daysSince >= 30) {
                jobs.push(
                    ApiService.createNotification(
                        '🕐 Inactivity Reminder',
                        `${material.name} hasn't been updated in ${daysSince} days.`,
                        'reminder',
                        `inactivity-${materialSlug}`
                    ).catch(() => {})
                );
            }
        }
    });

    // Fire all requests concurrently, then refresh the bell badge
    await Promise.allSettled(jobs);
    if (notificationSystem) {
        await notificationSystem.updateBadge();
    }
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
        notificationSystem = null;
        clearInterval(pendingPollInterval);
        pendingPollInterval = null;
        dataManager.logout();
        showAuthPage();
        const reportContainer = document.getElementById('reportContainer');
        if (reportContainer) reportContainer.style.display = 'none';
        const exportBar = document.getElementById('reportExportBar');
        if (exportBar) exportBar.style.display = 'none';
        showNotification('Logged Out', 'You have been logged out successfully.', 'info');
    });
}

// ==================== SIDEBAR NAVIGATION ====================
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        const pageId = item.dataset.page + 'Page';
        pages.forEach(p => p.classList.remove('active-page'));
        const target = document.getElementById(pageId);
        if (target) target.classList.add('active-page');

        if (item.dataset.page === 'activity') populateMaterialSelects();
        else if (item.dataset.page === 'dashboard') renderDashboard();
        else if (item.dataset.page === 'settings') loadProfileForm();
        else if (item.dataset.page === 'requests') loadRequestsPage();
        else if (item.dataset.page === 'ai-insights') fetchAndRenderAIInsights();

        // Dismiss mobile navigation overlay on click
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
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
const MATERIAL_IMAGE_CACHE_PREFIX = 'sp_material_img_';

function resolveMaterialImageUrl(material) {
    if (!material) return '';
    const candidates = [
        material.image,
        material.imageUrl,
        material.image_url,
        material.thumbnail_url,
        material.thumbnail,
    ];
    for (let i = 0; i < candidates.length; i++) {
        const raw = candidates[i];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    try {
        const cached = localStorage.getItem(`${MATERIAL_IMAGE_CACHE_PREFIX}${material.id}`);
        if (cached && cached.trim()) return cached.trim();
    } catch (_) { /* ignore */ }
    return '';
}

function escapeHtmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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
        const threshold = (material.lowStockThreshold != null && material.lowStockThreshold > 0)
            ? material.lowStockThreshold
            : 30;
        
        // strict 3-tier health state logic
        let healthState = 'optimal';
        let status = 'Optimal Stock';
        let color = 'var(--success-green)';
        
        if (percent <= threshold) {
            healthState = 'critical';
            status = 'Critical Stock';
            color = 'var(--error-red)';
        } else if (percent <= threshold + 15) {
            healthState = 'warning';
            status = 'Warning Level';
            color = 'var(--warning-yellow)';
        }

        const imageUrl = resolveMaterialImageUrl(material);
        const hasImage = Boolean(imageUrl);
        const thumbBlock = hasImage
            ? `<img class="material-hud-thumb" src="${escapeHtmlAttr(imageUrl)}" alt="" loading="lazy" />`
            : '';

        const bar = document.createElement('div');
        bar.className = hasImage ? 'material-bar-item material-bar-item--has-image' : 'material-bar-item';
        bar.innerHTML = `
            <div class="material-bar-header">
                <span class="material-name">${material.name}</span>
                <div class="material-progress-hud">
                    <div class="material-progress-hud__track">
                        <div class="progress-bar-bg"><div class="progress-fill ${healthState}" style="transform:scaleX(${(percent / 100).toFixed(4)});"></div></div>
                        <span class="percentage-value">${percent.toFixed(1)}%</span>
                    </div>
                </div>
            </div>
            <div class="material-details">
                <div class="detail-item"><span class="detail-label">Name</span><span class="detail-value">${material.name}</span></div>
                <div class="detail-item"><span class="detail-label">Quantity</span><span class="detail-value">${material.qty} ${material.unit}</span></div>
                <div class="detail-item"><span class="detail-label">Stock Level</span><span class="detail-value" style="color:${color}">${percent.toFixed(1)}% (${status})</span></div>
                <div class="detail-item"><span class="detail-label">Cost</span><span class="detail-value">${formatMaterialCost(material)}</span></div>
                <div class="detail-item"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDate(material.lastUpdated)}</span></div>
            </div>
            ${thumbBlock}
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

// ==================== ADD MATERIAL UI (tabs, toggle, image preview) ====================
const addMaterialSection = document.getElementById('addMaterialSection');
const toggleAddMaterialBtn = document.getElementById('toggleAddMaterialBtn');
if (toggleAddMaterialBtn && addMaterialSection) {
    addMaterialSection.style.display = 'none';
    toggleAddMaterialBtn.addEventListener('click', () => {
        const hidden = addMaterialSection.style.display === 'none';
        addMaterialSection.style.display = hidden ? 'block' : 'none';
    });
}
const addMaterialTabs = document.querySelectorAll('.add-material-tab');
const addMaterialPanels = document.querySelectorAll('.add-material-panel');
addMaterialTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab-target');
        addMaterialTabs.forEach((t) => {
            const on = t === tab;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        addMaterialPanels.forEach((panel) => {
            const on = panel.getAttribute('data-panel') === target;
            panel.classList.toggle('active', on);
            panel.hidden = !on;
        });
    });
});
const materialImageInput = document.getElementById('materialImageInput');
const materialImagePreview = document.getElementById('materialImagePreview');
const materialImagePlaceholder = document.getElementById('materialImagePlaceholder');
if (materialImageInput && materialImagePreview) {
    materialImageInput.addEventListener('change', () => {
        const file = materialImageInput.files && materialImageInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            materialImagePreview.src = reader.result;
            materialImagePreview.hidden = false;
            if (materialImagePlaceholder) materialImagePlaceholder.hidden = true;
        };
        reader.readAsDataURL(file);
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
        const costPrice = parseFloat(document.getElementById('materialCostPrice')?.value) || 0;
        const currency = document.getElementById('materialCurrency')?.value || 'EGP';
        const costingMethod = document.getElementById('materialCostingMethod')?.value || 'MOVING_AVG';

        try {
            const imageFile = materialImageInput?.files?.[0] || null;
            const created = await dataManager.addMaterial({
                name, qty, maxQty, unit, lowStockThreshold, costPrice, currency, costingMethod,
            }, imageFile);
            const previewSrc = materialImagePreview && !materialImagePreview.hidden
                ? materialImagePreview.src
                : '';
            if (created?.id && previewSrc && !created.imageUrl) {
                try {
                    localStorage.setItem(`${MATERIAL_IMAGE_CACHE_PREFIX}${created.id}`, previewSrc);
                } catch (_) { /* ignore */ }
            }
            e.target.reset();
            if (materialImagePreview) {
                materialImagePreview.hidden = true;
                materialImagePreview.removeAttribute('src');
            }
            if (materialImagePlaceholder) materialImagePlaceholder.hidden = false;
            if (materialImageInput) materialImageInput.value = '';
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
                const percent = Math.min((updatedMaterial.qty / maxQty) * 100, 100); // cap at 100%
                const threshold = (updatedMaterial.lowStockThreshold != null && updatedMaterial.lowStockThreshold > 0)
                    ? updatedMaterial.lowStockThreshold
                    : 30;
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
        const reportExportBar = document.getElementById('reportExportBar');
        if (reportExportBar) reportExportBar.style.display = 'flex';

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
            const totalCount = filtered.length;
            const totalInQty = filtered.filter(t => t.type === 'in').reduce((sum, t) => sum + Number(t.qty || 0), 0);
            const totalOutQty = filtered.filter(t => t.type === 'out').reduce((sum, t) => sum + Number(t.qty || 0), 0);
            const netQtyChange = totalInQty - totalOutQty;

            summaryDiv.innerHTML = `
                <div class="report-summary-cards">
                    <div class="report-summary-card">
                        <div class="card-icon"><i class="fas fa-list"></i></div>
                        <div class="card-info">
                            <span class="card-label">Total Transactions</span>
                            <span class="card-value">${totalCount}</span>
                        </div>
                    </div>
                    <div class="report-summary-card">
                        <div class="card-icon success"><i class="fas fa-arrow-down"></i></div>
                        <div class="card-info">
                            <span class="card-label">Net Vol In</span>
                            <span class="card-value">${totalInQty.toFixed(1)}</span>
                        </div>
                    </div>
                    <div class="report-summary-card">
                        <div class="card-icon danger"><i class="fas fa-arrow-up"></i></div>
                        <div class="card-info">
                            <span class="card-label">Net Vol Out</span>
                            <span class="card-value">${totalOutQty.toFixed(1)}</span>
                        </div>
                    </div>
                </div>
                <div class="report-summary" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <span><strong>Net Stock Change (IN - OUT):</strong></span>
                    <span style="font-weight: 700; color: ${netQtyChange >= 0 ? 'var(--success-green)' : 'var(--error-red)'}">
                        ${netQtyChange >= 0 ? '📥 +' : '📤 '}${netQtyChange.toFixed(1)} units
                    </span>
                </div>
            `;
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

// ==================== REPORT EXPORT ====================
function getReportFilteredTransactions() {
    const transactions   = getTransactions();
    const materials      = getMaterials();
    const materialFilter = document.getElementById('reportMaterial')?.value;
    const typeFilter     = document.getElementById('reportType')?.value;
    const periodFilter   = document.getElementById('reportPeriod')?.value;
    const specificDate   = document.getElementById('specificDate')?.value;
    const today          = new Date();

    return transactions
        .filter(t => {
            if (!t) return false;

            if (materialFilter && materialFilter !== 'all' && t.materialId !== parseInt(materialFilter)) return false;
            if (typeFilter && typeFilter !== 'both' && t.type !== typeFilter) return false;
            const d = new Date(t.date);
            if (isNaN(d.getTime())) return false;

            if (periodFilter === 'today')    return d.toDateString() === today.toDateString();
            if (periodFilter === 'week')     return d >= new Date(today - 7 * 86400000);
            if (periodFilter === 'month')    return d >= new Date(today - 30 * 86400000);
            if (periodFilter === 'specific') return specificDate && d.toDateString() === new Date(specificDate).toDateString();
            return true;
        })
        .map(t => {
            const m = materials.find(m => m.id === t.materialId);
            return {
                'Date': formatDate(t.date),

                'Material': m?.name || 'Unknown',
                'Unit': m?.unit || '',
                'Type': (t.type || 'N/A').toUpperCase(),
                'Quantity': t.qty || 0,
                'Notes': t.notes || '',
            };
        });
}

const exportCsvBtn = document.getElementById('exportCsvBtn');
if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
        const rows = getReportFilteredTransactions();
        if (!rows.length) { showNotification('No Data', 'Generate a report first.', 'error'); return; }
        const headers = Object.keys(rows[0]);
                const csvContent = "\ufeff" + [
            headers.join(','),
            ...rows.map(r => headers.map(h => {
                const val = (r[h] === null || r[h] === undefined) ? '' : r[h];
                return `"${String(val).replace(/"/g, '""')}"`;
            }).join(','))
        ].join('\n');

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

        const url  = URL.createObjectURL(blob);
                const a = document.createElement('a');
        const filename = `stockpad_report_${new Date().toISOString().split('T')[0]}.csv`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);

                a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
                showNotification('Exported', `Report downloaded as ${filename}`, 'success');

    });
}

const exportXlsxBtn = document.getElementById('exportXlsxBtn');
if (exportXlsxBtn) {
    exportXlsxBtn.addEventListener('click', () => {
        const rows = getReportFilteredTransactions();
        if (!rows.length) { showNotification('No Data', 'Generate a report first.', 'error'); return; }
        if (typeof XLSX === 'undefined') { showNotification('Error', 'XLSX library not loaded.', 'error'); return; }
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
                const filename = `stockpad_report_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

                showNotification('Exported', `Report downloaded as ${filename}`, 'success');

    });
}

// ==================== NOTIFICATION SYSTEM ====================
class NotificationSystem {
    constructor() {
        this.notifications = []; // Client-side cache of all notifications
        this.currentTab    = 'all';
        this._loading      = false;
        this.init();
    }

    // ── DOM wiring ─────────────────────────────────────────────────────────
    init() {
        this.center      = document.getElementById('notificationCenter');
        this.bellBtn     = document.getElementById('globalNotificationBtn');
        this.list        = document.getElementById('notificationList');
        this.empty       = document.getElementById('notificationEmpty');
        this.markAllBtn  = document.getElementById('markAllNotificationsRead');
        this.tabBtns     = document.querySelectorAll('.tab-btn');

        this.bellBtn?.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

        document.addEventListener('click', (e) => {
            if (
                this.center &&
                !this.center.contains(e.target) &&
                !this.bellBtn?.contains(e.target)
            ) this.hide();
        });

        this.tabBtns.forEach(btn =>
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab))
        );

        this.markAllBtn?.addEventListener('click', () => this.markAllAsRead());

        // Initial fetch on sign-in / app load (non-blocking)
        this.refresh();
    }

    // ── API helpers ─────────────────────────────────────────────────────────

    /** Normalise an API notification object into a flat client-side shape */
    _mapFromApi(item) {
        return {
            id:        String(item.id),          // UUID — keep as string
            title:     item.title,
            message:   item.message,
            category:  item.category,            // 'alert' | 'reminder' | 'request'
            read:      item.is_read,
            groupKey:  item.group_key || null,
            count:     item.count || 1,
            timestamp: new Date(item.updated_at || item.created_at),
        };
    }

    /** Pull the latest list from the server and update the local cache */
    async refresh() {
        if (this._loading) return;
        this._loading = true;
        try {
            const data  = await ApiService.getNotifications();
            const items = Array.isArray(data) ? data : (data.results || []);
            this.notifications = items.map(n => this._mapFromApi(n));
            await this.updateBadge();
            if (this.center?.style.display === 'block') this.render();
        } catch (e) {
            if (!ApiService.isSessionExpiredError(e)) {
                console.error('Failed to load notifications:', e);
            }
        } finally {
            this._loading = false;
        }
    }

    // ── Panel open / close ──────────────────────────────────────────────────
    toggle() { this.center?.style.display === 'block' ? this.hide() : this.show(); }

    async show() {
        if (!this.center) return;
        this.center.style.display = 'block';
        await this.refresh();
        this.render();
    }

    hide() { if (this.center) this.center.style.display = 'none'; }

    // ── Tab switching ───────────────────────────────────────────────────────
    switchTab(tab) {
        this.currentTab = tab;
        this.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        this.render();
    }

    // ── Badge (bell icon counter) ───────────────────────────────────────────
    async updateBadge() {
        const indicator = document.getElementById('globalNotificationIndicator');
        const badge     = indicator?.querySelector('.notification-badge');
        if (!indicator || !badge) return;

        let count = 0;
        try {
            const counts = await ApiService.getNotificationSummary();
            count = counts.all || 0;
        } catch {
            // Fallback: count from local cache
            count = this.notifications.filter(n => !n.read).length;
        }

        indicator.style.display = count > 0 ? 'block' : 'none';
        badge.textContent       = count > 99 ? '99+' : String(count);
    }

    // ── Mark all as read (single bulk request) ──────────────────────────────
    async markAllAsRead() {
        const hasUnread = this.notifications.some(n => !n.read);
        if (!hasUnread) return;

        try {
            await ApiService.markAllNotificationsRead();
            // Update local cache immediately — no need for a full refresh
            this.notifications.forEach(n => { n.read = true; });
            await this.updateBadge();
            this.render();
        } catch (e) {
            console.error('Failed to mark all notifications as read:', e);
        }
    }

    // ── Mark single notification read ───────────────────────────────────────
    async markOneRead(id) {
        try {
            await ApiService.markNotificationRead(id);
            const n = this.notifications.find(n => n.id === id);
            if (n) n.read = true;
            await this.updateBadge();
            this.render();
        } catch (e) {
            if (!ApiService.isSessionExpiredError(e)) {
                console.error('Failed to mark notification as read:', e);
            }
        }
    }

    // ── Delete a single notification ────────────────────────────────────────
    async deleteOne(id) {
        try {
            await ApiService.deleteNotification(id);
            this.notifications = this.notifications.filter(n => n.id !== id);
            await this.updateBadge();
            this.render();
        } catch (e) {
            console.error('Failed to delete notification:', e);
        }
    }

    // ── Legacy add() shim ───────────────────────────────────────────────────
    /**
     * Used by the pending-requests poller and other callsites that still call
     * notificationSystem.add().  Fires a toast and persists to the backend.
     */
    add(title, message, type = 'info') {
        // Support historical inverted argument order
        if (['alert', 'reminder', 'request', 'info', 'success', 'error'].includes(title)) {
            [title, message, type] = [message, type, title];
        }

        // Map internal type strings to a notification category
        const catMap = { alert: 'alert', reminder: 'reminder', request: 'request', requests: 'request' };
        const category = catMap[type] || null;

        // Toast
        const toastType = (type === 'alert' || type === 'error') ? 'error'
            : (type === 'success' || type === 'request' || type === 'requests') ? 'success'
            : 'info';
        showNotification(title, message, toastType, 4000);

        // Backend persistence (fire-and-forget)
        if (category) {
            const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 80);
            ApiService.createNotification(title, message, category, slug)
                .then(() => this.updateBadge())
                .catch(() => {});
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────
    render() {
        if (!this.list || !this.empty) return;

        const filtered = this.currentTab === 'all'
            ? this.notifications
            : this.notifications.filter(n => n.category === this.currentTab);

        if (filtered.length === 0) {
            this.list.style.display  = 'none';
            this.empty.style.display = 'block';
            return;
        }

        this.list.style.display  = 'block';
        this.empty.style.display = 'none';

        const ICONS = {
            alert:    'fas fa-exclamation-triangle',
            reminder: 'fas fa-clock',
            request:  'fas fa-box-open',
        };

        this.list.innerHTML = filtered.map(n => {
            const icon       = ICONS[n.category] || 'fas fa-bell';
            const unreadCls  = !n.read ? 'unread' : '';
            const countPill  = n.count > 1
                ? `<span class="notif-count-pill">+${n.count - 1} more</span>`
                : '';
            return `
            <div class="notification-item ${n.category} ${unreadCls}"
                 data-id="${n.id}"
                 data-category="${n.category}">
                <div class="notif-card-inner">
                    <div class="notification-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="notification-details">
                        <div class="notification-title">
                            ${n.title}
                            ${countPill}
                        </div>
                        <div class="notification-message">${n.message}</div>
                        <div class="notification-time">${this._timeAgo(n.timestamp)}</div>
                    </div>
                    <button class="notif-delete-btn" data-id="${n.id}"
                            title="Delete notification" aria-label="Delete">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        // ── Event listeners ──────────────────────────────────────────────
        this.list.querySelectorAll('.notification-item').forEach(el => {
            el.addEventListener('click', async (e) => {
                // Don't trigger card-click when the trash btn is clicked
                if (e.target.closest('.notif-delete-btn')) return;

                const id = el.dataset.id;
                if (id) await this.markOneRead(id);

                // Navigate to the relevant page
                const cat  = el.dataset.category;
                const dest = cat === 'request' ? 'requests' : 'dashboard';
                this.hide();
                const navItem = document.querySelector(`.nav-item[data-page="${dest}"]`);
                if (navItem) navItem.click();
            });
        });

        this.list.querySelectorAll('.notif-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (id) await this.deleteOne(id);
            });
        });
    }

    // ── Relative timestamp ──────────────────────────────────────────────────
    _timeAgo(ts) {
        const diff = Date.now() - new Date(ts);
        const m    = Math.floor(diff / 60000);
        const h    = Math.floor(diff / 3600000);
        const d    = Math.floor(diff / 86400000);
        if (m < 1)  return 'Just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        if (d < 7)  return `${d}d ago`;
        return new Date(ts).toLocaleDateString();
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

function convertDaysToUnitAndValue(totalDays) {
    if (!totalDays) return { value: '', unit: 'days' };
    if (totalDays % 365 === 0) {
        return { value: totalDays / 365, unit: 'years' };
    } else if (totalDays % 30 === 0) {
        return { value: totalDays / 30, unit: 'months' };
    } else if (totalDays % 7 === 0) {
        return { value: totalDays / 7, unit: 'weeks' };
    } else {
        return { value: totalDays, unit: 'days' };
    }
}

function convertToDays(value, unit) {
    const val = parseInt(value, 10) || 0;
    if (unit === 'weeks') return val * 7;
    if (unit === 'months') return val * 30;
    if (unit === 'years') return val * 365;
    return val;
}

async function loadPreferences() {
    try {
        const prefs = await ApiService.getPreferences();
        if (!prefs) return;
        
        const defaultUnitSelect = document.getElementById('defaultUnit');
        if (defaultUnitSelect && prefs.default_unit) {
            defaultUnitSelect.value = prefs.default_unit;
        }

        const dateFormatSelect = document.getElementById('dateFormat');
        if (dateFormatSelect && prefs.date_format) {
            dateFormatSelect.value = prefs.date_format;
        }

        const deadStockDays = prefs.dead_stock_threshold_days;
        const converted = convertDaysToUnitAndValue(deadStockDays);
        
        const deadStockValueInput = document.getElementById('deadStockValue');
        const deadStockUnitSelect = document.getElementById('deadStockUnit');
        if (deadStockValueInput) {
            deadStockValueInput.value = converted.value;
        }
        if (deadStockUnitSelect) {
            deadStockUnitSelect.value = converted.unit;
        }
    } catch (err) {
        console.error('Failed to load preferences:', err);
    }
}

async function savePreferences() {
    const defaultUnit = document.getElementById('defaultUnit')?.value;
    const dateFormat = document.getElementById('dateFormat')?.value;
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const deadStockValue = document.getElementById('deadStockValue')?.value;
    const deadStockUnit = document.getElementById('deadStockUnit')?.value;
    const msg = document.getElementById('preferencesSaveMsg');

    const totalDays = convertToDays(deadStockValue, deadStockUnit);

    try {
        const payload = {
            default_unit: defaultUnit,
            date_format: dateFormat,
            theme: theme,
            dead_stock_threshold_days: totalDays
        };

        await ApiService.updatePreferences(payload);

        if (msg) {
            msg.textContent = '✅ Settings saved successfully!';
            msg.style.color = 'var(--success-green)';
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
        }
        showNotification('Success', 'Preferences updated!', 'success');
    } catch (err) {
        if (msg) {
            msg.textContent = '❌ Failed to save settings.';
            msg.style.color = 'var(--error-red)';
            msg.style.display = 'block';
        }
        showNotification('Error', 'Failed to save settings.', 'error');
    }
}

function initSettingsPersistence() {
    const btn = document.getElementById('saveSettingsBtn');
    if (btn && !btn.dataset.listenerAttached) {
        btn.dataset.listenerAttached = 'true';
        btn.addEventListener('click', savePreferences);
    }
}

function initMobileMenu() {
    const menuBtn = document.getElementById('hamburgerMenuBtn');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!menuBtn || !sidebar || !overlay) return;

    if (menuBtn.dataset.listenerAttached === 'true') return;
    menuBtn.dataset.listenerAttached = 'true';

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.add('active');
        overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        }
    });
}

// Bind event listeners
document.addEventListener('DOMContentLoaded', () => {
    initSettingsPersistence();
    initMobileMenu();
});
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initSettingsPersistence();
    initMobileMenu();
}

// ==================== UTILITY ====================
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ==================== PROFILE SETTINGS ====================

function applyProfilePicture(url) {
    const preview = document.getElementById('profilePicPreview');
    const fallback = document.getElementById('profilePicFallback');
    if (!preview || !fallback) return;
    if (url) {
        preview.src = url;
        preview.style.display = 'block';
        fallback.style.display = 'none';
    } else {
        preview.removeAttribute('src');
        preview.style.display = 'none';
        fallback.style.display = 'flex';
    }
}

// Load user data into form
async function loadProfileForm() {
    const user = dataManager.getCurrentUser();
    if (!user) return;
    document.getElementById('editFirstName').value = user.firstName || '';
    document.getElementById('editLastName').value  = user.lastName  || '';
    document.getElementById('editUsername').value  = user.username  || '';
    const emailInput = document.getElementById('editEmail');
    if (emailInput) {
        emailInput.value = user.email || '';
    }
    loadPreferences();
    ['editFirstName','editLastName','editUsername'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        document.getElementById('saveProfileBtn').style.display = 'inline-flex';
        document.getElementById('changePasswordBtn').style.display = 'inline-flex';
    });
});

    try {
        const profile = await AuthService.fetchProfile();
        applyProfilePicture(profile.profile_picture_url);
        AuthService.setCurrentUser({
            ...user,
            firstName: profile.first_name,
            lastName: profile.last_name,
            username: profile.username,
            email: profile.email,
            profilePictureUrl: profile.profile_picture_url,
        }, AuthService.isRememberMe());
    } catch (e) {
        applyProfilePicture(user.profilePictureUrl || null);
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
    profilePicInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showNotification('Error', 'Image must be under 2MB.', 'error');
            return;
        }
        try {
            const result = await AuthService.uploadProfilePicture(file);
            applyProfilePicture(result.profile_picture_url);
            const user = dataManager.getCurrentUser();
            if (user) {
                AuthService.setCurrentUser({
                    ...user,
                    profilePictureUrl: result.profile_picture_url,
                }, AuthService.isRememberMe());
            }
            showNotification('Success', 'Profile picture updated!', 'success');
        } catch (err) {
            showNotification('Error', err.message || 'Failed to upload profile picture.', 'error');
        }
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
            const updated = await AuthService.updateProfile({
                first_name: firstName,
                last_name: lastName,
                username,
            });
            const currentUser = dataManager.getCurrentUser();
            const newUser = {
                ...currentUser,
                firstName,
                lastName,
                username: updated.username,
                email: updated.email,
                profilePictureUrl: updated.profile_picture_url || currentUser?.profilePictureUrl,
            };
            AuthService.setCurrentUser(newUser, AuthService.isRememberMe());

            
            
            
                
                    
                    
                    
                
            

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
                await AuthService.changePassword(oldPassword, newPassword);
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
// ==================== MATERIAL REQUESTS ====================
let allRequests = [];
let currentRequestFilter = 'all';
let currentActionRequestId = null;
let currentActionType = null;

async function loadRequestsPage() {
    const tableBody = document.getElementById('requestsTableBody');
    if (!tableBody) return;

    try {
        allRequests = await dataManager.loadMaterialRequests();
        updateRequestStats();
        renderRequestsTable();
    } catch (e) {
        if (typeof ApiService !== 'undefined' && ApiService.isSessionExpiredError(e) && allRequests.length) {
            updateRequestStats();
            renderRequestsTable();
            return;
        }
        console.error('Failed to load requests:', e);
        if (allRequests.length) {
            updateRequestStats();
            renderRequestsTable();
            return;
        }
        showNotification('Error', 'Failed to load material requests.', 'error');
    }
}

function updateRequestStats() {
    const stats = {
        pending: allRequests.filter(r => r.status === 'pending').length,
        approved: allRequests.filter(r => r.status === 'approved').length,
        denied: allRequests.filter(r => r.status === 'denied').length,
        total: allRequests.length
    };

    const sPending = document.getElementById('reqStatPending');
    const sApproved = document.getElementById('reqStatApproved');
    const sDenied = document.getElementById('reqStatDenied');
    const sTotal = document.getElementById('reqStatTotal');

    if (sPending) sPending.textContent = stats.pending;
    if (sApproved) sApproved.textContent = stats.approved;
    if (sDenied) sDenied.textContent = stats.denied;
    if (sTotal) sTotal.textContent = stats.total;
}

function renderRequestsTable() {
    const tbody = document.getElementById('requestsTableBody');
    const emptyState = document.getElementById('requestsEmptyState');
    if (!tbody || !emptyState) return;

    const filtered = currentRequestFilter === 'all' 
        ? allRequests 
        : allRequests.filter(r => r.status === currentRequestFilter);

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    tbody.innerHTML = filtered.map(req => {
        const actions = req.status === 'pending' 
            ? `
                <div class="action-buttons">
                    <button class="req-action-btn approve" onclick="openReviewModal(${req.id}, 'approved')">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button class="req-action-btn deny" onclick="openReviewModal(${req.id}, 'denied')">
                        <i class="fas fa-times"></i> Deny
                    </button>
                </div>
            `
            : `<span class="status-badge ${req.status}">${req.status}</span>`;

        return `
            <tr>
                <td><strong>#${req.id}</strong></td>
                <td>${req.materialName}</td>
                <td>${req.requesterEmail}</td>
                <td>${req.quantity} ${req.materialUnit}</td>
                <td>${req.reason || '-'}</td>
                <td><span class="status-badge ${req.status}">${req.status}</span></td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');
}

window.openReviewModal = function(id, action) {
    const req = allRequests.find(r => r.id === id);
    if (!req) return;

    currentActionRequestId = id;
    currentActionType = action;

    const modal = document.getElementById('reviewRequestModal');
    document.getElementById('reviewModalMaterial').textContent = req.materialName;
    document.getElementById('reviewModalQty').textContent = `${req.quantity} ${req.materialUnit}`;
    document.getElementById('reviewModalRequester').textContent = req.requesterEmail;
    document.getElementById('reviewModalReason').textContent = req.reason || '-';
    document.getElementById('reviewModalNotes').value = '';

    const confirmBtn = document.getElementById('confirmReviewBtn');
    if (confirmBtn) {
        confirmBtn.textContent = action === 'approved' ? 'Approve Request' : 'Deny Request';
        confirmBtn.style.background = action === 'approved' ? '#10B981' : '#EF4444';
    }

    if (modal) modal.classList.add('active');
};

window.closeReviewModal = function() {
    const modal = document.getElementById('reviewRequestModal');
    if (modal) modal.classList.remove('active');
};

async function handleReviewAction() {
    if (!currentActionRequestId || !currentActionType) return;

    const notes = document.getElementById('reviewModalNotes').value;
    const btn = document.getElementById('confirmReviewBtn');
    const actionLabel = currentActionType === 'approved' ? 'Approve Request' : 'Deny Request';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }

    try {
        if (currentActionType === 'approved') {
            await dataManager.approveMaterialRequest(currentActionRequestId, notes);
            await dataManager.loadMaterials();
            const activePage = document.querySelector('.page.active-page');
            if (activePage?.id === 'dashboardPage') renderDashboard();
        } else {
            await dataManager.denyMaterialRequest(currentActionRequestId, notes);
        }

        const successMsg = currentActionType === 'approved'
            ? 'Request approved. Stock has been deducted and logged as OUT.'
            : 'Request denied successfully.';
        showNotification('Success', successMsg, 'success');
        closeReviewModal();
        await loadRequestsPage();
    } catch (e) {
        console.error('Action failed:', e);
        const msg = (e && e.message) ? e.message : 'Failed to update request status.';
        const isStockError = /insufficient stock/i.test(msg);
        showNotification(
            isStockError ? 'Insufficient Stock' : 'Error',
            msg,
            'error'
        );
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = actionLabel;
        }
    }
}

//======================AI INSIGHTS Widget ======================
function formatDeadstockPeriod(item) {
    const days = item.days_inactive ?? item.threshold_days ?? 0;
    return `${days} day${days !== 1 ? 's' : ''}`;
}

const AI_INSIGHTS_INITIAL_VISIBLE = 3;

function buildInsightActionLink(label, variant) {
    const mod = variant === 'deadstock' ? 'ai-insight-footer-link--deadstock' : 'ai-insight-footer-link--prediction';
    return `
        <button type="button" class="ai-insight-footer-link ${mod}" data-nav="ai-insights">
            <span class="ai-insight-footer-label">${escapeHtml(label)}</span>
            <span class="ai-insight-footer-arrow" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </span>
        </button>`;
}

function buildPredictionInsightDescription(item) {
    const sku = item.sku || `SKU-${String(item.material_id).padStart(4, '0')}`;
    const name = item.product_name || item.material_name || 'Unknown material';
    const pctNum = Number(item.change_pct) || 0;
    const pct = pctNum.toFixed(1);
    if (item.status === 'decreasing') {
        return `Demand for ${sku} (${name}) has decreased by ${Math.abs(pctNum).toFixed(1)}% compared to prior averages.`;
    }
    if (item.status === 'stable') {
        return `Demand for ${sku} (${name}) remains stable compared to prior averages.`;
    }
    return `Demand for ${sku} (${name}) has increased by ${pct}% compared to prior averages.`;
}

function buildPredictionInsightCard(item) {
    const description = buildPredictionInsightDescription(item);
    return `
        <article class="ai-insight-card prediction" data-insight-type="prediction" data-material-id="${item.material_id}">
            <div class="ai-insight-title-row">
                <span class="ai-insight-type" style="color:#10B981;">DEMAND PREDICTION</span>
                <span class="ai-insight-badge" style="border-radius:999px;background:#10B981;color:#fff;border:none;padding:0.25rem 0.75rem;">OPPORTUNITY</span>
            </div>
            <p class="ai-insight-description">${escapeHtml(description)}</p>
            ${buildInsightActionLink('Have a look', 'prediction')}
        </article>`;
}

function buildDeadstockInsightCard(item) {
    const sku = item.sku || `SKU-${String(item.material_id).padStart(4, '0')}`;
    const period = formatDeadstockPeriod(item);
    const description = `${sku} (${item.material_name}) has zero movement for ${period}.`;
    return `
        <article class="ai-insight-card dead-stock" data-insight-type="deadstock" data-material-id="${item.material_id}">
            <div class="ai-insight-title-row">
                <span class="ai-insight-type" style="color:#EF4444;">DEAD STOCK WARNING</span>
                <span class="ai-insight-badge" style="border-radius:999px;background:#EF4444;color:#fff;border:none;padding:0.25rem 0.75rem;">LOSS RISK</span>
            </div>
            <p class="ai-insight-description">${escapeHtml(description)}</p>
            ${buildInsightActionLink('Take action', 'deadstock')}
        </article>`;
}

function collectInsightCardEntries(deadstock, predictions) {
    const increasingPredictions = (predictions || []).filter(item => item.status === 'increasing');
    const entries = [];
    increasingPredictions.forEach(item => entries.push({ kind: 'prediction', item }));
    (deadstock || []).forEach(item => entries.push({ kind: 'deadstock', item }));
    return entries;
}

function insightCardHtmlForEntry(entry) {
    return entry.kind === 'deadstock'
        ? buildDeadstockInsightCard(entry.item)
        : buildPredictionInsightCard(entry.item);
}

function navigateToPage(page) {
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.click();
}

function attachAIInsightCardActions(container) {
    if (!container) return;
    container.querySelectorAll('.ai-insight-footer-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToPage(link.dataset.nav || 'ai-insights');
            if ((link.dataset.nav || 'ai-insights') === 'ai-insights') {
                setTimeout(() => fetchAndRenderAIInsights(), 120);
            }
        });
    });
}

function setupAIInsightsShowMore(container) {
    if (!container) return;
    const btn = container.querySelector('.ai-insights-show-more');
    const overflow = container.querySelector('.ai-insights-cards-overflow');
    if (!btn || !overflow) return;

    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            overflow.hidden = true;
            overflow.style.display = 'none';
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('is-expanded');
            const remaining = overflow.querySelectorAll('.ai-insight-card').length;
            btn.querySelector('.ai-insights-show-more-label').textContent = `Show ${remaining} more`;
        } else {
            overflow.hidden = false;
            overflow.style.display = 'flex';
            overflow.style.flexDirection = 'column';
            overflow.style.gap = '0.75rem';
            btn.setAttribute('aria-expanded', 'true');
            btn.classList.add('is-expanded');
            btn.querySelector('.ai-insights-show-more-label').textContent = 'Show less';
        }
    });
}

function animateStatCardBars(containerId, values, color) {
    const container = document.getElementById(containerId);
    if (!container || !values?.length) return;
    container.innerHTML = values.map((v, i) => {
        const h = Math.max(10, Math.min(100, Number(v) || 10));
        const isLast = i === values.length - 1;
        return `<div class="stat-card-chart-bar" style="height:${h}%;background:${color};opacity:${isLast ? 1 : 0.35};transition:height 0.65s cubic-bezier(.4,0,.2,1);"></div>`;
    }).join('');
}

function percentMicroBars(pct, count = 5) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    return Array.from({ length: count }, (_, i) =>
        Math.max(8, Math.min(100, ((i + 1) / count) * p))
    );
}

function resolveDeadstockAction(item) {
    if (item.action_badge) return item.action_badge;
    const days = item.days_inactive || 0;
    const thresh = item.threshold_days || 30;
    return days >= thresh * 1.5 ? 'LIQUIDATE' : 'RELOCATE';
}

function renderDeadStockAlertTable(deadstock) {
    const tbody = document.getElementById('aiDeadStockTableBody');
    const countEl = document.getElementById('aiDeadStockCount');
    if (!tbody) return;

    const items = Array.isArray(deadstock) ? deadstock : [];
    if (countEl) countEl.textContent = String(items.length);

    if (!items.length) {
        tbody.innerHTML = `
            <tr class="ai-deadstock-empty-row">
                <td colspan="4">No stagnant SKUs detected</td>
            </tr>`;
        return;
    }

    const sorted = [...items].sort((a, b) => (b.days_inactive || 0) - (a.days_inactive || 0));
    tbody.innerHTML = sorted.map(item => {
        const sku = escapeHtml(item.sku || `SKU-${String(item.material_id).padStart(4, '0')}`);
        const name = escapeHtml(item.material_name || '—');
        const days = Number(item.days_inactive) || 0;
        const action = resolveDeadstockAction(item);
        const badgeClass = action === 'LIQUIDATE' ? 'badge-danger' : 'badge-warning';
        return `
            <tr data-material-id="${item.material_id}">
                <td class="ai-deadstock-sku">${sku}</td>
                <td class="ai-deadstock-name" title="${name}">${name}</td>
                <td class="ai-deadstock-days">${days}d</td>
                <td><span class="badge ${badgeClass}">${action}</span></td>
            </tr>`;
    }).join('');
}

function formatCurrencyK(value) {
    const n = Number(value) || 0;
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + n.toFixed(0);
}

function formatEGPCompact(value) {
    const n = Number(value) || 0;
    if (n >= 1000) return 'EGP ' + (n / 1000).toFixed(1) + 'k';
    return 'EGP ' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMaterialCost(material) {
    const price = Number(material.costPrice) || 0;
    const cur = material.currency || 'EGP';
    const method = material.costingMethod === 'FIFO' ? 'FIFO' : 'Moving Avg';
    return `${price.toFixed(2)} ${cur} · ${method}`;
}

function renderAIInsightsKPIs(metrics) {
    if (!metrics) return;

    const throughputEl = document.getElementById('aiStatThroughput');
    const throughputBadge = document.getElementById('aiStatThroughputBadge');
    if (throughputEl) {
        throughputEl.textContent = Math.round(metrics.predicted_throughput || 0).toLocaleString();
    }
    if (throughputBadge) {
        const trend = metrics.throughput_trend_pct || 0;
        throughputBadge.textContent = (trend >= 0 ? '+' : '') + trend.toFixed(1) + '%';
        throughputBadge.className = 'stat-card-badge ' + (trend >= 0 ? 'success' : 'warning');
    }
    animateStatCardBars('aiStatThroughputBars', metrics.throughput_sparkline, 'var(--burnt-orange)');

    const stockoutEl = document.getElementById('aiStatStockoutRisk');
    const stockoutUnitEl = document.getElementById('aiStatStockoutUnit');
    const stockoutBadgeEl = document.getElementById('aiStatStockoutBadge');
    const risk = metrics.est_stockout_risk || 0;
    const critical = metrics.critical_sku_count || 0;
    if (stockoutEl) stockoutEl.textContent = risk.toFixed(1) + '%';
    if (stockoutUnitEl) {
        stockoutUnitEl.textContent = `${critical} critical SKU${critical !== 1 ? 's' : ''}`;
    }
    if (stockoutBadgeEl) {
        if (critical > 0) {
            stockoutBadgeEl.className = 'stat-card-badge warning';
            stockoutBadgeEl.textContent = 'WARNING';
        } else {
            stockoutBadgeEl.className = 'stat-card-badge success';
            stockoutBadgeEl.textContent = 'OPTIMAL';
        }
    }
    const stockoutBarPct = metrics.stockout_bar_pct ?? risk;
    animateStatCardBars('aiStatStockoutBars', percentMicroBars(stockoutBarPct), 'var(--warning-yellow)');

    const deadValEl = document.getElementById('aiStatDeadStockValue');
    const deadBadgeEl = document.getElementById('aiStatDeadStockBadge');
    const deadBreakdownEl = document.getElementById('aiStatDeadStockBreakdown');
    const deadVal = metrics.dead_stock_value_egp ?? (metrics.dead_stock_value || 0);
    if (deadValEl) deadValEl.textContent = formatEGPCompact(deadVal);
    if (deadBreakdownEl) {
        const breakdown = metrics.dead_stock_value_breakdown || '';
        deadBreakdownEl.textContent = breakdown;
        deadBreakdownEl.hidden = !breakdown;
    }
    if (deadBadgeEl) {
        const tier = metrics.dead_stock_tier || 'NONE';
        deadBadgeEl.textContent = tier;
        deadBadgeEl.className = 'stat-card-badge ' + (
            tier === 'HIGH' ? 'danger' : tier === 'MEDIUM' ? 'warning' : 'success'
        );
    }
    const deadBarPct = metrics.dead_stock_bar_pct
        ?? Math.min(100, (deadVal / 15000) * 100);
    animateStatCardBars('aiStatDeadStockBars', percentMicroBars(deadBarPct), 'var(--error-red)');

    const accuracyEl = document.getElementById('aiStatAccuracy');
    const accuracyBadge = document.getElementById('aiStatAccuracyBadge');
    const acc = metrics.ai_accuracy_rate || 0;
    if (accuracyEl) accuracyEl.textContent = acc.toFixed(1) + '%';
    if (accuracyBadge) {
        accuracyBadge.textContent = metrics.accuracy_tier || 'CALIBRATING';
        accuracyBadge.className = 'stat-card-badge info';
    }
    const accuracyBarPct = metrics.accuracy_bar_pct ?? acc;
    animateStatCardBars('aiStatAccuracyBars', percentMicroBars(accuracyBarPct), 'var(--burnt-orange)');
}

let _aiChartMode = 'forecast';
let _aiChartsPayload = null;

function _chartCoords(points, width, height, pad) {
    const vals = points.map(p => Number(p.value) || 0);
    const maxVal = Math.max(...vals, 1);
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    return points.map((p, i) => ({
        ...p,
        x: pad + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
        y: pad + innerH - ((Number(p.value) || 0) / maxVal) * innerH,
    }));
}

function _pathFromCoords(coords) {
    if (!coords.length) return '';
    return coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
}

function updateAIChartPeakTooltip(peak, title) {
    const peakTitle = document.getElementById('aiChartPeakTitle');
    const peakItem = document.getElementById('aiChartPeakItem');
    const peakDate = document.getElementById('aiChartPeakDate');
    const peakCapacity = document.getElementById('aiChartPeakCapacity');
    const peakTooltip = document.getElementById('aiChartPeakTooltip');
    if (!peak || !peakTooltip) return;
    if (peakTitle) peakTitle.textContent = title;
    if (peakItem) {
        const skuPart = peak.sku ? peak.sku + ' · ' : '';
        peakItem.textContent = 'Item: ' + skuPart + (peak.material_name || '—');
    }
    if (peakDate) peakDate.textContent = 'Peak date: ' + (peak.peak_date || '—');
    if (peakCapacity) {
        peakCapacity.textContent = 'Required capacity: ' + (peak.required_capacity ?? '—') + ' units';
    }
    peakTooltip.style.display = 'block';
}

function renderAIDemandChart(mode, charts) {
    const svg = document.getElementById('aiDemandChartSvg');
    const container = document.getElementById('aiChartContainer');
    const hoverTip = document.getElementById('aiChartHoverTooltip');
    if (!svg || !charts) return;

    const dataset = mode === 'seasonality' ? charts.seasonality_trend : charts.demand_forecast;
    if (!dataset?.points?.length) {
        svg.innerHTML = '';
        return;
    }

    const W = 800;
    const H = 260;
    const pad = 28;
    const mainCoords = _chartCoords(dataset.points, W, H, pad);
    const baselinePts = dataset.baseline?.length ? dataset.baseline : [];
    const baselineCoords = baselinePts.length
        ? _chartCoords(baselinePts, W, H, pad)
        : [];

    const mainPath = _pathFromCoords(mainCoords);
    const basePath = baselineCoords.length ? _pathFromCoords(baselineCoords) : '';
    const areaPath = mainPath
        ? `${mainPath} L${mainCoords[mainCoords.length - 1].x},${H - pad} L${mainCoords[0].x},${H - pad} Z`
        : '';

    const markers = mainCoords.map((c, i) =>
        `<circle class="ai-chart-marker" data-idx="${i}" cx="${c.x}" cy="${c.y}" r="6" fill="var(--burnt-orange)" stroke="#fff" stroke-width="2" style="cursor:pointer;opacity:${i === mainCoords.length - 1 ? 1 : 0.85};"/>`
    ).join('');

    svg.innerHTML = `
        ${areaPath ? `<path d="${areaPath}" fill="var(--burnt-orange)" opacity="0.08" stroke="none"/>` : ''}
        ${basePath ? `<path d="${basePath}" fill="none" stroke="var(--dark-wood-secondary)" stroke-width="2" stroke-dasharray="6 6" opacity="0.65"/>` : ''}
        <path d="${mainPath}" fill="none" stroke="var(--burnt-orange)" stroke-width="3"/>
        ${markers}
    `;

    const title = mode === 'seasonality' ? 'Seasonality Peak' : 'Peak Demand Predicted';
    updateAIChartPeakTooltip(dataset.peak, title);

    const peakIdx = mainCoords.length
        ? mainCoords.reduce((best, c, i) => (
            (Number(c.value) || 0) > (Number(mainCoords[best]?.value) || 0) ? i : best
        ), 0)
        : -1;

    if (hoverTip && container) {
        svg.querySelectorAll('.ai-chart-marker').forEach(marker => {
            marker.addEventListener('mouseenter', () => {
                const idx = parseInt(marker.dataset.idx, 10);
                const pt = mainCoords[idx];
                if (!pt) return;
                const peak = dataset.peak || {};
                const atPeak = idx === peakIdx;
                const sku = atPeak && peak.sku ? peak.sku : (peak.sku || 'PORTFOLIO');
                const itemName = atPeak && peak.material_name
                    ? peak.material_name
                    : (peak.material_name || 'Portfolio aggregate');
                hoverTip.style.display = 'block';
                hoverTip.innerHTML = `<strong style="color:var(--burnt-orange);">${escapeHtml(pt.label)}</strong><br/>
                    SKU: ${escapeHtml(sku)}<br/>
                    ${escapeHtml(itemName)}<br/>
                    Date: ${escapeHtml(pt.date || '—')}<br/>
                    Capacity: ${Number(pt.value).toLocaleString()} units`;
                const rect = container.getBoundingClientRect();
                const svgRect = svg.getBoundingClientRect();
                const relX = ((pt.x / W) * svgRect.width);
                const relY = ((pt.y / H) * svgRect.height);
                hoverTip.style.left = Math.min(rect.width - 200, Math.max(8, relX)) + 'px';
                hoverTip.style.top = Math.max(8, relY - 10) + 'px';
            });
            marker.addEventListener('mouseleave', () => { hoverTip.style.display = 'none'; });
        });
    }
}

function setupAIChartTabs(charts) {
    const forecastTab = document.getElementById('aiForecastTab');
    const seasonalityTab = document.getElementById('aiSeasonalityTab');
    if (!forecastTab || !seasonalityTab) return;

    const activate = (mode) => {
        _aiChartMode = mode;
        forecastTab.classList.toggle('active', mode === 'forecast');
        seasonalityTab.classList.toggle('active', mode === 'seasonality');
        renderAIDemandChart(mode, charts);
    };

    if (!forecastTab.dataset.listener) {
        forecastTab.dataset.listener = 'true';
        forecastTab.addEventListener('click', () => activate('forecast'));
        seasonalityTab.addEventListener('click', () => activate('seasonality'));
    }
    activate(_aiChartMode);
}

function renderAIInsightsCards(container, deadstock, predictions) {
    if (!container) return;
    const entries = collectInsightCardEntries(deadstock, predictions);
    if (!entries.length) {
        container.innerHTML = `
            <div class="ai-insights-empty">
                <i class="fas fa-satellite-dish"></i>
                <p>No insights available at this time.</p>
            </div>`;
        return;
    }

    const visible = entries.slice(0, AI_INSIGHTS_INITIAL_VISIBLE);
    const overflow = entries.slice(AI_INSIGHTS_INITIAL_VISIBLE);

    let html = '<div class="ai-insights-cards-visible">';
    visible.forEach(entry => { html += insightCardHtmlForEntry(entry); });
    html += '</div>';

    if (overflow.length) {
        html += '<div class="ai-insights-cards-overflow" hidden style="display:none;">';
        overflow.forEach(entry => { html += insightCardHtmlForEntry(entry); });
        html += '</div>';
        html += `
            <button type="button" class="ai-insights-show-more" aria-expanded="false">
                <span class="ai-insights-show-more-label">Show ${overflow.length} more</span>
                <span class="ai-insights-show-more-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </button>`;
    }

    container.innerHTML = html;
    attachAIInsightCardActions(container);
    setupAIInsightsShowMore(container);
}

let _aiInsightsCache = null;

function applyAIInsightsPayload(data) {
    const listContainer = document.getElementById('aiInsightsList');
    const aiPage = document.getElementById('ai-insightsPage');
    if (!data) return;

    const deadStock = data.deadstock || data.dead_stock || [];
    const predictions = data.predictions || [];

    if (listContainer) {
        renderAIInsightsCards(listContainer, deadStock, predictions);
    }

    _aiChartsPayload = data.charts || null;

    if (aiPage) {
        renderAIInsightsKPIs(data.metrics);
        renderDeadStockAlertTable(deadStock);
        setupAIChartTabs(_aiChartsPayload);
    }
}

async function fetchAndRenderAIInsights() {
    const listContainer = document.getElementById('aiInsightsList');
    const aiPage = document.getElementById('ai-insightsPage');

    if (!listContainer && !aiPage) return;

    try {
        const data = await ApiService.getAIInsights();
        _aiInsightsCache = data;
        applyAIInsightsPayload(data);
    } catch (error) {
        const useCache = _aiInsightsCache && (
            (typeof ApiService !== 'undefined' && ApiService.isSessionExpiredError(error))
            || /401|unauthorized|session expired/i.test(error?.message || '')
        );
        if (useCache) {
            applyAIInsightsPayload(_aiInsightsCache);
            return;
        }
        console.error('Failed to fetch AI insights:', error);
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="ai-insights-empty">
                    <i class="fas fa-exclamation-triangle" style="color: var(--error-red);"></i>
                    <p>Failed to load insights</p>
                </div>
            `;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
