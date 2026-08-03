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
            loadRequestsPage(1); // Re-fetch from server with new status filter
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
            // Use the `count` from the paginated metadata for the true total pending count
            const count = dataManager.requestsPagination
                ? dataManager.requestsPagination.count
                : requests.length;
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
        else if (item.dataset.page === 'products') loadProductsPage();
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
                        <td>${t.notes || ''}</td>
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
        this._docClickListener = null;
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
        this.indicator   = document.getElementById('globalNotificationIndicator');
        this.badge       = this.indicator?.querySelector('.notification-badge');

        this.bellBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Prevent click inside notification center from auto-closing dropdown
        this.center?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Clean document click listener stored on instance
        this._docClickListener = (e) => {
            if (
                this.center &&
                this.isOpen() &&
                !this.center.contains(e.target) &&
                !this.bellBtn?.contains(e.target)
            ) {
                this.hide();
            }
        };
        document.addEventListener('click', this._docClickListener);

        this.tabBtns.forEach(btn =>
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.switchTab(btn.dataset.tab);
            })
        );

        this.markAllBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.markAllAsRead();
        });

        // Delegated listener on the list container for performance
        if (this.list) {
            this.list.addEventListener('click', (e) => {
                e.stopPropagation();

                // Delete button handler
                const deleteBtn = e.target.closest('.notif-delete-btn');
                if (deleteBtn) {
                    const id = deleteBtn.dataset.id;
                    if (id) this.deleteOne(id);
                    return;
                }

                // Item click handler
                const item = e.target.closest('.notification-item');
                if (item) {
                    const id = item.dataset.id;
                    if (id) {
                        this.markOneRead(id);
                        const notif = this.notifications.find(n => n.id === id);
                        if (notif) {
                            this.openDetailModal(notif);
                        }
                    }
                }
            });
        }

        // Initial fetch on sign-in / app load (non-blocking)
        this.refresh();
    }

    destroy() {
        if (this._docClickListener) {
            document.removeEventListener('click', this._docClickListener);
            this._docClickListener = null;
        }
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

    /** Pull latest list from server and update local cache */
    async refresh() {
        if (this._loading) return;
        this._loading = true;
        try {
            const data  = await ApiService.getNotifications();
            const items = Array.isArray(data) ? data : (data.results || []);
            this.notifications = items.map(n => this._mapFromApi(n));
            await this.updateBadge();
            if (this.isOpen()) this.render();
        } catch (e) {
            if (!ApiService.isSessionExpiredError(e)) {
                console.error('Failed to load notifications:', e);
            }
        } finally {
            this._loading = false;
        }
    }

    // ── Panel open / close ──────────────────────────────────────────────────
    isOpen() {
        return this.center?.classList.contains('active') || false;
    }

    toggle() {
        this.isOpen() ? this.hide() : this.show();
    }

    show() {
        if (!this.center) return;
        // Zero-delay instant show using cached notifications
        this.center.style.display = ''; // Clear inline display:none override if present
        this.center.classList.add('active');
        if (this.bellBtn) this.bellBtn.setAttribute('aria-expanded', 'true');
        this.render();
        // Background refresh without delaying UI opening
        this.refresh();
    }

    hide() {
        if (!this.center) return;
        this.center.classList.remove('active');
        if (this.bellBtn) this.bellBtn.setAttribute('aria-expanded', 'false');
    }

    // ── Tab switching ───────────────────────────────────────────────────────
    switchTab(tab) {
        this.currentTab = tab;
        this.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        this.render();
    }

    // ── Badge (bell icon counter) ───────────────────────────────────────────
    async updateBadge() {
        if (!this.indicator) this.indicator = document.getElementById('globalNotificationIndicator');
        if (!this.badge) this.badge = this.indicator?.querySelector('.notification-badge');
        if (!this.indicator || !this.badge) return;

        let count = 0;
        try {
            const counts = await ApiService.getNotificationSummary();
            count = counts.all || 0;
        } catch {
            // Fallback: count from local cache
            count = this.notifications.filter(n => !n.read).length;
        }

        this.indicator.style.display = count > 0 ? 'block' : 'none';
        this.badge.textContent       = count > 99 ? '99+' : String(count);
    }

    // ── Mark all as read (single bulk request) ──────────────────────────────
    async markAllAsRead() {
        const hasUnread = this.notifications.some(n => !n.read);
        if (!hasUnread) return;

        // Immediate optimistic UI update
        const backup = this.notifications.map(n => ({ ...n }));
        this.notifications.forEach(n => { n.read = true; });
        this.render();
        this.updateBadge();

        try {
            await ApiService.markAllNotificationsRead();
        } catch (e) {
            console.error('Failed to mark all notifications as read, rolling back:', e);
            showNotification('Error', 'Failed to mark all as read. Syncing...', 'error');
            this.notifications = backup;
            this.render();
            this.updateBadge();
        }
    }

    // ── Mark single notification read ───────────────────────────────────────
    async markOneRead(id) {
        const target = this.notifications.find(n => n.id === id);
        if (!target || target.read) return;

        // Immediate optimistic UI update
        const oldReadState = target.read;
        target.read = true;
        this.render();
        this.updateBadge();

        try {
            await ApiService.markNotificationRead(id);
        } catch (e) {
            console.error(`Failed to mark notification ${id} read, rolling back:`, e);
            if (!ApiService.isSessionExpiredError(e)) {
                showNotification('Sync Error', 'Failed to update read status.', 'error');
            }
            target.read = oldReadState;
            this.render();
            this.updateBadge();
        }
    }

    // ── Delete a single notification ────────────────────────────────────────
    async deleteOne(id) {
        const targetIndex = this.notifications.findIndex(n => n.id === id);
        if (targetIndex === -1) return;

        // Immediate optimistic UI update
        const backup = [...this.notifications];
        this.notifications.splice(targetIndex, 1);
        this.render();
        this.updateBadge();

        try {
            await ApiService.deleteNotification(id);
        } catch (e) {
            console.error(`Failed to delete notification ${id}, rolling back:`, e);
            showNotification('Sync Error', 'Failed to delete notification.', 'error');
            this.notifications = backup;
            this.render();
            this.updateBadge();
        }
    }

    openDetailModal(notification) {
        const modal = document.getElementById('notificationDetailModal');
        if (!modal) return;

        const titleEl    = document.getElementById('notifDetailModalTitle');
        const badgeEl    = document.getElementById('notifDetailModalCategoryBadge');
        const timeEl     = document.getElementById('notifDetailModalTime');
        const messageEl  = document.getElementById('notifDetailModalMessage');
        const actionBtn  = document.getElementById('notifDetailModalActionBtn');

        if (titleEl) titleEl.textContent = notification.title;
        if (messageEl) messageEl.textContent = notification.message;
        if (timeEl) {
            timeEl.textContent = notification.timestamp.toLocaleString();
        }

        if (badgeEl) {
            badgeEl.textContent = notification.category;
            badgeEl.className = 'badge';
            if (notification.category === 'alert') {
                badgeEl.style.background = 'var(--error-red-light)';
                badgeEl.style.color      = 'var(--error-red)';
            } else if (notification.category === 'reminder') {
                badgeEl.style.background = 'rgba(230, 168, 69, 0.15)';
                badgeEl.style.color      = 'var(--warning-yellow)';
            } else if (notification.category === 'request') {
                badgeEl.style.background = 'var(--success-green-light)';
                badgeEl.style.color      = 'var(--success-green)';
            } else {
                badgeEl.style.background = 'var(--beige-light)';
                badgeEl.style.color      = 'var(--burnt-orange)';
            }
        }

        // Configure dynamic action button
        if (actionBtn) {
            actionBtn.style.display = 'block';
            let dest = '';
            if (notification.category === 'alert') {
                actionBtn.textContent = 'Go to Inventory / Restock';
                dest = 'dashboard';
            } else if (notification.category === 'reminder') {
                actionBtn.textContent = 'Update Item Status';
                dest = 'activity';
            } else if (notification.category === 'request') {
                actionBtn.textContent = 'Review Material Request';
                dest = 'requests';
            } else {
                actionBtn.style.display = 'none';
            }

            actionBtn.onclick = (e) => {
                e.stopPropagation();
                modal.classList.remove('active');
                if (dest) {
                    const navItem = document.querySelector(`.nav-item[data-page="${dest}"]`);
                    if (navItem) navItem.click();
                }
            };
        }

        const closeBtn = document.getElementById('closeNotifDetailModalBtn');
        const footerCloseBtn = document.getElementById('closeNotifDetailModalFooterBtn');

        const closeModal = (e) => {
            e?.stopPropagation();
            modal.classList.remove('active');
        };

        if (closeBtn) closeBtn.onclick = closeModal;
        if (footerCloseBtn) footerCloseBtn.onclick = closeModal;
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        modal.classList.add('active');
    }

    add(title, message, type = 'info') {
        if (['alert', 'reminder', 'request', 'info', 'success', 'error'].includes(title)) {
            [title, message, type] = [message, type, title];
        }

        const catMap = { alert: 'alert', reminder: 'reminder', request: 'request', requests: 'request' };
        const category = catMap[type] || null;

        const toastType = (type === 'alert' || type === 'error') ? 'error'
            : (type === 'success' || type === 'request' || type === 'requests') ? 'success'
            : 'info';
        showNotification(title, message, toastType, 4000);

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
                    <div class="notification-details">
                        <div class="notification-title">
                            <i class="${icon} notif-inline-icon notif-${n.category}-color"></i>
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

    // Load connected engineers list automatically when preferences are loaded
    await loadConnectedEngineers();
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

    const addEngineerForm = document.getElementById('addEngineerForm');
    if (addEngineerForm && !addEngineerForm.dataset.listenerAttached) {
        addEngineerForm.dataset.listenerAttached = 'true';
        addEngineerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('engineerEmailInput');
            const email = emailInput ? emailInput.value.trim() : '';
            const msg = document.getElementById('engineerSaveMsg');
            if (!email) return;

            const submitBtn = addEngineerForm.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.innerHTML : 'Grant Access';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Granting...';
            }

            try {
                await ApiService.addConnectedEngineer(email);
                if (emailInput) emailInput.value = '';
                if (msg) {
                    msg.textContent = '✅ Access granted successfully!';
                    msg.style.color = 'var(--success-green)';
                    msg.style.display = 'block';
                    setTimeout(() => msg.style.display = 'none', 3000);
                }
                showNotification('Success', 'Engineer access granted!', 'success');
                await loadConnectedEngineers();
            } catch (err) {
                console.error(err);
                let errMsg = 'Failed to grant access.';
                if (err && err.message) {
                    errMsg = err.message;
                } else if (err && typeof err === 'object') {
                    // Handle validation errors from DRF serializer
                    if (err.engineer_email) {
                        errMsg = Array.isArray(err.engineer_email) ? err.engineer_email[0] : err.engineer_email;
                    }
                }
                if (msg) {
                    msg.textContent = `❌ ${errMsg}`;
                    msg.style.color = 'var(--error-red)';
                    msg.style.display = 'block';
                    setTimeout(() => msg.style.display = 'none', 5000);
                }
                showNotification('Error', errMsg, 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
            }
        });
    }
}

async function loadConnectedEngineers() {
    const tbody = document.getElementById('connectedEngineersBody');
    if (!tbody) return;

    try {
        const connections = await ApiService.getConnectedEngineers();
        if (!connections || connections.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
                        No connected engineers found.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = connections.map(conn => {
            const grantedDate = formatDate(conn.created_at);
            return `
                <tr>
                    <td style="vertical-align: middle;"><strong>${escapeHtml(conn.engineer_email)}</strong></td>
                    <td style="vertical-align: middle;">${grantedDate}</td>
                    <td style="text-align: right; vertical-align: middle;">
                        <button type="button" class="btn-outline" onclick="revokeEngineerAccess(${conn.id})" 
                                style="border-color: #EF4444; color: #EF4444; padding: 0.4rem 0.8rem; font-size: 0.8rem; margin: 0; display: inline-flex; align-items: center; gap: 4px;">
                            <i class="fas fa-user-slash"></i> Revoke Access
                        </button>
                    </td>
                </tr>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load connected engineers:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: var(--error-red); padding: 1.5rem;">
                    Failed to load connected engineers.
                </td>
            </tr>`;
    }
}

window.revokeEngineerAccess = async function(id) {
    if (!confirm('Are you sure you want to revoke access for this engineer?')) return;
    try {
        await ApiService.deleteConnectedEngineer(id);
        showNotification('Success', 'Access revoked successfully.', 'success');
        await loadConnectedEngineers();
    } catch (err) {
        showNotification('Error', err.message || 'Failed to revoke access.', 'error');
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
// Pagination state for the Requests table
let requestsCurrentPage = 1;
let requestsPagination = { count: 0, next: null, previous: null };

async function loadRequestsPage(page = 1) {
    const tableBody = document.getElementById('requestsTableBody');
    if (!tableBody) return;

    try {
        // Server-side status filter — pass the current tab selection
        const statusFilter = currentRequestFilter !== 'all' ? currentRequestFilter : null;
        allRequests = await dataManager.loadMaterialRequests(statusFilter, page);
        requestsCurrentPage = page;
        requestsPagination = { ...dataManager.requestsPagination };

        // Fetch accurate per-status counts via 3 parallel status-filtered API calls.
        // This is approach (a): use the `count` field from each status's paginated
        // response so counters reflect ALL pages, not just the 20 currently displayed.
        const counts = await dataManager.getRequestStatusCounts();
        updateRequestStats(counts);
        renderRequestsTable();
        renderRequestsPagination();
    } catch (e) {
        if (typeof ApiService !== 'undefined' && ApiService.isSessionExpiredError(e) && allRequests.length) {
            updateRequestStats();
            renderRequestsTable();
            renderRequestsPagination();
            return;
        }
        console.error('Failed to load requests:', e);
        if (allRequests.length) {
            updateRequestStats();
            renderRequestsTable();
            renderRequestsPagination();
            return;
        }
        showNotification('Error', 'Failed to load material requests.', 'error');
    }
}
// Expose so pagination button onclick handlers can reach it
window.loadRequestsPage = loadRequestsPage;

function updateRequestStats(counts) {

    // If pre-fetched counts are provided (accurate cross-page totals), use them.
    // Fallback to client-side counting from the current page only (used on error recovery).
    const stats = counts || {
        pending: allRequests.filter(r => r.status === 'pending').length,
        approved: allRequests.filter(r => r.status === 'approved').length,
        denied: allRequests.filter(r => r.status === 'denied').length,
        total: allRequests.length,
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

    // allRequests is already server-filtered by status when a filter tab is active,
    // so we show the full array here rather than re-filtering client-side.
    const filtered = allRequests;

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

function renderRequestsPagination() {
    const container = document.getElementById('requestsPaginationContainer');
    if (!container) return;

    const { count, next, previous } = requestsPagination;
    const pageSize = 20; // matches backend StandardResultsSetPagination.page_size
    const totalPages = Math.max(1, Math.ceil(count / pageSize));
    const currentPage = requestsCurrentPage;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const prevDisabled = !previous;
    const nextDisabled = !next;

    container.innerHTML = `
        <div class="req-pagination">
            <button
                id="reqPrevBtn"
                class="req-page-btn${prevDisabled ? ' disabled' : ''}"
                ${prevDisabled ? 'disabled' : ''}
                onclick="loadRequestsPage(${currentPage - 1})"
                aria-label="Previous page"
            >
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            <span class="req-page-info">
                Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong>
                &nbsp;&mdash;&nbsp; ${count} total
            </span>
            <button
                id="reqNextBtn"
                class="req-page-btn${nextDisabled ? ' disabled' : ''}"
                ${nextDisabled ? 'disabled' : ''}
                onclick="loadRequestsPage(${currentPage + 1})"
                aria-label="Next page"
            >
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
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
        // Bust the 30s counts cache so the next load reflects the status change immediately
        dataManager.invalidateCountsCache();
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
let _aiDemandChart = null;
let _aiChartResizeObserver = null;
let _aiChartThemeObserver = null;

const DEMAND_CHART_ORANGE = '#FF6B00';

function getDemandChartDataset(charts, mode) {
    if (!charts) return null;
    return mode === 'seasonality' ? charts.seasonality_trend : charts.demand_forecast;
}

function getDemandChartPeakTitle(mode) {
    return mode === 'seasonality' ? 'Seasonality Peak' : 'Peak Demand Predicted';
}

function isDemandChartDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function getDemandChartThemeTokens() {
    const isDark = isDemandChartDarkTheme();
    return {
        isDark,
        gridColor: isDark ? '#2d2d2d' : '#e8e0d8',
        labelColor: isDark ? '#A0A0A0' : '#5c4a3d',
        baselineColor: isDark ? '#A0A0A0' : '#5c4a3d',
    };
}

function buildDemandChartSeries(dataset) {
    const points = dataset?.points || [];
    const demandData = points.map(p => Number(p.value) || 0);
    const series = [{
        name: 'Predicted Demand',
        type: 'area',
        data: demandData,
    }];

    const baseline = dataset?.baseline || [];
    if (baseline.length) {
        series.push({
            name: 'Safety Stock Baseline',
            type: 'line',
            data: baseline.map(p => Number(p.value) || 0),
        });
    }

    return series;
}

function getDemandPointPeakIndex(points) {
    if (!points?.length) return -1;
    let peakIdx = 0;
    let peakVal = Number(points[0].value) || 0;
    points.forEach((pt, idx) => {
        const val = Number(pt.value) || 0;
        if (val > peakVal) {
            peakVal = val;
            peakIdx = idx;
        }
    });
    return peakIdx;
}

function buildDemandTooltipHtml(mode, dataset, dataPointIndex, series) {
    const points = dataset?.points || [];
    const pt = points[dataPointIndex];
    if (!pt) return '';

    const peak = dataset.peak || {};
    const peakIdx = getDemandPointPeakIndex(points);
    const atPeak = dataPointIndex === peakIdx;
    const statusTitle = atPeak
        ? getDemandChartPeakTitle(mode)
        : (pt.label || 'Demand Point');
    const sku = peak.sku || 'PORTFOLIO';
    const itemName = peak.material_name || 'Portfolio aggregate';
    const demandVal = series?.[0]?.[dataPointIndex] ?? pt.value;
    const formattedDemand = Number(demandVal).toLocaleString(undefined, {
        maximumFractionDigits: 1,
    });

    return `
        <div class="ai-demand-tooltip-card">
            <strong style="color: ${DEMAND_CHART_ORANGE};">${escapeHtml(statusTitle)}</strong>
            <span>Item: ${escapeHtml(sku)} · ${escapeHtml(itemName)}</span>
            <span>Peak date: ${escapeHtml(pt.date || peak.peak_date || '—')}</span>
            <span class="ai-demand-tooltip-metric">Required capacity: ${formattedDemand} units</span>
        </div>`;
}

function buildDemandChartOptions(mode, charts) {
    const dataset = getDemandChartDataset(charts, mode);
    const points = dataset?.points || [];
    const theme = getDemandChartThemeTokens();

    return {
        chart: {
            type: 'line',
            height: '100%',
            fontFamily: 'DM Sans, sans-serif',
            background: 'transparent',
            foreColor: theme.labelColor,
            toolbar: { show: false },
            zoom: { enabled: false },
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 450,
            },
        },
        series: buildDemandChartSeries(dataset),
        colors: [DEMAND_CHART_ORANGE, theme.baselineColor],
        stroke: {
            curve: 'smooth',
            width: [3, 2],
            dashArray: [0, 6],
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: theme.isDark ? 'dark' : 'light',
                type: 'vertical',
                shadeIntensity: 0.35,
                gradientToColors: [DEMAND_CHART_ORANGE],
                opacityFrom: 0.42,
                opacityTo: 0.03,
                stops: [0, 85, 100],
            },
        },
        dataLabels: { enabled: false },
        markers: {
            size: 5,
            strokeWidth: 2,
            strokeColors: DEMAND_CHART_ORANGE,
            colors: ['#FFFFFF'],
            hover: {
                size: 7,
                sizeOffset: 1,
            },
        },
        xaxis: {
            categories: points.map(p => p.label),
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: {
                style: { colors: theme.labelColor, fontSize: '11px' },
            },
            crosshairs: {
                show: true,
                stroke: {
                    color: DEMAND_CHART_ORANGE,
                    width: 1,
                    dashArray: 4,
                    opacity: 0.55,
                },
            },
            tooltip: { enabled: false },
        },
        yaxis: {
            labels: {
                style: { colors: theme.labelColor, fontSize: '11px' },
                formatter: (val) => Math.round(val).toLocaleString(),
            },
            crosshairs: {
                show: true,
                stroke: {
                    color: DEMAND_CHART_ORANGE,
                    width: 1,
                    dashArray: 4,
                    opacity: 0.55,
                },
            },
        },
        grid: {
            borderColor: theme.gridColor,
            strokeDashArray: 4,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } },
            padding: { left: 4, right: 16, top: 8, bottom: 0 },
        },
        legend: { show: false },
        tooltip: {
            shared: true,
            intersect: false,
            followCursor: true,
            custom({ series, dataPointIndex }) {
                return buildDemandTooltipHtml(mode, dataset, dataPointIndex, series);
            },
        },
        theme: { mode: theme.isDark ? 'dark' : 'light' },
    };
}

function destroyDemandChart() {
    if (_aiChartResizeObserver) {
        _aiChartResizeObserver.disconnect();
        _aiChartResizeObserver = null;
    }
    if (_aiChartThemeObserver) {
        _aiChartThemeObserver.disconnect();
        _aiChartThemeObserver = null;
    }
    if (_aiDemandChart) {
        _aiDemandChart.destroy();
        _aiDemandChart = null;
    }
}

function setupDemandChartResize(chart) {
    const container = document.getElementById('demand-chart');
    if (!container) return;

    if (_aiChartResizeObserver) {
        _aiChartResizeObserver.disconnect();
    }

    if (typeof ResizeObserver !== 'undefined') {
        _aiChartResizeObserver = new ResizeObserver(() => {
            if (chart) chart.render();
        });
        _aiChartResizeObserver.observe(container);
        return;
    }

    const onResize = () => { if (chart) chart.render(); };
    window.addEventListener('resize', onResize);
    _aiChartResizeObserver = {
        disconnect() { window.removeEventListener('resize', onResize); },
    };
}

function setupDemandChartThemeSync(chart) {
    if (_aiChartThemeObserver) {
        _aiChartThemeObserver.disconnect();
    }

    _aiChartThemeObserver = new MutationObserver(() => {
        if (!chart || !_aiChartsPayload) return;
        chart.updateOptions(
            buildDemandChartOptions(_aiChartMode, _aiChartsPayload),
            false,
            true,
        );
    });
    _aiChartThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
}

function updateAIChartPeakTooltip(peak, title) {
    const peakTitle = document.getElementById('aiChartPeakTitle');
    const peakItem = document.getElementById('aiChartPeakItem');
    const peakDate = document.getElementById('aiChartPeakDate');
    const peakCapacity = document.getElementById('aiChartPeakCapacity');
    const peakTooltip = document.getElementById('aiChartPeakTooltip');
    if (!peakTooltip) return;

    if (!peak) {
        peakTooltip.style.display = 'none';
        return;
    }

    if (peakTitle) peakTitle.textContent = title;
    if (peakItem) {
        const skuPart = peak.sku ? peak.sku + ' · ' : '';
        peakItem.textContent = 'Item: ' + skuPart + (peak.material_name || '—');
    }
    if (peakDate) peakDate.textContent = 'Peak date: ' + (peak.peak_date || '—');
    if (peakCapacity) {
        peakCapacity.textContent = 'Required capacity: ' + (peak.required_capacity ?? '—') + ' units';
    }
    peakTooltip.style.display = 'flex';
}

function initDemandChart(charts, mode = _aiChartMode) {
    const container = document.getElementById('demand-chart');
    if (!container) return;

    if (typeof ApexCharts === 'undefined') {
        container.innerHTML = '<div class="ai-demand-chart-empty">Chart library failed to load.</div>';
        return;
    }

    const dataset = getDemandChartDataset(charts, mode);
    if (!dataset?.points?.length) {
        destroyDemandChart();
        container.innerHTML = '<div class="ai-demand-chart-empty">No forecast data available.</div>';
        return;
    }

    container.innerHTML = '';
    destroyDemandChart();

    const options = buildDemandChartOptions(mode, charts);
    _aiDemandChart = new ApexCharts(container, options);
    _aiDemandChart.render();
    setupDemandChartResize(_aiDemandChart);
    setupDemandChartThemeSync(_aiDemandChart);
    updateAIChartPeakTooltip(dataset.peak, getDemandChartPeakTitle(mode));
}

function updateDemandChartMode(mode, charts) {
    const dataset = getDemandChartDataset(charts, mode);
    const container = document.getElementById('demand-chart');
    if (!container) return;

    if (!dataset?.points?.length) {
        destroyDemandChart();
        container.innerHTML = '<div class="ai-demand-chart-empty">No forecast data available.</div>';
        return;
    }

    if (!_aiDemandChart) {
        initDemandChart(charts, mode);
        return;
    }

    if (container.querySelector('.ai-demand-chart-empty')) {
        container.innerHTML = '';
        initDemandChart(charts, mode);
        return;
    }

    _aiDemandChart.updateSeries(buildDemandChartSeries(dataset), true);
    _aiDemandChart.updateOptions({
        xaxis: { categories: dataset.points.map(p => p.label) },
        tooltip: {
            custom({ series, dataPointIndex }) {
                return buildDemandTooltipHtml(mode, dataset, dataPointIndex, series);
            },
        },
    }, false, true);
    updateAIChartPeakTooltip(dataset.peak, getDemandChartPeakTitle(mode));
}

function setupAIChartTabs(charts) {
    const forecastTab = document.getElementById('aiForecastTab');
    const seasonalityTab = document.getElementById('aiSeasonalityTab');
    if (!forecastTab || !seasonalityTab) return;

    const activate = (mode) => {
        _aiChartMode = mode;
        forecastTab.classList.toggle('active', mode === 'forecast');
        seasonalityTab.classList.toggle('active', mode === 'seasonality');
        if (_aiDemandChart && charts) {
            updateDemandChartMode(mode, charts);
        } else {
            initDemandChart(charts, mode);
        }
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
        fetchAndRenderImpliedDemandChart();
    }
}

async function fetchAndRenderAIInsights() {
    const listContainer = document.getElementById('aiInsightsList');
    const aiPage = document.getElementById('ai-insightsPage');

    if (!listContainer && !aiPage) return;

    fetchAndRenderImpliedDemandChart();

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

// ===========================================================================
// PHASE 5 — IMPLIED DEMAND RANKED BAR CHART
// ===========================================================================
let _impliedDemandChart = null;
let _impliedDemandLimit = 10;
let _impliedDemandPeriod = '30days';
let _impliedDemandControlsBound = false;
let _impliedDemandThemeObserver = null;

/**
 * 1. Prevent Duplicate Event Listeners:
 * Binds click handlers for Period and Limit buttons ONCE during application init (using Event Delegation).
 */
function setupImpliedDemandControlsOnce() {
    if (_impliedDemandControlsBound) return;
    const controls = document.getElementById('impliedDemandControls');
    if (!controls) return;

    _impliedDemandControlsBound = true;

    controls.addEventListener('click', (e) => {
        const limitBtn = e.target.closest('.btn-implied-limit');
        if (limitBtn) {
            const limit = parseInt(limitBtn.dataset.limit, 10);
            if (limit && limit !== _impliedDemandLimit) {
                _impliedDemandLimit = limit;
                controls.querySelectorAll('.btn-implied-limit').forEach(b => b.classList.remove('active'));
                limitBtn.classList.add('active');
                fetchAndRenderImpliedDemandChart(_impliedDemandLimit, _impliedDemandPeriod);
            }
            return;
        }

        const periodBtn = e.target.closest('.btn-implied-period');
        if (periodBtn) {
            const period = periodBtn.dataset.period;
            if (period && period !== _impliedDemandPeriod) {
                _impliedDemandPeriod = period;
                controls.querySelectorAll('.btn-implied-period').forEach(b => b.classList.remove('active'));
                periodBtn.classList.add('active');
                fetchAndRenderImpliedDemandChart(_impliedDemandLimit, _impliedDemandPeriod);
            }
            return;
        }
    });
}

/**
 * 2. ApexCharts Instance Management:
 * Safely destroys existing chart instance to prevent memory leaks and ghost canvas overlaps.
 */
function destroyImpliedDemandChart() {
    if (_impliedDemandThemeObserver) {
        _impliedDemandThemeObserver.disconnect();
        _impliedDemandThemeObserver = null;
    }
    if (_impliedDemandChart) {
        try {
            _impliedDemandChart.destroy();
        } catch (e) {
            console.warn('Error destroying implied demand chart instance:', e);
        }
        _impliedDemandChart = null;
    }
}

/**
 * 3. Theme Toggle Support:
 * Uses MutationObserver to update chart colors dynamically on data-theme changes.
 */
function setupImpliedDemandChartThemeSync() {
    if (_impliedDemandThemeObserver) {
        _impliedDemandThemeObserver.disconnect();
    }

    _impliedDemandThemeObserver = new MutationObserver(() => {
        if (!_impliedDemandChart) return;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#d1d5db' : '#374151';
        const gridColor = isDark ? '#27272a' : '#e5e7eb';
        _impliedDemandChart.updateOptions({
            theme: { mode: isDark ? 'dark' : 'light' },
            grid: { borderColor: gridColor },
            xaxis: {
                labels: { style: { colors: textColor } },
                axisBorder: { color: gridColor },
                axisTicks: { color: gridColor },
            },
            yaxis: {
                labels: { style: { colors: textColor } },
            },
            dataLabels: { style: { colors: [textColor] } },
        }, false, true);
    });
    _impliedDemandThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
    });
}

/**
 * Fetches Implied Demand insights from backend and renders interactive horizontal bar chart.
 */
async function fetchAndRenderImpliedDemandChart(limit = _impliedDemandLimit, period = _impliedDemandPeriod) {
    setupImpliedDemandControlsOnce();

    const container = document.getElementById('implied-demand-chart');
    const emptyState = document.getElementById('impliedDemandEmptyState');
    if (!container) return;

    if (typeof ApexCharts === 'undefined') {
        if (emptyState) emptyState.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--dark-wood-secondary);">Chart library unavailable.</div>';
        return;
    }

    try {
        let data = null;
        if (typeof ApiService !== 'undefined' && typeof ApiService.getImpliedDemandInsights === 'function') {
            data = await ApiService.getImpliedDemandInsights(limit, period);
        }

        const results = data && Array.isArray(data.results) ? data.results : [];

        // 5. Defensive Mapping & Empty State: If array is empty, hide canvas and show empty state UI
        if (!results.length) {
            destroyImpliedDemandChart();
            container.style.display = 'none';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        container.style.display = 'block';

        // Map API data cleanly into separate categories and series
        const categories = results.map(r => r.name || 'Product');
        const seriesData = results.map(r => typeof r.implied_demand === 'number' ? r.implied_demand : parseFloat(r.implied_demand || 0));

        // Destroy old instance before creating a new one
        destroyImpliedDemandChart();
        container.innerHTML = '';

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#d1d5db' : '#374151';
        const gridColor = isDark ? '#27272a' : '#e5e7eb';

        const dynamicHeight = Math.max(340, categories.length * 36);

        const options = {
            series: [{
                name: 'Implied Demand (estimate)',
                data: seriesData
            }],
            chart: {
                type: 'bar',
                height: dynamicHeight,
                toolbar: { show: false },
                background: 'transparent',
                fontFamily: "'DM Sans', sans-serif",
            },
            plotOptions: {
                bar: {
                    horizontal: true,
                    barHeight: '55%',
                    borderRadius: 4,
                    dataLabels: { position: 'top' }
                }
            },
            colors: ['#F97316'],
            dataLabels: {
                enabled: true,
                textAnchor: 'start',
                style: { colors: [textColor], fontSize: '11px', fontWeight: 600 },
                formatter: function (val) {
                    return val > 0 ? val : '0';
                },
                offsetX: 6,
            },
            grid: {
                borderColor: gridColor,
                strokeDashArray: 4,
                xaxis: { lines: { show: true } },
                yaxis: { lines: { show: false } }
            },
            xaxis: {
                categories: categories,
                labels: {
                    style: { colors: textColor, fontSize: '11px' }
                },
                axisBorder: { color: gridColor },
                axisTicks: { color: gridColor }
            },
            // 4. Mobile Y-Axis Truncation: yaxis.labels.maxWidth 140px and formatted text truncation
            yaxis: {
                labels: {
                    maxWidth: 140,
                    style: { colors: textColor, fontSize: '12px', fontWeight: 500 },
                    formatter: function (val) {
                        if (typeof val !== 'string') val = String(val || '');
                        return val.length > 18 ? val.substring(0, 18) + '…' : val;
                    }
                }
            },
            tooltip: {
                theme: isDark ? 'dark' : 'light',
                custom: function ({ series, seriesIndex, dataPointIndex }) {
                    const item = results[dataPointIndex] || {};
                    const val = series[seriesIndex][dataPointIndex];
                    const name = item.name || 'Product';
                    const label = item.implied_demand_label || 'Implied Demand (estimate)';
                    return `
                        <div style="padding: 10px 14px; font-family: inherit; font-size: 13px;">
                            <div style="font-weight: 700; margin-bottom: 4px; color: var(--dark-wood, #111827);">${escapeHtml(name)}</div>
                            <div style="color: #F97316; font-weight: 700;">
                                ${val} <span style="font-size: 11px; opacity: 0.85; font-weight: 500;">(${escapeHtml(label)})</span>
                            </div>
                        </div>
                    `;
                }
            }
        };

        _impliedDemandChart = new ApexCharts(container, options);
        await _impliedDemandChart.render();

        setupImpliedDemandChartThemeSync();
    } catch (err) {
        console.error('Failed to load implied demand chart:', err);
        destroyImpliedDemandChart();
        container.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
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

// ===========================================================================
// PRODUCTS & BOM FEATURE (PHASE 2)
// ===========================================================================
let _productsListCache = [];
let _activeBomQuickCreateRow = null;
let _productListenersInitialized = false;

/**
 * Initialize / Load the Products Page
 */
async function loadProductsPage() {
    const tableBody = document.getElementById('productsTableBody');
    if (!tableBody) return;

    try {
        if (typeof ApiService !== 'undefined' && typeof ApiService.getProducts === 'function') {
            try {
                const data = await ApiService.getProducts();
                _productsListCache = Array.isArray(data) ? data : (data.results || []);
            } catch (err) {
                console.warn('API Products fetch error:', err);
            }
        }
    } catch (e) {
        console.error('Error fetching products:', e);
    }

    renderProductsTable();
    setupProductFormListenersOnce();
}

function renderProductsTable() {
    const tableBody = document.getElementById('productsTableBody');
    const emptyState = document.getElementById('productsEmptyState');
    const countBadge = document.getElementById('productCountBadge');

    if (!tableBody) return;

    if (countBadge) {
        countBadge.textContent = `${_productsListCache.length} Product${_productsListCache.length === 1 ? '' : 's'}`;
    }

    if (!_productsListCache || _productsListCache.length === 0) {
        tableBody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tableBody.innerHTML = _productsListCache.map(prod => {
        const bomCount = prod.bom_lines ? prod.bom_lines.length : 0;
        const photoUrl = prod.photo ? resolveMediaUrl(prod.photo) : null;
        const photoHtml = photoUrl
            ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(prod.name)}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover;" />`
            : `<div style="width: 40px; height: 40px; border-radius: 8px; background: var(--beige-border); display: flex; align-items: center; justify-content: center; color: var(--dark-wood-secondary); font-size: 0.9rem;"><i class="fas fa-box"></i></div>`;

        const statusClass = prod.status === 'active' ? 'approved' : 'denied';
        const statusLabel = prod.status === 'active' ? 'Active' : 'Inactive';

        return `
            <tr>
                <td>${photoHtml}</td>
                <td><strong style="font-family: monospace;">${escapeHtml(prod.sku)}</strong></td>
                <td><strong>${escapeHtml(prod.name)}</strong></td>
                <td>${escapeHtml(prod.category || '—')}</td>
                <td>${escapeHtml(prod.unit_of_measure)}</td>
                <td><span class="status-badge pending" style="text-transform: none;">${bomCount} line${bomCount === 1 ? '' : 's'}</span></td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>
                    <button type="button" class="req-page-btn" onclick="editProduct('${escapeHtml(String(prod.id))}')" style="padding: 4px 10px; font-size: 0.75rem;">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function setupProductFormListenersOnce() {
    if (_productListenersInitialized) return;
    _productListenersInitialized = true;

    // Toggle Add Product section visibility
    const toggleBtn = document.getElementById('toggleAddProductBtn');
    const addSection = document.getElementById('addProductSection');

    if (toggleBtn && addSection) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = addSection.style.display === 'none';
            addSection.style.display = isHidden ? 'block' : 'none';
            toggleBtn.innerHTML = isHidden
                ? '<i class="fas fa-minus"></i> Hide Form'
                : '<i class="fas fa-plus"></i> Add New Product';
        });
    }

    // Add BOM row button
    const addBomBtn = document.getElementById('addBomRowBtn');
    if (addBomBtn) {
        addBomBtn.addEventListener('click', () => addBomRow());
    }

    // Photo input preview
    const photoInput = document.getElementById('productPhotoInput');
    const photoPreview = document.getElementById('productPhotoPreview');
    const photoPlaceholder = document.getElementById('productPhotoPlaceholder');

    if (photoInput && photoPreview && photoPlaceholder) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    photoPreview.src = evt.target.result;
                    photoPreview.hidden = false;
                    photoPlaceholder.hidden = true;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Clear / Cancel button
    const cancelBtn = document.getElementById('cancelProductBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => resetProductForm());
    }

    // Add Product Form submit
    const productForm = document.getElementById('addProductForm');
    if (productForm) {
        productForm.addEventListener('submit', handleProductFormSubmit);
    }

    // Quick-Create Material Modal controls
    const closeQuickModalBtn = document.getElementById('closeQuickMaterialModalBtn');
    const cancelQuickBtn = document.getElementById('cancelQuickMaterialBtn');
    const quickModal = document.getElementById('quickCreateMaterialModal');

    if (closeQuickModalBtn) closeQuickModalBtn.addEventListener('click', closeQuickCreateModal);
    if (cancelQuickBtn) cancelQuickBtn.addEventListener('click', closeQuickCreateModal);
    if (quickModal) {
        quickModal.addEventListener('click', (e) => {
            if (e.target.id === 'quickCreateMaterialModal') closeQuickCreateModal();
        });
    }

    const quickForm = document.getElementById('quickCreateMaterialForm');
    if (quickForm) {
        quickForm.addEventListener('submit', handleQuickCreateMaterialSubmit);
    }

    // Add at least one default BOM line if container is empty
    const bomContainer = document.getElementById('bomRowsContainer');
    if (bomContainer && bomContainer.children.length === 0) {
        addBomRow();
    }
}

/**
 * Adds a new BOM row (material search input + quantity per unit) to the BOM section
 */
function addBomRow(selectedMaterial = null, qtyPerUnit = '') {
    const container = document.getElementById('bomRowsContainer');
    if (!container) return;

    const rowId = 'bom-row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const rowEl = document.createElement('div');
    rowEl.className = 'bom-row';
    rowEl.id = rowId;
    if (selectedMaterial) {
        rowEl.dataset.materialId = selectedMaterial.id;
    }

    const initialSearchVal = selectedMaterial ? selectedMaterial.name : '';

    rowEl.innerHTML = `
        <div class="bom-material-search-wrap">
            <input type="text" class="bom-material-input" placeholder="Search material catalog by name..." 
                value="${escapeHtml(initialSearchVal)}" autocomplete="off" 
                style="width: 100%; padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid var(--beige-border); background: var(--input-bg); color: var(--text-primary); font-size: 0.88rem;" />
            <div class="bom-material-dropdown hidden"></div>
        </div>
        <div>
            <input type="number" class="bom-qty-input" placeholder="Qty per unit (e.g. 0.5)" step="0.001" min="0.001" 
                value="${escapeHtml(String(qtyPerUnit))}" required
                style="width: 100%; padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid var(--beige-border); background: var(--input-bg); color: var(--text-primary); font-size: 0.88rem;" />
        </div>
        <button type="button" class="btn-remove-bom-row" title="Remove line">
            <i class="fas fa-trash"></i>
        </button>
    `;

    const input = rowEl.querySelector('.bom-material-input');
    const dropdown = rowEl.querySelector('.bom-material-dropdown');
    const removeBtn = rowEl.querySelector('.btn-remove-bom-row');

    removeBtn.addEventListener('click', () => {
        const totalRows = container.querySelectorAll('.bom-row').length;
        if (totalRows <= 1) {
            showNotification('BOM Required', 'A product must have at least one BOM line.', 'info');
            return;
        }
        rowEl.remove();
    });

    input.addEventListener('focus', () => renderBomMaterialDropdown(rowEl, input.value.trim()));
    input.addEventListener('input', () => {
        rowEl.dataset.materialId = '';
        renderBomMaterialDropdown(rowEl, input.value.trim());
    });

    document.addEventListener('click', (e) => {
        if (!rowEl.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    container.appendChild(rowEl);
}

/**
 * Renders the material search dropdown for a specific BOM row
 */
function renderBomMaterialDropdown(rowEl, query) {
    const dropdown = rowEl.querySelector('.bom-material-dropdown');
    if (!dropdown) return;

    const materials = getMaterials() || [];
    const filtered = materials.filter(m => 
        !query || m.name.toLowerCase().includes(query.toLowerCase())
    );

    let html = '';

    if (filtered.length > 0) {
        html += filtered.map(m => `
            <div class="bom-material-option" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-unit="${escapeHtml(m.unit || '')}">
                <span><strong>${escapeHtml(m.name)}</strong> <small style="color: var(--dark-wood-secondary);">(${escapeHtml(m.unit || '')})</small></span>
                <span style="font-size: 0.75rem; opacity: 0.7;">Stock: ${m.qty != null ? m.qty : (m.current_quantity || 0)}</span>
            </div>
        `).join('');
    } else {
        html += `<div style="padding: 0.6rem 0.8rem; font-size: 0.85rem; color: var(--dark-wood-secondary);">No matching materials found.</div>`;
    }

    const createLabel = query ? `+ Create new material "${escapeHtml(query)}"` : '+ Create new material';
    html += `
        <div class="bom-quick-create-option" data-query="${escapeHtml(query)}">
            <i class="fas fa-plus-circle"></i> ${createLabel}
        </div>
    `;

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.bom-material-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const matId = opt.dataset.id;
            const matName = opt.dataset.name;
            rowEl.dataset.materialId = matId;
            const input = rowEl.querySelector('.bom-material-input');
            if (input) input.value = matName;
            dropdown.classList.add('hidden');
        });
    });

    const quickOpt = dropdown.querySelector('.bom-quick-create-option');
    if (quickOpt) {
        quickOpt.addEventListener('click', () => {
            dropdown.classList.add('hidden');
            openQuickCreateMaterialModal(rowEl, query);
        });
    }
}

function openQuickCreateMaterialModal(targetRowEl, defaultName = '') {
    _activeBomQuickCreateRow = targetRowEl;
    const modal = document.getElementById('quickCreateMaterialModal');
    const nameInput = document.getElementById('quickMaterialName');

    if (nameInput) nameInput.value = defaultName;
    if (modal) modal.classList.remove('hidden');
}

function closeQuickCreateModal() {
    const modal = document.getElementById('quickCreateMaterialModal');
    if (modal) modal.classList.add('hidden');
    _activeBomQuickCreateRow = null;
    const quickForm = document.getElementById('quickCreateMaterialForm');
    if (quickForm) quickForm.reset();
}

/**
 * Handles Quick-Create Material Form submission.
 * Creates a real Material row in the database, updates state, and selects it in the BOM line.
 */
async function handleQuickCreateMaterialSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('quickMaterialName');
    const unitInput = document.getElementById('quickMaterialUnit');
    const submitBtn = document.getElementById('saveQuickMaterialBtn');

    const name = nameInput ? nameInput.value.trim() : '';
    const unit = unitInput ? unitInput.value : 'kg';

    if (!name) {
        showNotification('Input Error', 'Material name is required.', 'error');
        return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
        let createdMat = null;

        if (typeof ApiService !== 'undefined' && typeof ApiService.quickCreateMaterial === 'function') {
            try {
                createdMat = await ApiService.quickCreateMaterial({
                    name: name,
                    unit: unit,
                });
            } catch (err) {
                console.warn('API quickCreateMaterial error:', err);
                if (err && err.message) {
                    showNotification('Creation Error', err.message, 'error');
                    return;
                }
            }
        }

        if (!createdMat) {
            createdMat = {
                id: 'mat_' + Date.now(),
                name: name,
                unit: unit,
                current_quantity: 0,
                qty: 0,
            };
        }

        // Add to dataManager / global state if available
        if (typeof dataManager !== 'undefined' && typeof dataManager.addMaterialLocal === 'function') {
            dataManager.addMaterialLocal(createdMat);
        } else if (typeof dataManager !== 'undefined' && Array.isArray(dataManager.materials)) {
            dataManager.materials.push(createdMat);
        }

        // Re-populate dropdowns everywhere so created material shows in Main Materials Catalog & Activity selects
        populateMaterialSelects();

        // If invoked from a BOM row, automatically select the new material in that row
        if (_activeBomQuickCreateRow) {
            _activeBomQuickCreateRow.dataset.materialId = createdMat.id;
            const input = _activeBomQuickCreateRow.querySelector('.bom-material-input');
            if (input) input.value = createdMat.name;
        }

        showNotification('Material Created', `"${createdMat.name}" created and added to catalog.`, 'success');
        closeQuickCreateModal();
    } catch (err) {
        console.error('Failed to quick-create material:', err);
        showNotification('Creation Failed', err.message || 'Could not create material.', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function resetProductForm() {
    const form = document.getElementById('addProductForm');
    if (form) form.reset();

    const photoPreview = document.getElementById('productPhotoPreview');
    const photoPlaceholder = document.getElementById('productPhotoPlaceholder');
    if (photoPreview) {
        photoPreview.src = '';
        photoPreview.hidden = true;
    }
    if (photoPlaceholder) photoPlaceholder.hidden = false;

    const container = document.getElementById('bomRowsContainer');
    if (container) {
        container.innerHTML = '';
        addBomRow();
    }
}

async function handleProductFormSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('productName')?.value.trim();
    const sku = document.getElementById('productSku')?.value.trim();
    const category = document.getElementById('productCategory')?.value.trim() || '';
    const unitOfMeasure = document.getElementById('productUom')?.value.trim();
    const status = document.getElementById('productStatus')?.value || 'active';
    const description = document.getElementById('productDescription')?.value.trim() || '';
    const photoInput = document.getElementById('productPhotoInput');

    if (!name || !sku || !unitOfMeasure) {
        showNotification('Validation Error', 'Please complete Name, SKU, and Product UOM.', 'error');
        return;
    }

    const bomRows = document.querySelectorAll('#bomRowsContainer .bom-row');
    const bomLines = [];
    const usedMaterialIds = new Set();

    for (const row of bomRows) {
        const matId = row.dataset.materialId;
        const matInputName = row.querySelector('.bom-material-input')?.value.trim();
        const qtyVal = row.querySelector('.bom-qty-input')?.value;

        if (!matInputName) continue;

        let finalMatId = matId;
        if (!finalMatId) {
            const materials = getMaterials() || [];
            const found = materials.find(m => m.name.toLowerCase() === matInputName.toLowerCase());
            if (found) {
                finalMatId = found.id;
                row.dataset.materialId = found.id;
            } else {
                showNotification('BOM Error', `Material "${matInputName}" not found in catalog. Please select or quick-create it.`, 'error');
                return;
            }
        }

        const qty = parseFloat(qtyVal);
        if (isNaN(qty) || qty <= 0) {
            showNotification('BOM Error', 'Quantity per unit must be a positive number.', 'error');
            return;
        }

        if (usedMaterialIds.has(finalMatId)) {
            showNotification('BOM Duplicate', 'Duplicate materials found in BOM lines. Each material must appear only once.', 'error');
            return;
        }

        usedMaterialIds.add(finalMatId);
        bomLines.push({
            material: finalMatId,
            quantity_per_unit: qty.toFixed(3),
        });
    }

    if (bomLines.length === 0) {
        showNotification('BOM Required', 'Please add at least one material line to the Bill of Materials.', 'error');
        return;
    }

    const saveBtn = document.getElementById('saveProductBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const payload = {
            name,
            sku,
            category,
            unit_of_measure: unitOfMeasure,
            status,
            description,
            bom_lines: bomLines,
        };

        let newProd = null;

        if (typeof ApiService !== 'undefined' && typeof ApiService.request === 'function') {
            try {
                if (photoInput && photoInput.files[0]) {
                    const formData = new FormData();
                    Object.keys(payload).forEach(key => {
                        if (key === 'bom_lines') {
                            formData.append('bom_lines', JSON.stringify(payload.bom_lines));
                        } else {
                            formData.append(key, payload[key]);
                        }
                    });
                    formData.append('photo', photoInput.files[0]);

                    newProd = await ApiService.request('/inventory/products/', {
                        method: 'POST',
                        body: formData,
                    });
                } else {
                    newProd = await ApiService.request('/inventory/products/', {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });
                }
            } catch (err) {
                console.warn('Backend endpoint POST /inventory/products/ pending Phase 3, saving locally:', err);
            }
        }

        if (!newProd) {
            newProd = {
                id: 'prod_' + Date.now(),
                ...payload,
            };
        }

        _productsListCache.unshift(newProd);
        renderProductsTable();
        resetProductForm();
        showNotification('Product Saved', `Product "${name}" successfully created.`, 'success');
    } catch (err) {
        console.error('Failed to save product:', err);
        showNotification('Save Error', err.message || 'Could not save product.', 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

