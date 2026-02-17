require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// Dynamic import for ESM vidsrc-scraper module
let scrapeVidsrc = null;
import('@definisi/vidsrc-scraper').then(mod => {
    scrapeVidsrc = mod.scrapeVidsrc;
    console.log('  ✓ VidSrc scraper loaded');
}).catch(e => {
    console.warn('  ✗ VidSrc scraper not available:', e.message);
});

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const OPENSUBTITLES_KEY = process.env.OPENSUBTITLES_API_KEY;
const TRAKT_KEY = process.env.TRAKT_API_KEY;
const MORPHTV_API = process.env.MORPHTV_API;
const MORPHTV_SECRET = process.env.MORPHTV_SECRET;
const TEATV_API = process.env.TEATV_API;
const FLIXANITY_API = process.env.FLIXANITY_API;
const FLIXANITY_TOKEN = process.env.FLIXANITY_TOKEN;
const FLIXANITY_KEY_SL = process.env.FLIXANITY_KEY_SL;
const PRIMEWIRE_SEARCH_KEY = process.env.PRIMEWIRE_SEARCH_KEY;
const STREMIO_OPENSUB_URL = process.env.STREMIO_OPENSUB_URL;
const SUBDL_API = process.env.SUBDL_API;
const SUBSOURCE_API = process.env.SUBSOURCE_API;
const VTT_FILES_URL = process.env.VTT_FILES_URL;
const ADDON_CONFIG_URL = process.env.ADDON_CONFIG_URL;

app.use(cors());
app.use(express.json());

// ── Security headers to block ads even in child frames ──
app.use((req, res, next) => {
    // Permissions-Policy: disable autoplay of ads, prevent popups in iframes
    res.set('Permissions-Policy', 'autoplay=(self), popups=(self)');
    next();
});

// No-cache for JS/CSS to prevent stale browser cache
app.use('/js', (req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});
app.use('/css', (req, res, next) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── TMDB Proxy Helper ───
async function tmdbFetch(endpoint, extraParams = {}) {
    const params = new URLSearchParams({ api_key: TMDB_KEY, ...extraParams });
    const url = `${TMDB_BASE}${endpoint}?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}: ${res.statusText}`);
    return res.json();
}

// ─── Trending ───
app.get('/api/trending/:type/:window', async (req, res) => {
    try {
        const { type, window } = req.params;
        const page = req.query.page || 1;
        const data = await tmdbFetch(`/trending/${type}/${window}`, { page });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Popular / Top Rated / Now Playing / Airing Today ───
app.get('/api/:type/:category', async (req, res, next) => {
    const { type, category } = req.params;
    const validTypes = ['movie', 'tv'];
    const validCats = ['popular', 'top_rated', 'now_playing', 'airing_today', 'on_the_air', 'upcoming'];
    if (!validTypes.includes(type) || !validCats.includes(category)) return next();
    try {
        const page = req.query.page || 1;
        const data = await tmdbFetch(`/${type}/${category}`, { page });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Search ───
app.get('/api/search', async (req, res) => {
    try {
        const { q, page = 1 } = req.query;
        if (!q) return res.status(400).json({ error: 'Query required' });
        const data = await tmdbFetch('/search/multi', { query: q, page, include_adult: false });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Movie Details ───
app.get('/api/movie/:id', async (req, res) => {
    try {
        const data = await tmdbFetch(`/movie/${req.params.id}`, {
            append_to_response: 'credits,similar,videos,external_ids,watch/providers'
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TV Details ───
app.get('/api/tv/:id', async (req, res) => {
    try {
        const data = await tmdbFetch(`/tv/${req.params.id}`, {
            append_to_response: 'credits,similar,videos,external_ids,watch/providers'
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TV Season Details ───
app.get('/api/tv/:id/season/:season', async (req, res) => {
    try {
        const data = await tmdbFetch(`/tv/${req.params.id}/season/${req.params.season}`);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Genres ───
app.get('/api/genres/:type', async (req, res) => {
    try {
        const data = await tmdbFetch(`/genre/${req.params.type}/list`);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Discover ───
app.get('/api/discover/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { page = 1, genre, year, sort_by } = req.query;
        const params = { page };
        if (genre) params.with_genres = genre;
        if (year) {
            if (type === 'movie') params.primary_release_year = year;
            else params.first_air_date_year = year;
        }
        if (sort_by) params.sort_by = sort_by;
        else params.sort_by = 'popularity.desc';
        const data = await tmdbFetch(`/discover/${type}`, params);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Person Details ───
app.get('/api/person/:id', async (req, res) => {
    try {
        const data = await tmdbFetch(`/person/${req.params.id}`, {
            append_to_response: 'combined_credits'
        });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Subtitle Proxy (OpenSubtitles REST API) ───
app.get('/api/subtitles/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        const { season, episode } = req.query;
        let url = `https://rest.opensubtitles.org/search/imdbid-${imdbId.replace('tt', '')}`;
        if (season && episode) url += `/season-${season}/episode-${episode}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'FilmPlusWeb v1.0', 'X-User-Agent': 'FilmPlusWeb v1.0' }
        });
        if (!response.ok) return res.json([]);
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json([]); }
});

// ─── OpenSubtitles New API (v2) ───
app.get('/api/subtitles-new/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        const { season, episode, lang = 'en' } = req.query;
        let url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${imdbId}&languages=${lang}`;
        if (season) url += `&season_number=${season}`;
        if (episode) url += `&episode_number=${episode}`;
        const response = await fetch(url, {
            headers: {
                'Api-Key': OPENSUBTITLES_KEY,
                'User-Agent': 'MyApp v3.6.8',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) return res.json({ data: [] });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json({ data: [] }); }
});

// ─── Stremio OpenSubtitles (no key needed) ───
app.get('/api/subtitles-stremio/:type/:imdbId', async (req, res) => {
    try {
        const { type, imdbId } = req.params;
        const { season, episode } = req.query;
        let url;
        if (type === 'movie') {
            url = `${STREMIO_OPENSUB_URL}/subtitles/movie/${imdbId}.json`;
        } else {
            url = `${STREMIO_OPENSUB_URL}/subtitles/series/${imdbId}:${season}:${episode}.json`;
        }
        const response = await fetch(url);
        if (!response.ok) return res.json({ subtitles: [] });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json({ subtitles: [] }); }
});

// ─── SubDL API ───
app.get('/api/subtitles-subdl', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);
        const url = `${SUBDL_API}?query=${encodeURIComponent(q)}`;
        const response = await fetch(url);
        if (!response.ok) return res.json([]);
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json([]); }
});

// ─── SubSource API ───
app.get('/api/subtitles-subsource', async (req, res) => {
    try {
        const { q, action = 'searchMovie' } = req.query;
        if (!q) return res.json([]);
        const url = `${SUBSOURCE_API}/${action}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q })
        });
        if (!response.ok) return res.json([]);
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json([]); }
});

// ─── Subtitle File Proxy ───
app.get('/api/subtitle-file', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const response = await fetch(url);
        const text = await response.text();
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        // Convert SRT to VTT if needed
        if (!text.startsWith('WEBVTT')) {
            const vtt = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
            res.send(vtt);
        } else {
            res.send(text);
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Generic Proxy for embed sources ───
app.get('/api/proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(url).origin
            }
        });
        const contentType = response.headers.get('content-type');
        res.set('Content-Type', contentType || 'text/html');
        const body = await response.buffer();
        res.send(body);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Ad-cleaning embed proxy ───
// Fetches embed page HTML, strips ad scripts/iframes/popups, serves clean version
app.get('/api/embed-proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });

        const parsedUrl = new URL(url);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': parsedUrl.origin,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Upstream returned ${response.status}` });
        }

        let html = await response.text();

        // ── Strip ad-related scripts ──
        // Remove script tags that load from known ad domains
        const adDomains = [
            'popads', 'popcash', 'propellerads', 'juicyads', 'exoclick', 'exosrv',
            'hilltopads', 'adsterra', 'monetag', 'clickadu', 'trafficjunky',
            'trafficstars', 'admaven', 'ad-maven', 'revcontent', 'mgid', 'outbrain',
            'taboola', 'googlesyndication', 'googleadservices', 'doubleclick',
            'adnxs', 'adsrvr', 'dolohen', 'onclkds', 'surfe\\.pro', 'acint\\.net',
            'pushame', 'richpush', 'push\\.house', 'tsyndicate', 'magsrv',
            'syndication\\.realsrv', 'bannedcontent', 'landingtracker',
            'coinhive', 'coin-hive', 'minero', 'cryptoloot', 'authedmine',
            'notifpush', 'pushwoosh', 'sendpulse', 'izooto', 'webpushr',
            'hotjar', 'mc\\.yandex', 'top\\.mail\\.ru', 'whos\\.amung',
            'disqus', 'facebook\\.net.*sdk', 'connect\\.facebook',
            'adf\\.ly', 'shorte\\.st', 'linkvertise', 'ouo\\.io'
        ];
        const adDomainPattern = adDomains.join('|');

        // Remove scripts that reference ad domains
        html = html.replace(/<script[^>]*src\s*=\s*["'][^"']*(?:${adDomainPattern})[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '<!-- ad script removed -->');
        html = html.replace(new RegExp(`<script[^>]*src\\s*=\\s*["'][^"']*(?:${adDomainPattern})[^"']*["'][^>]*>([\\s\\S]*?)<\\/script>`, 'gi'), '<!-- ad script removed -->');
        html = html.replace(new RegExp(`<script[^>]*src\\s*=\\s*["'][^"']*(?:${adDomainPattern})[^"']*["'][^>]*\\/?>`, 'gi'), '<!-- ad script removed -->');

        // Remove inline scripts with ad-related patterns
        const adScriptPatterns = [
            /window\.open\s*\(/gi,
            /window\.location\s*[=]/gi,
            /document\.location\s*[=]/gi,
            /popunder/gi,
            /pop_under/gi,
            /popUnder/gi,
            /pop_new/gi,
            /pop_cb/gi,
            /interstitial/gi,
            /clickunder/gi,
        ];
        html = html.replace(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi, (match, content) => {
            // Check if this inline script contains ad patterns
            for (const pattern of adScriptPatterns) {
                if (pattern.test(content)) {
                    pattern.lastIndex = 0;
                    return '<!-- ad inline script removed -->';
                }
            }
            // Check for window.open, pop-ups, redirectors
            if (/\bopen\s*\(\s*['"][^'"]*['"].*['"]_blank['"]/i.test(content)) {
                return '<!-- popup script removed -->';
            }
            return match;
        });

        // Remove ad iframes (small/hidden iframes commonly used for ads)
        html = html.replace(/<iframe[^>]*(?:width\s*=\s*["']?[01]["']?|height\s*=\s*["']?[01]["']?|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/iframe>/gi, '<!-- ad iframe removed -->');
        html = html.replace(new RegExp(`<iframe[^>]*src\\s*=\\s*["'][^"']*(?:${adDomainPattern})[^"']*["'][^>]*>[\\s\\S]*?<\\/iframe>`, 'gi'), '<!-- ad iframe removed -->');

        // Remove ad-related div containers
        html = html.replace(/<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:ad-container|ad-wrapper|ad-overlay|popup-overlay|modal-ad|interstitial|preroll)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '<!-- ad div removed -->');

        // Remove noscript ad tags
        html = html.replace(/<noscript[^>]*>[\s\S]*?(?:ad|track|pixel|analytics)[\s\S]*?<\/noscript>/gi, '<!-- ad noscript removed -->');

        // ── Inject ad-blocking CSS & JS at the end of <head> ──
        const adBlockCSS = `
<style id="filmplus-adblock">
    /* Hide common ad containers */
    [class*="ad-"], [class*="ads-"], [class*="advert"],
    [id*="ad-"], [id*="ads-"], [id*="advert"],
    [class*="popup"], [class*="modal-ad"], [class*="overlay-ad"],
    [class*="banner-ad"], [class*="interstitial"],
    [class*="preroll"], [class*="sponsor"],
    iframe[src*="ad"], iframe[src*="pop"],
    .ad, .ads, .adsbygoogle, #ad, #ads,
    div[data-ad], div[data-ads],
    a[target="_blank"][rel*="nofollow"][href*="://"] {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
    }
    /* Prevent fixed/absolute positioned ad overlays */
    body > div[style*="z-index"]:not([class*="player"]):not([id*="player"]):not([class*="video"]):not([id*="video"]) {
        pointer-events: none !important;
    }
    /* Allow the actual video player to work */
    video, .jw-wrapper, .plyr, .vjs-tech, #player, .video-js,
    [class*="player"], [id*="player"] {
        pointer-events: auto !important;
    }
</style>`;

        const adBlockJS = `
<script id="filmplus-adblock-js">
(function() {
    'use strict';
    // Override window.open to prevent popups
    const origOpen = window.open;
    window.open = function() { return null; };

    // Block common popup/redirect techniques
    Object.defineProperty(document, 'onclick', { set: function() {}, get: function() { return null; } });

    // Prevent click hijacking at the document level
    document.addEventListener('click', function(e) {
        const target = e.target;
        // Allow clicks on video elements and player controls
        if (target.closest('video, .jw-wrapper, .plyr, .video-js, [class*="player"], [id*="player"], button, .vjs-control, .jw-icon, .plyr__control')) {
            return;
        }
        // Block clicks on suspicious links/overlays
        if (target.tagName === 'A' && target.target === '_blank') {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // Remove elements created dynamically that match ad patterns
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType !== 1) return;
                // Remove ad iframes
                if (node.tagName === 'IFRAME') {
                    const src = (node.src || '').toLowerCase();
                    if (src.includes('ad') || src.includes('pop') || src.includes('banner') ||
                        src.includes('track') || !src.includes(location.hostname)) {
                        // Only remove if it's not the main player iframe
                        if (!node.closest('[class*="player"], [id*="player"]') &&
                            node.width < 10 || node.height < 10 ||
                            getComputedStyle(node).display === 'none') {
                            node.remove();
                        }
                    }
                }
                // Remove popup overlays
                if (node.tagName === 'DIV') {
                    const style = getComputedStyle(node);
                    const zIndex = parseInt(style.zIndex) || 0;
                    if (zIndex > 9000 && style.position === 'fixed' &&
                        !node.closest('[class*="player"], [id*="player"]')) {
                        node.remove();
                    }
                }
                // Remove ad scripts added dynamically
                if (node.tagName === 'SCRIPT' && node.src) {
                    const adKeywords = ['pop', 'ads', 'advert', 'banner', 'track', 'analytics', 'syndication', 'monetag', 'propeller'];
                    if (adKeywords.some(k => node.src.toLowerCase().includes(k))) {
                        node.remove();
                    }
                }
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Intercept and block event listeners on body/document that trigger popups
    const origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if ((type === 'click' || type === 'mousedown' || type === 'mouseup' || type === 'pointerdown') &&
            (this === document || this === document.body || this === window)) {
            const listenerStr = listener.toString();
            if (listenerStr.includes('open(') || listenerStr.includes('window.location') ||
                listenerStr.includes('document.location') || listenerStr.includes('_blank')) {
                return; // Don't register this ad click handler
            }
        }
        return origAddEventListener.call(this, type, listener, options);
    };
})();
</script>`;

        // Inject into <head>
        if (html.includes('</head>')) {
            html = html.replace('</head>', adBlockCSS + adBlockJS + '</head>');
        } else {
            html = adBlockCSS + adBlockJS + html;
        }

        // Set base URL so relative resources load from the original domain
        if (!html.includes('<base')) {
            const baseTag = `<base href="${parsedUrl.origin}/">`;
            if (html.includes('<head>')) {
                html = html.replace('<head>', '<head>' + baseTag);
            } else if (html.includes('<HEAD>')) {
                html = html.replace('<HEAD>', '<HEAD>' + baseTag);
            } else {
                html = baseTag + html;
            }
        }

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('X-Frame-Options', 'ALLOWALL');
        res.send(html);
    } catch (e) {
        console.error('Embed proxy error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── MorphTV / TeaTV Scraper API ───
app.get('/api/morphtv/search', async (req, res) => {
    try {
        const { title, year, season = 0, episode = 0, type = 0 } = req.query;
        if (!title) return res.status(400).json({ error: 'Title required' });
        const ts = Math.floor(Date.now() / 1000).toString();
        const hashStr = `${title}&${year}&${season}&${episode}&${ts}${MORPHTV_SECRET}`;
        const abc = crypto.createHash('md5').update(hashStr).digest('hex');
        const params = { title, year, season, episode, ts, abc };
        if (parseInt(type) === 1) {
            const altHashStr = `${title}&&${season}&${episode}&${ts}${MORPHTV_SECRET}`;
            params.abc = crypto.createHash('md5').update(altHashStr).digest('hex');
        }
        const url = `${MORPHTV_API}?${new URLSearchParams(params)}`;
        const response = await fetch(url);
        if (!response.ok) return res.json({ links: [] });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json({ links: [] }); }
});

app.get('/api/teatv/search', async (req, res) => {
    try {
        const { id, imdbId, title, year, season, episode } = req.query;
        const lookupId = id || imdbId || '';
        if (!lookupId && !title) return res.status(400).json({ error: 'ID or title required' });
        let url;
        if (lookupId) {
            url = `${TEATV_API}?id=${lookupId}`;
        } else {
            url = `${TEATV_API}?title=${encodeURIComponent(title)}&year=${year || ''}`;
        }
        if (season && episode) url += `&season=${season}&episode=${episode}`;
        const response = await fetch(url, { timeout: 8000 });
        if (!response.ok) return res.json({ links: [], data: [] });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.json({ links: [], data: [] }); }
});

// ─── Trakt.tv API ───
app.get('/api/trakt/:endpoint(*)', async (req, res) => {
    try {
        const url = `https://api.trakt.tv/${req.params.endpoint}`;
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': TRAKT_KEY
            }
        });
        if (!response.ok) return res.status(response.status).json({ error: 'Trakt API error' });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Addon Config (loads dynamic provider/host list) ───
app.get('/api/addon-config', async (req, res) => {
    try {
        const url = `${ADDON_CONFIG_URL}?v=${new Date().getHours()}`;
        const response = await fetch(url);
        if (!response.ok) return res.status(500).json({ error: 'Config fetch failed' });
        const data = await response.json();
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Addon List (providers + hosts) ───
app.get('/api/addon-list', async (req, res) => {
    try {
        const configRes = await fetch(`${ADDON_CONFIG_URL}?v=${new Date().getHours()}`);
        const config = await configRes.json();
        if (config.addon_list) {
            const listRes = await fetch(config.addon_list);
            const list = await listRes.json();
            res.json(list);
        } else {
            res.json({ providers: {}, hosts: {} });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── VTT Subtitle Files ───
app.get('/api/vtt-subtitles', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const fullUrl = url.startsWith('http') ? url : `${VTT_FILES_URL}${url}`;
        const response = await fetch(fullUrl);
        const text = await response.text();
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        if (!text.startsWith('WEBVTT')) {
            res.send('WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'));
        } else {
            res.send(text);
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API Keys Info (for frontend) ───
app.get('/api/keys-info', (req, res) => {
    res.json({
        tmdb: !!TMDB_KEY && TMDB_KEY !== 'YOUR_TMDB_API_KEY_HERE',
        opensubtitles: !!OPENSUBTITLES_KEY,
        trakt: !!TRAKT_KEY,
        morphtv: !!MORPHTV_API,
        teatv: !!TEATV_API,
        flixanity: !!FLIXANITY_API,
        stremio_opensub: !!STREMIO_OPENSUB_URL,
        subdl: !!SUBDL_API,
        subsource: !!SUBSOURCE_API,
        addon_config: !!ADDON_CONFIG_URL
    });
});

// ─── Source Providers Configuration (sorted by quality) ───
// providers with directStream: true will try server-side stream extraction first
const SOURCE_PROVIDERS = [
    { id: 'vidsrc2', name: 'VidSrc Pro', quality: '4K', maxRes: 2160, priority: 1 },
    { id: 'vidsrcicu', name: 'VidSrc ICU', quality: '4K', maxRes: 2160, priority: 2 },
    { id: 'autoembed', name: 'AutoEmbed', quality: '1080P', maxRes: 1080, priority: 3 },
    { id: 'autoembedcc', name: 'AutoEmbed CC', quality: '1080P', maxRes: 1080, priority: 4 },
    { id: 'multiembed', name: 'MultiEmbed', quality: '1080P', maxRes: 1080, priority: 5 },
    { id: 'vidsrc', name: 'VidSrc', quality: '1080P', maxRes: 1080, priority: 6 },
    { id: 'smashystream', name: 'SmashyStream', quality: '1080P', maxRes: 1080, priority: 7 },
    { id: 'embed', name: '2Embed', quality: '1080P', maxRes: 1080, priority: 8 },
    { id: 'vidsrccc', name: 'VidSrc CC', quality: '1080P', maxRes: 1080, priority: 9 },
    { id: 'morphtv', name: 'MorphTV', quality: '720P', maxRes: 720, priority: 10, apiOnly: true },
    { id: 'teatv', name: 'TeaTV', quality: '720P', maxRes: 720, priority: 11, apiOnly: true },
];

function getEmbedUrl(providerId, tmdbId, type, season, episode, imdbId) {
    switch (providerId) {
        case 'vidsrc':
            if (type === 'tv') return `https://vidsrc.xyz/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.xyz/embed/movie/${tmdbId}`;
        case 'vidsrc2':
            if (type === 'tv') return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.to/embed/movie/${tmdbId}`;
        case 'vidsrcicu':
            if (type === 'tv') return `https://vidsrc.icu/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.icu/embed/movie/${tmdbId}`;
        case 'vidsrccc':
            if (type === 'tv') return `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.cc/v2/embed/movie/${tmdbId}`;
        case 'embed':
            if (type === 'tv') return `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`;
            return `https://www.2embed.cc/embed/${tmdbId}`;
        case 'multiembed':
            if (type === 'tv') return `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
            return `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1`;
        case 'morphtv':
            return null;
        case 'teatv':
            return null;
        case 'autoembed':
            if (type === 'tv') return `https://autoembed.co/tv/tmdb/${tmdbId}-${season}-${episode}`;
            return `https://autoembed.co/movie/tmdb/${tmdbId}`;
        case 'autoembedcc':
            if (type === 'tv') return `https://player.autoembed.cc/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://player.autoembed.cc/embed/movie/${tmdbId}`;
        case 'smashystream':
            if (type === 'tv') return `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
            return `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}`;
        default:
            return null;
    }
}

// ─── Server-side Stream Extraction via MoviesAPI + FlixCDN ───
// Fetches video metadata from moviesapi.to, decrypts FlixCDN response to get direct HLS URLs

const FLIXCDN_KEY = Buffer.from('kiemtienmua911ca', 'utf8');
const FLIXCDN_IV  = Buffer.from('1234567890oiuytr', 'utf8');

function decryptFlixcdn(hexData) {
    const encData = Buffer.from(hexData.trim(), 'hex');
    const decipher = crypto.createDecipheriv('aes-128-cbc', FLIXCDN_KEY, FLIXCDN_IV);
    let decrypted = decipher.update(encData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

const STREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function extractStreamFromMoviesAPI(tmdbId, type, season, episode) {
    // Step 1: Get video hash from moviesapi.to
    let apiUrl;
    if (type === 'tv' && season && episode) {
        apiUrl = `https://ww2.moviesapi.to/api/tv/${tmdbId}/${season}/${episode}`;
    } else {
        apiUrl = `https://ww2.moviesapi.to/api/movie/${tmdbId}`;
    }

    const metaRes = await fetch(apiUrl, {
        headers: { 'User-Agent': STREAM_UA, 'Referer': 'https://ww2.moviesapi.to/' }
    });
    if (!metaRes.ok) throw new Error(`moviesapi returned ${metaRes.status}`);
    const meta = await metaRes.json();

    if (!meta.video_url) throw new Error('No video_url in moviesapi response');

    // Extract video hash from flixcdn URL: https://flixcdn.cyou/#HASH&poster=...
    const hashMatch = meta.video_url.match(/#([^&]+)/);
    if (!hashMatch) throw new Error('Could not extract video hash from URL');
    const videoId = hashMatch[1];

    // Step 2: Fetch encrypted video data from flixcdn
    const videoRes = await fetch(`https://flixcdn.cyou/api/v1/video?id=${videoId}`, {
        headers: {
            'User-Agent': STREAM_UA,
            'Referer': 'https://flixcdn.cyou/',
            'Origin': 'https://flixcdn.cyou',
        }
    });
    if (!videoRes.ok) throw new Error(`flixcdn returned ${videoRes.status}`);
    const encryptedHex = await videoRes.text();

    // Step 3: Decrypt AES-128-CBC
    const decrypted = decryptFlixcdn(encryptedHex);
    const videoData = JSON.parse(decrypted);

    // Step 4: Pick the best stream URL
    // Priority: source (direct IP HLS) > hlsVideoTiktok (TikTok CDN) > cf (Cloudflare CDN)
    let streamUrl = null;
    let streamType = 'hls';

    if (videoData.source) {
        streamUrl = videoData.source;
    } else if (videoData.hlsVideoTiktok) {
        // hlsVideoTiktok is relative, needs flixcdn origin
        streamUrl = videoData.hlsVideoTiktok.startsWith('http')
            ? videoData.hlsVideoTiktok
            : `https://flixcdn.cyou${videoData.hlsVideoTiktok}`;
    } else if (videoData.cf) {
        streamUrl = videoData.cf;
    }

    if (!streamUrl) throw new Error('No stream URL in decrypted data');

    // Step 5: Extract subtitles
    const subtitles = [];
    if (videoData.subtitle && typeof videoData.subtitle === 'object') {
        for (const [lang, subPath] of Object.entries(videoData.subtitle)) {
            const subUrl = subPath.startsWith('http') ? subPath : `https://flixcdn.cyou${subPath}`;
            subtitles.push({ lang, label: lang.toUpperCase(), url: subUrl });
        }
    }

    // Also include OpenSubtitles subs from moviesapi response
    if (meta.subs && Array.isArray(meta.subs)) {
        for (const sub of meta.subs) {
            if (sub.url) {
                subtitles.push({ lang: sub.lang || 'en', label: sub.label || sub.lang || 'Sub', url: sub.url });
            }
        }
    }

    return { streamUrl, streamType, subtitles, title: meta.title || videoData.title };
}

// ─── Server-side Stream Extraction via VidSrc Scraper ───
async function extractStreamFromVidsrc(tmdbId, type, season, episode) {
    if (!scrapeVidsrc) throw new Error('VidSrc scraper not loaded');
    
    const result = type === 'tv' && season && episode
        ? await scrapeVidsrc(parseInt(tmdbId), 'tv', parseInt(season), parseInt(episode))
        : await scrapeVidsrc(parseInt(tmdbId), 'movie');
    
    if (!result.success || !result.hlsUrl) throw new Error('VidSrc scraper returned no stream');
    
    return {
        streamUrl: result.hlsUrl,
        streamType: 'hls',
        subtitles: (result.subtitles || []).map(s => ({
            lang: s.lang || 'en',
            label: s.label || s.lang || 'Sub',
            url: s.url || s
        })),
        title: ''
    };
}

// ─── Server-side Stream Extraction via VidSrc.icu page scraping ───
async function extractStreamFromVidsrcICU(tmdbId, type, season, episode) {
    let embedUrl;
    if (type === 'tv' && season && episode) {
        embedUrl = `https://vidsrc.icu/embed/tv/${tmdbId}/${season}/${episode}`;
    } else {
        embedUrl = `https://vidsrc.icu/embed/movie/${tmdbId}`;
    }
    
    const pageRes = await fetch(embedUrl, {
        headers: { 'User-Agent': STREAM_UA, 'Referer': 'https://vidsrc.icu/' }
    });
    if (!pageRes.ok) throw new Error(`vidsrc.icu returned ${pageRes.status}`);
    const html = await pageRes.text();
    
    // Look for m3u8 URL in the page source
    const m3u8Match = html.match(/(?:file|source|src)\s*[:=]\s*['"]([^'"]*\.m3u8[^'"]*)['"]/i) ||
                      html.match(/(https?:\/\/[^\s'"]+\.m3u8[^\s'"]*)/i);
    if (m3u8Match) {
        return { streamUrl: m3u8Match[1], streamType: 'hls', subtitles: [], title: '' };
    }
    
    // Look for iframe src that might contain the actual player
    const iframeMatch = html.match(/iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
        const innerUrl = iframeMatch[1].startsWith('//') ? 'https:' + iframeMatch[1] : iframeMatch[1];
        const innerRes = await fetch(innerUrl, {
            headers: { 'User-Agent': STREAM_UA, 'Referer': embedUrl }
        });
        if (innerRes.ok) {
            const innerHtml = await innerRes.text();
            const innerM3u8 = innerHtml.match(/(?:file|source|src)\s*[:=]\s*['"]([^'"]*\.m3u8[^'"]*)['"]/i) ||
                              innerHtml.match(/(https?:\/\/[^\s'"]+\.m3u8[^\s'"]*)/i);
            if (innerM3u8) {
                return { streamUrl: innerM3u8[1], streamType: 'hls', subtitles: [], title: '' };
            }
        }
    }
    
    throw new Error('No m3u8 found in vidsrc.icu page');
}

// ─── Multi-Extractor Chain ───
// Tries multiple extraction methods in order, returns first success
async function extractStreamMulti(tmdbId, type, season, episode) {
    const extractors = [
        { name: 'moviesapi-flixcdn', fn: () => extractStreamFromMoviesAPI(tmdbId, type, season, episode) },
        { name: 'vidsrc-scraper', fn: () => extractStreamFromVidsrc(tmdbId, type, season, episode) },
        { name: 'vidsrc-icu', fn: () => extractStreamFromVidsrcICU(tmdbId, type, season, episode) },
    ];
    
    const errors = [];
    for (const ext of extractors) {
        try {
            const result = await ext.fn();
            if (result && result.streamUrl) {
                console.log(`[Extract] ${ext.name} succeeded for ${type}/${tmdbId}`);
                return { ...result, source: ext.name };
            }
        } catch (e) {
            console.log(`[Extract] ${ext.name} failed: ${e.message}`);
            errors.push(`${ext.name}: ${e.message}`);
        }
    }
    
    throw new Error(`All extractors failed: ${errors.join('; ')}`);
}

app.get('/api/extract-stream', async (req, res) => {
    const { tmdbId, type, season, episode } = req.query;
    if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });

    try {
        const result = await extractStreamMulti(
            tmdbId,
            type || 'movie',
            season || null,
            episode || null
        );

        // Proxy the stream URL through our server to avoid CORS
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(result.streamUrl)}`;

        // Proxy subtitle URLs too
        const proxiedSubs = (result.subtitles || []).map(sub => ({
            lang: sub.lang,
            label: sub.label,
            url: `/api/subtitle-file?url=${encodeURIComponent(sub.url)}`
        }));

        res.json({
            success: true,
            hlsUrl: proxiedUrl,
            directUrl: result.streamUrl,
            subtitles: proxiedSubs,
            source: result.source,
        });
    } catch (e) {
        console.error('Extract stream error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ─── HLS/Video Proxy (to bypass CORS for extracted streams) ───
app.get('/api/stream-proxy', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });
        
        const parsedUrl = new URL(url);

        // Determine correct Referer — flixcdn streams (direct IP CDN) require flixcdn.cyou referer
        let referer = parsedUrl.origin + '/';
        let origin = parsedUrl.origin;
        const isFlixcdnStream = /^\d+\.\d+\.\d+\.\d+$/.test(parsedUrl.hostname) || 
                                parsedUrl.hostname.includes('flixcdn') ||
                                parsedUrl.hostname.includes('tiktokcdn');
        if (isFlixcdnStream) {
            referer = 'https://flixcdn.cyou/';
            origin = 'https://flixcdn.cyou';
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': referer,
                'Origin': origin
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.status(response.status).send('Stream unavailable');
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.set('Content-Type', contentType);
        res.set('Access-Control-Allow-Origin', '*');
        
        // For m3u8 playlists, rewrite ALL URLs to go through our proxy
        if (url.includes('.m3u8') || url.includes('cf-master') || contentType.includes('mpegurl') || contentType.includes('m3u8')) {
            let playlist = await response.text();
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

            function resolveUrl(rawUrl) {
                if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
                if (rawUrl.startsWith('/')) return `${parsedUrl.origin}${rawUrl}`;
                return `${baseUrl}${rawUrl}`;
            }
            
            // Rewrite every non-comment, non-empty line (segments can be .ts, .html, or anything)
            // Also rewrite URI= attributes in #EXT-X-MAP and #EXT-X-KEY tags
            playlist = playlist.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // Rewrite URI= in EXT tags (e.g. EXT-X-MAP, EXT-X-KEY)
                if (trimmed.startsWith('#') && trimmed.includes('URI=')) {
                    return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                        const abs = resolveUrl(uri);
                        return `URI="${'/api/stream-proxy?url=' + encodeURIComponent(abs)}"`;
                    });
                }

                if (trimmed.startsWith('#')) return line;
                
                const absoluteUrl = resolveUrl(trimmed);
                return `/api/stream-proxy?url=${encodeURIComponent(absoluteUrl)}`;
            }).join('\n');
            
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(playlist);
        } else {
            // For .ts segments and other binary data, pipe directly
            const buffer = await response.buffer();
            res.send(buffer);
        }
    } catch (e) {
        console.error('Stream proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

app.get('/api/sources', (req, res) => {
    res.json(SOURCE_PROVIDERS);
});

app.get('/api/source-url', (req, res) => {
    const { provider, tmdbId, type, season, episode, imdbId } = req.query;
    if (provider === 'morphtv' || provider === 'teatv') {
        return res.json({ url: null, apiProvider: provider, note: `Use /api/${provider}/search endpoint` });
    }
    const url = getEmbedUrl(provider, tmdbId, type, season, episode, imdbId);
    if (!url) return res.status(404).json({ error: 'Provider not found' });
    res.json({ url });
});

// ─── SPA Fallback ───
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n  ✦ FilmPlus Web running at http://localhost:${PORT}\n`);
    const keys = {
        'TMDB': TMDB_KEY && TMDB_KEY !== 'YOUR_TMDB_API_KEY_HERE',
        'OpenSubtitles': !!OPENSUBTITLES_KEY,
        'Trakt.tv': !!TRAKT_KEY,
        'MorphTV': !!MORPHTV_API,
        'TeaTV': !!TEATV_API,
        'Flixanity': !!FLIXANITY_API,
        'SubDL': !!SUBDL_API,
        'Stremio OSub': !!STREMIO_OPENSUB_URL,
        'Addon Config': !!ADDON_CONFIG_URL,
    };
    console.log('  API Keys Status:');
    for (const [name, loaded] of Object.entries(keys)) {
        console.log(`    ${loaded ? '✓' : '✗'} ${name}`);
    }
    console.log('');
});
