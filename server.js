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

// FlixHQ via @consumet/extensions
let FlixHQ = null;
try {
    const { MOVIES } = require('@consumet/extensions');
    FlixHQ = new MOVIES.FlixHQ();
    console.log('  ✓ FlixHQ extractor loaded');
} catch(e) {
    console.warn('  ✗ FlixHQ not available:', e.message);
}

// In-memory cache for TMDB title lookups (avoids repeat API calls)
const tmdbTitleCache = new Map();

// Per-hostname cache: CDN hosts that reject Referer headers
// When a segment fetch returns 403 and succeeds without Referer, the host is
// added here so subsequent requests skip the Referer immediately.
const noRefererHosts = new Set();

// ─── Stream URL Obfuscation ───
// Encode/decode stream URLs so real CDN URLs are hidden from browser Network tab
const STREAM_KEY = crypto.randomBytes(16).toString('hex'); // Random key per server instance
function encodeStreamUrl(url) {
    const cipher = crypto.createCipheriv('aes-128-cbc', 
        Buffer.from(STREAM_KEY, 'hex'), 
        Buffer.alloc(16, 0));
    let enc = cipher.update(url, 'utf8', 'base64url');
    enc += cipher.final('base64url');
    return enc;
}
function decodeStreamUrl(encoded) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', 
        Buffer.from(STREAM_KEY, 'hex'), 
        Buffer.alloc(16, 0));
    let dec = decipher.update(encoded, 'base64url', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

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
    // Prevent framing by external sites
    res.set('X-Frame-Options', 'SAMEORIGIN');
    // Prevent MIME type sniffing
    res.set('X-Content-Type-Options', 'nosniff');
    // XSS protection
    res.set('X-XSS-Protection', '1; mode=block');
    // Referrer policy — allow origin so YouTube embeds work (Error 153 fix)
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy — restrict what can be loaded
    res.set('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' https://image.tmdb.org data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
        "object-src 'none'",
        "base-uri 'self'"
    ].join('; '));
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

// Block access to sensitive files
app.use((req, res, next) => {
    const blocked = ['.env', 'server.js', 'package.json', 'package-lock.json', 'node_modules'];
    const lowerPath = req.path.toLowerCase();
    if (blocked.some(f => lowerPath.includes(f))) {
        return res.status(404).send('Not Found');
    }
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
        const { page = 1, genre, year, sort_by, language } = req.query;
        const params = { page };
        if (genre) params.with_genres = genre;
        if (language) params.with_original_language = language;
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

// ─── Source Providers Configuration ───
// ALL sources use server-side stream extraction — no iframes, no ads
const SOURCE_PROVIDERS = [
    { id: 'moviesapi', name: 'Premium HD', quality: '4K', maxRes: 2160, priority: 1, extractor: 'moviesapi-flixcdn' },
    { id: 'vidsrc', name: 'VidSrc Pro', quality: '1080P', maxRes: 1080, priority: 2, extractor: 'vidsrc-scraper' },
    { id: 'vidsrcicu', name: 'VidSrc ICU', quality: '1080P', maxRes: 1080, priority: 3, extractor: 'vidsrc-icu' },
    { id: 'upcloud', name: 'UpCloud', quality: '720P', maxRes: 720, priority: 4, extractor: 'flixhq-upcloud' },
    { id: 'vidcloud', name: 'VidCloud', quality: '720P', maxRes: 720, priority: 5, extractor: 'flixhq-vidcloud' },
    { id: 'morphtv', name: 'MorphTV', quality: '720P', maxRes: 720, priority: 6, apiOnly: true },
    { id: 'teatv', name: 'TeaTV', quality: '720P', maxRes: 720, priority: 7, apiOnly: true },
];

// Map source IDs to their specific extractors
const EXTRACTOR_MAP = {
    'moviesapi': 'moviesapi-flixcdn',
    'vidsrc': 'vidsrc-scraper',
    'vidsrcicu': 'vidsrc-icu',
    'upcloud': 'flixhq-upcloud',
    'vidcloud': 'flixhq-vidcloud',
};

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

// ─── FlixHQ Stream Extraction via @consumet/extensions ───
// Searches FlixHQ by TMDB title, extracts m3u8 from UpCloud/VidCloud servers

async function getTmdbTitle(tmdbId, type) {
    const key = `${type}-${tmdbId}`;
    if (tmdbTitleCache.has(key)) return tmdbTitleCache.get(key);
    const url = `${TMDB_BASE}/${type === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_KEY}`;
    const res = await fetch(url, { headers: { 'User-Agent': STREAM_UA } });
    if (!res.ok) throw new Error(`TMDB returned ${res.status}`);
    const data = await res.json();
    const result = {
        title: data.title || data.name,
        year: (data.release_date || data.first_air_date || '').split('-')[0]
    };
    tmdbTitleCache.set(key, result);
    return result;
}

async function extractStreamFromFlixHQ(tmdbId, type, season, episode, server) {
    if (!FlixHQ) throw new Error('FlixHQ not loaded');
    
    // Get title from TMDB
    const { title, year } = await getTmdbTitle(tmdbId, type);
    if (!title) throw new Error('Could not get title from TMDB');
    
    // Search FlixHQ
    const results = await FlixHQ.search(title);
    if (!results?.results?.length) throw new Error('No results on FlixHQ');
    
    // Match by type and year
    let match;
    if (type === 'tv') {
        match = results.results.find(r => r.type === 'TV Series' && r.title?.toLowerCase() === title.toLowerCase());
        if (!match) match = results.results.find(r => r.type === 'TV Series');
    } else {
        match = results.results.find(r => r.type === 'Movie' && r.releaseDate === year);
        if (!match) match = results.results.find(r => r.type === 'Movie' && r.title?.toLowerCase() === title.toLowerCase());
        if (!match) match = results.results.find(r => r.type === 'Movie');
    }
    if (!match) throw new Error('No matching result on FlixHQ');
    
    // Get media info
    const info = await FlixHQ.fetchMediaInfo(match.id);
    
    let episodeId;
    if (type === 'tv' && season && episode) {
        const ep = info.episodes?.find(e => e.season === parseInt(season) && e.number === parseInt(episode));
        if (!ep) throw new Error(`S${season}E${episode} not found on FlixHQ`);
        episodeId = ep.id;
    } else {
        episodeId = info.episodes?.[0]?.id;
        if (!episodeId) throw new Error('No episode ID for movie on FlixHQ');
    }
    
    // Fetch sources from the requested server (upcloud or vidcloud)
    // Must pass match.id (e.g. 'movie/watch-...') as mediaId so the library
    // uses the correct movie endpoint instead of the TV-show endpoint.
    const sources = await FlixHQ.fetchEpisodeSources(episodeId, match.id, server);
    if (!sources?.sources?.length) throw new Error(`No sources from FlixHQ ${server}`);
    
    const m3u8 = sources.sources.find(s => s.isM3U8) || sources.sources[0];
    if (!m3u8?.url) throw new Error(`No m3u8 URL from FlixHQ ${server}`);
    
    // Extract subtitles
    const subtitles = (sources.subtitles || []).map(s => ({
        lang: s.lang || 'en',
        label: s.lang || 'Sub',
        url: s.url
    }));
    
    return {
        streamUrl: m3u8.url,
        streamType: 'hls',
        subtitles,
        title: title,
        // CDN needs just the origin as referer (not full embed URL path)
        referer: sources.headers?.Referer ? new URL(sources.headers.Referer).origin + '/' : 'https://streameeeeee.site/'
    };
}

// ─── Multi-Extractor Chain ───
// Tries multiple extraction methods in order, returns first success
async function extractStreamMulti(tmdbId, type, season, episode) {
    const extractors = [
        { name: 'moviesapi-flixcdn', fn: () => extractStreamFromMoviesAPI(tmdbId, type, season, episode) },
        { name: 'vidsrc-scraper', fn: () => extractStreamFromVidsrc(tmdbId, type, season, episode) },
        { name: 'vidsrc-icu', fn: () => extractStreamFromVidsrcICU(tmdbId, type, season, episode) },
        { name: 'flixhq-upcloud', fn: () => extractStreamFromFlixHQ(tmdbId, type, season, episode, 'upcloud') },
        { name: 'flixhq-vidcloud', fn: () => extractStreamFromFlixHQ(tmdbId, type, season, episode, 'vidcloud') },
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
    const { tmdbId, type, season, episode, source } = req.query;
    if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });

    try {
        let result;
        const t = type || 'movie';
        const s = season || null;
        const e = episode || null;

        // If specific source requested, use only that extractor
        if (source && EXTRACTOR_MAP[source]) {
            const extractorName = EXTRACTOR_MAP[source];
            const extractorFn = {
                'moviesapi-flixcdn': () => extractStreamFromMoviesAPI(tmdbId, t, s, e),
                'vidsrc-scraper': () => extractStreamFromVidsrc(tmdbId, t, s, e),
                'vidsrc-icu': () => extractStreamFromVidsrcICU(tmdbId, t, s, e),
                'flixhq-upcloud': () => extractStreamFromFlixHQ(tmdbId, t, s, e, 'upcloud'),
                'flixhq-vidcloud': () => extractStreamFromFlixHQ(tmdbId, t, s, e, 'vidcloud'),
            }[extractorName];
            if (!extractorFn) throw new Error(`Unknown extractor: ${extractorName}`);
            const r = await extractorFn();
            if (!r || !r.streamUrl) throw new Error(`${extractorName} returned no stream`);
            result = { ...r, source: extractorName };
        } else {
            // No specific source — try all extractors in chain
            result = await extractStreamMulti(tmdbId, t, s, e);
        }

        // Proxy the stream URL through our server to avoid CORS
        // Use encrypted URL token so real CDN URLs are hidden from browser Network tab
        let proxiedUrl = `/api/s/${encodeStreamUrl(result.streamUrl)}`;
        if (result.referer) {
            proxiedUrl += `?r=${encodeStreamUrl(result.referer)}`;
        }

        // Proxy subtitle URLs too
        const proxiedSubs = (result.subtitles || []).map(sub => ({
            lang: sub.lang,
            label: sub.label,
            url: `/api/subtitle-file?url=${encodeURIComponent(sub.url)}`
        }));

        res.json({
            success: true,
            hlsUrl: proxiedUrl,
            subtitles: proxiedSubs,
            source: result.source,
        });
    } catch (e) {
        console.error('Extract stream error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ─── HLS/Video Proxy (obfuscated URL format: /api/s/:token) ───
// Stream URLs are encrypted so they can't be seen in browser Network tab
app.get('/api/s/:token', async (req, res) => {
    try {
        const url = decodeStreamUrl(req.params.token);
        const customReferer = req.query.r ? decodeStreamUrl(req.query.r) : null;
        await handleStreamProxy(url, customReferer, res);
    } catch (e) {
        console.error('Stream proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

// Legacy stream proxy (kept for internal use only, m3u8 rewriting)
app.get('/api/stream-proxy', async (req, res) => {
    try {
        const { url, referer: customReferer } = req.query;
        if (!url) return res.status(400).json({ error: 'URL required' });
        await handleStreamProxy(url, customReferer, res);
    } catch (e) {
        console.error('Stream proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

async function handleStreamProxy(url, customReferer, res) {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;

        // Determine correct Referer:
        // 1. Custom referer from query param (e.g. FlixHQ CDNs need streameeeeee.site)
        // 2. FlixCDN streams (direct IP or flixcdn/tiktok CDN) need flixcdn.cyou
        // 3. Default to the target URL's origin
        let referer, origin;
        const isFlixcdnStream = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || 
                                hostname.includes('flixcdn') ||
                                hostname.includes('tiktokcdn');
        if (customReferer) {
            referer = customReferer;
            origin = new URL(customReferer).origin;
        } else if (isFlixcdnStream) {
            referer = 'https://flixcdn.cyou/';
            origin = 'https://flixcdn.cyou';
        } else {
            referer = parsedUrl.origin + '/';
            origin = parsedUrl.origin;
        }

        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        };

        // Some CDNs (e.g. VidSrc segment hosts) actively reject requests that include
        // a Referer header.  We keep a per-hostname cache so we only pay the retry
        // cost once: the first 403 triggers a no-referer retry, and if it succeeds we
        // remember the host for the rest of the server's lifetime.
        const skipReferer = noRefererHosts.has(hostname);
        const headers = { ...baseHeaders };
        if (!skipReferer) {
            headers['Referer'] = referer;
            headers['Origin'] = origin;
        }

        let response = await fetch(url, { headers, redirect: 'follow', timeout: 15000 });

        // If 403 and we sent Referer, retry without Referer/Origin
        // (VidSrc segment CDNs like comityofcognomen.site reject any Referer)
        if (response.status === 403 && !skipReferer) {
            response = await fetch(url, { headers: baseHeaders, redirect: 'follow', timeout: 15000 });
            if (response.ok) {
                noRefererHosts.add(hostname);
                console.log(`[Proxy] Host ${hostname} rejects Referer — cached for future requests`);
            }
        }

        if (!response.ok) {
            return res.status(response.status).send('Stream unavailable');
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Headers', 'Range');
        res.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
        
        // Propagate referer param for sub-requests (m3u8 → segment URLs)
        // Use obfuscated /api/s/ format for all rewritten URLs
        const refererSuffix = customReferer ? `?r=${encodeStreamUrl(customReferer)}` : '';
        
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
                        return `URI="${'/api/s/' + encodeStreamUrl(abs) + refererSuffix}"`;
                    });
                }

                if (trimmed.startsWith('#')) return line;
                
                const absoluteUrl = resolveUrl(trimmed);
                return `/api/s/${encodeStreamUrl(absoluteUrl)}${refererSuffix}`;
            }).join('\n');
            
            // Short cache for playlists — variant m3u8 rarely changes
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.set('Cache-Control', 'public, max-age=300');
            res.send(playlist);
        } else {
            // For .ts segments and other binary data — STREAM directly (no buffering)
            // This is critical for reducing latency: data flows to client as it arrives
            const contentLength = response.headers.get('content-length');
            if (contentLength) res.set('Content-Length', contentLength);
            // Force correct video content-type even if CDN disguises as image
            // (some CDNs like UpCloud return image/jpg for .ts segments)
            res.set('Content-Type', 'video/MP2T');
            // Cache segments aggressively — they never change
            res.set('Cache-Control', 'public, max-age=86400, immutable');
            response.body.pipe(res);
        }
}

app.get('/api/sources', (req, res) => {
    res.json(SOURCE_PROVIDERS);
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
