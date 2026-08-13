/**
 * Material category constants, inference (mirrors backend), and inline SVG badges.
 */
(function (global) {
    'use strict';

    const CATEGORY_BUILDING = 'Building Materials';
    const CATEGORY_STEEL = 'Steel & Metal';
    const CATEGORY_PAINTS = 'Paints & Coatings';
    const CATEGORY_FINISHING = 'Finishing';
    const CATEGORY_PLUMBING = 'Plumbing';
    const CATEGORY_ELECTRICAL = 'Electrical';
    const CATEGORY_OTHERS = 'Others';

    const UNCATEGORIZED = new Set([
        '',
        'uncategorized',
        'general supplies',
        'general',
        'other',
        'others',
    ]);

    const ALL_CATEGORIES = [
        CATEGORY_BUILDING,
        CATEGORY_STEEL,
        CATEGORY_PAINTS,
        CATEGORY_FINISHING,
        CATEGORY_PLUMBING,
        CATEGORY_ELECTRICAL,
        CATEGORY_OTHERS,
    ];

    const KEYWORD_RULES = [
        { category: CATEGORY_BUILDING, keywords: ['cement', 'sand', 'brick', 'concrete', 'plaster', 'gravel'] },
        { category: CATEGORY_PAINTS, keywords: ['paint', 'primer', 'varnish', 'epoxy', 'coating', 'thinner'] },
        { category: CATEGORY_FINISHING, keywords: ['foam', 'wood', 'veneer', 'laminate', 'tile', 'fabric', 'leather'] },
        { category: CATEGORY_PLUMBING, keywords: ['pipe', 'faucet', 'valve', 'pvc', 'fitting', 'tube'] },
        { category: CATEGORY_ELECTRICAL, keywords: ['cable', 'switch', 'breaker', 'led', 'socket', 'copper'] },
        { category: CATEGORY_STEEL, keywords: ['iron', 'steel', 'rod', 'bolt', 'screw', 'wire', 'aluminum', 'metal', 'plate'] },
    ];

    const ICON_PATHS = {
        [CATEGORY_BUILDING]: '<path d="M2 10V4l5-3 5 3v6"/><path d="M4.5 10V7h3v3"/><path d="M9.5 10V7h3v3"/>',
        [CATEGORY_STEEL]: '<path d="M14 2.5l-2 2"/><path d="M8.5 6.5L11 4"/><path d="M2 12l7-7 3 3-7 7H2z"/>',
        [CATEGORY_PAINTS]: '<path d="M3 4h8l-1 8H4L3 4z"/><path d="M11 4h1.5a1.5 1.5 0 0 1 0 3H11"/><path d="M6 8v4"/>',
        [CATEGORY_FINISHING]: '<path d="M2 10l4-6 3 4 3-5 4 7"/><path d="M2 10h10"/>',
        [CATEGORY_PLUMBING]: '<path d="M7 2v2"/><path d="M7 4a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3z"/><path d="M7 11v1"/>',
        [CATEGORY_ELECTRICAL]: '<path d="M8 2L4 8h3l-1 4 5-6H8l1-4z"/>',
        [CATEGORY_OTHERS]: '<path d="M2 4h8v6H2z"/><path d="M4 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/>',
    };

    function isUncategorized(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return UNCATEGORIZED.has(normalized);
    }

    function inferCategoryFromName(name) {
        const haystack = String(name || '').trim().toLowerCase();
        if (!haystack) return CATEGORY_OTHERS;
        for (let i = 0; i < KEYWORD_RULES.length; i += 1) {
            const rule = KEYWORD_RULES[i];
            for (let j = 0; j < rule.keywords.length; j += 1) {
                if (haystack.includes(rule.keywords[j])) return rule.category;
            }
        }
        return CATEGORY_OTHERS;
    }

    function resolveMaterialCategory(material) {
        if (!material) return CATEGORY_OTHERS;
        const explicit = material.category;
        if (!isUncategorized(explicit)) {
            return String(explicit).trim();
        }
        if (material.resolved_category && !isUncategorized(material.resolved_category)) {
            return String(material.resolved_category).trim();
        }
        return inferCategoryFromName(material.name);
    }

    function categorySvgIcon(categoryName, sizePx) {
        const size = Number(sizePx) || 14;
        const paths = ICON_PATHS[categoryName] || ICON_PATHS[CATEGORY_OTHERS];
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
            'viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" ' +
            `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
        );
    }

    function renderCategoryBadgeHtml(categoryName, sizePx) {
        const size = Number(sizePx) || 14;
        const label = String(categoryName || CATEGORY_OTHERS);
        return (
            `<span class="category-badge">${categorySvgIcon(label, size)}` +
            `<span>${label}</span></span>`
        );
    }

    function renderCategoryFilterChip(categoryName, isActive) {
        const activeClass = isActive ? ' is-active' : '';
        const label = categoryName === 'all' ? 'All' : categoryName;
        const icon = categoryName === 'all'
            ? categorySvgIcon(CATEGORY_OTHERS, 14)
            : categorySvgIcon(categoryName, 14);
        return (
            `<button type="button" class="material-category-chip${activeClass}" ` +
            `data-category="${categoryName === 'all' ? 'all' : categoryName}" aria-pressed="${isActive}">` +
            `${icon}<span>${label}</span></button>`
        );
    }

    const PROCUREMENT_REPORT_STYLES = `
.category-badge {
  background-color: #1e232d;
  border: 1px solid #2e3644;
  color: #e2e8f0;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  text-transform: uppercase;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pp-report-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.pp-report-table th, .pp-report-table td {
  border: 1px solid #2e3644;
  padding: 6px 8px;
  text-align: left;
  color: #e2e8f0;
}
.pp-report-table th { background: #18181b; color: #f97316; text-transform: uppercase; font-size: 10px; }
.pp-report-table tbody tr { background: #27272a; }
.pp-report-table tbody tr:nth-child(even) { background: #1f1f23; }
`;

    function buildProcurementReportPrintHtml(reportData, filteredRows) {
        const kpis = reportData.kpis || {};
        const rows = filteredRows || [];
        const bodyRows = rows.map((item) => {
            const badge = renderCategoryBadgeHtml(item.category, 12);
            return (
                '<tr>' +
                `<td><strong>${escapeHtmlProc(item.material_name)}</strong></td>` +
                `<td>${badge}</td>` +
                `<td>${item.current_stock.toFixed(2)} ${escapeHtmlProc(item.unit)}</td>` +
                `<td>${item.available_stock.toFixed(2)} ${escapeHtmlProc(item.unit)}</td>` +
                `<td>${item.action_status || ''}</td>` +
                '</tr>'
            );
        }).join('');

        return (
            '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap">' +
            `<style>${PROCUREMENT_REPORT_STYLES}body{background:#18181b;color:#e2e8f0;font-family:'Geist',sans-serif;padding:24px;}</style>` +
            '</head><body>' +
            '<h1 style="color:#f97316;font-size:18px;margin:0 0 8px;">Procurement &amp; Planning Report</h1>' +
            `<p style="font-size:11px;color:#a1a1aa;margin:0 0 16px;">Critical: ${kpis.critical_count ?? 0} · Reorder: ${kpis.reorder_count ?? 0}</p>` +
            '<table class="pp-report-table"><thead><tr>' +
            '<th>Material</th><th>Category</th><th>Current</th><th>Available</th><th>Status</th>' +
            '</tr></thead><tbody>' +
            bodyRows +
            '</tbody></table></body></html>'
        );
    }

    function escapeHtmlProc(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    global.MaterialCategories = {
        ALL_CATEGORIES,
        CATEGORY_OTHERS,
        inferCategoryFromName,
        resolveMaterialCategory,
        categorySvgIcon,
        renderCategoryBadgeHtml,
        renderCategoryFilterChip,
        buildProcurementReportPrintHtml,
        PROCUREMENT_REPORT_STYLES,
    };
})(typeof window !== 'undefined' ? window : globalThis);
