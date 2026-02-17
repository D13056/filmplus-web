require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

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
const SOURCE_PROVIDERS = [
    { id: 'vidsrc2', name: 'VidSrc 2', quality: '4K', maxRes: 2160, priority: 1 },
    { id: 'vidsrc', name: 'VidSrc', quality: '1080P', maxRes: 1080, priority: 2 },
    { id: 'vidsrcme', name: 'VidSrc.me v2', quality: '1080P', maxRes: 1080, priority: 3 },
    { id: 'autoembed', name: 'AutoEmbed', quality: '1080P', maxRes: 1080, priority: 4 },
    { id: 'multiembed', name: 'MultiEmbed', quality: '1080P', maxRes: 1080, priority: 5 },
    { id: 'embed', name: '2Embed', quality: '1080P', maxRes: 1080, priority: 6 },
    { id: 'smashystream', name: 'SmashyStream', quality: '1080P', maxRes: 1080, priority: 7 },
    { id: 'morphtv', name: 'MorphTV', quality: '720P', maxRes: 720, priority: 8, apiOnly: true },
    { id: 'teatv', name: 'TeaTV', quality: '720P', maxRes: 720, priority: 9, apiOnly: true },
];

function getEmbedUrl(providerId, tmdbId, type, season, episode, imdbId) {
    switch (providerId) {
        case 'vidsrc':
            if (type === 'tv') return `https://vidsrc.xyz/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.xyz/embed/movie/${tmdbId}`;
        case 'vidsrc2':
            if (type === 'tv') return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`;
            return `https://vidsrc.to/embed/movie/${tmdbId}`;
        case 'vidsrcme':
            if (type === 'tv') return `https://v2.vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
            return `https://v2.vidsrc.me/embed/movie?tmdb=${tmdbId}`;
        case 'embed':
            if (type === 'tv') return `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`;
            return `https://www.2embed.cc/embed/${tmdbId}`;
        case 'multiembed':
            if (type === 'tv') return `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
            return `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1`;
        case 'morphtv':
            return null; // Handled via /api/morphtv/search
        case 'teatv':
            return null; // Handled via /api/teatv/search
        case 'autoembed':
            if (type === 'tv') return `https://autoembed.co/tv/tmdb/${tmdbId}-${season}-${episode}`;
            return `https://autoembed.co/movie/tmdb/${tmdbId}`;
        case 'smashystream':
            if (type === 'tv') return `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
            return `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}`;
        default:
            return null;
    }
}

app.get('/api/sources', (req, res) => {
    res.json(SOURCE_PROVIDERS);
});

app.get('/api/source-url', (req, res) => {
    const { provider, tmdbId, type, season, episode, imdbId } = req.query;
    const url = getEmbedUrl(provider, tmdbId, type, season, episode, imdbId);
    if (provider === 'morphtv' || provider === 'teatv') {
        return res.json({ url: null, apiProvider: provider, note: `Use /api/${provider}/search endpoint` });
    }
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
