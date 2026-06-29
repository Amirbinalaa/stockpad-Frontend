// ==================== STOCKPAD CONFIGURATION ====================
// Centralized environment detection, URL resolution, and path normalization.

const StockPadConfig = (() => {
    const PRODUCTION_HOST = 'stockpad-backend-production.up.railway.app';
    const PRODUCTION_FRONTEND_ORIGIN = 'https://stockpad-smoky.vercel.app';
    const GOOGLE_CLIENT_ID = '506308055021-hg407bv24ln5kelikrud2k3e9iffha1e.apps.googleusercontent.com';
    const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '']);
    const DEFAULT_LOCAL_PORT = 9000;
    const LOCAL_PORT_KEY = 'sp_api_port';

    function isLocalEnvironment() {
        const { hostname } = window.location;
        if (LOCAL_HOSTNAMES.has(hostname)) return true;
        return hostname.endsWith('.local') || hostname.endsWith('.localhost');
    }

    function resolveProtocol(forLocal) {
        if (forLocal) return 'http:';
        if (window.location.protocol === 'https:') return 'https:';
        return 'https:';
    }

    function stripTrailingSlashes(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function normalizePath(...segments) {
        return segments
            .filter((segment) => segment !== null && segment !== undefined && segment !== '')
            .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''))
            .filter(Boolean)
            .join('/');
    }

    function buildUrl(base, ...pathSegments) {
        const cleanBase = stripTrailingSlashes(base);
        const path = normalizePath(...pathSegments);
        if (!path) return cleanBase;
        return `${cleanBase}/${path}`;
    }

    function withTrailingSlash(url) {
        if (!url || url.includes('?') || url.includes('#')) return url;
        return url.endsWith('/') ? url : `${url}/`;
    }

    function resolveLocalPort() {
        const stored = localStorage.getItem(LOCAL_PORT_KEY);
        const parsed = Number.parseInt(stored, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCAL_PORT;
    }

    function buildRootUrl() {
        if (typeof window !== 'undefined' && window.STOCKPAD_API_URL) {
            return stripTrailingSlashes(window.STOCKPAD_API_URL);
        }

        if (isLocalEnvironment()) {
            const port = resolveLocalPort();
            return `${resolveProtocol(true)}//127.0.0.1:${port}`;
        }

        const protocol = resolveProtocol(false);
        return `${protocol}//${PRODUCTION_HOST}`;
    }

    const ROOT_URL = buildRootUrl();
    const API_BASE_URL = buildUrl(ROOT_URL, 'api');
    const AUTH_BASE_URL = buildUrl(API_BASE_URL, 'auth');

    function resolveApiUrl(endpoint, { trailingSlash = true } = {}) {
        if (/^https?:\/\//i.test(endpoint)) {
            return trailingSlash ? withTrailingSlash(endpoint) : stripTrailingSlashes(endpoint);
        }

        const cleanEndpoint = String(endpoint || '').trim();
        const [pathPart, queryPart] = cleanEndpoint.split('?');
        const normalizedPath = pathPart.startsWith('/')
            ? pathPart
            : `/${pathPart}`;

        let url = `${stripTrailingSlashes(API_BASE_URL)}${normalizedPath}`;
        if (trailingSlash) {
            const slashIndex = url.indexOf('?');
            const base = slashIndex === -1 ? url : url.slice(0, slashIndex);
            url = withTrailingSlash(base) + (slashIndex === -1 ? '' : url.slice(slashIndex));
        }

        return queryPart ? `${url}?${queryPart}` : url;
    }

    function resolveAuthUrl(endpoint, options = {}) {
        if (/^https?:\/\//i.test(endpoint)) {
            return options.trailingSlash === false
                ? stripTrailingSlashes(endpoint)
                : withTrailingSlash(endpoint);
        }

        const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
        return resolveApiUrl(`/auth/${cleanEndpoint}`, options);
    }

    return {
        PRODUCTION_HOST,
        PRODUCTION_FRONTEND_ORIGIN,
        GOOGLE_CLIENT_ID,
        DEFAULT_LOCAL_PORT,
        LOCAL_PORT_KEY,
        isLocal: isLocalEnvironment(),
        ROOT_URL,
        API_BASE_URL,
        AUTH_BASE_URL,
        buildUrl,
        normalizePath,
        withTrailingSlash,
        stripTrailingSlashes,
        resolveApiUrl,
        resolveAuthUrl,
        resolveProtocol,
        setLocalPort(port) {
            const parsed = Number.parseInt(port, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) return;
            localStorage.setItem(LOCAL_PORT_KEY, String(parsed));
        },
        getLocalPort: resolveLocalPort,
    };
})();

const CONFIG_IS_LOCAL = StockPadConfig.isLocal;
const CONFIG_ROOT_URL = StockPadConfig.ROOT_URL;
const CONFIG_API_BASE_URL = StockPadConfig.API_BASE_URL;
const CONFIG_AUTH_BASE_URL = StockPadConfig.AUTH_BASE_URL;
