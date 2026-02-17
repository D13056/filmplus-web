/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - API Module
   Handles all TMDB API communication through the backend
   ═══════════════════════════════════════════════════════════ */

const API = {
    BASE: '',
    IMG: 'https://image.tmdb.org/t/p',

    // Image size helpers
    poster: (path) => path ? `${API.IMG}/w342${path}` : '/img/no-poster.svg',
    posterLg: (path) => path ? `${API.IMG}/w500${path}` : '/img/no-poster.svg',
    backdrop: (path) => path ? `${API.IMG}/original${path}` : '',
    backdropMd: (path) => path ? `${API.IMG}/w1280${path}` : '',
    profile: (path) => path ? `${API.IMG}/w185${path}` : '/img/no-avatar.svg',

    // Cache
    _cache: new Map(),
    _cacheTTL: 5 * 60 * 1000, // 5 min

    async _fetch(endpoint) {
        const cacheKey = endpoint;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.time < this._cacheTTL) {
            return cached.data;
        }
        const res = await fetch(`${this.BASE}${endpoint}`);
        if (!res.ok) throw new Error(`API Error ${res.status}`);
        const data = await res.json();
        this._cache.set(cacheKey, { data, time: Date.now() });
        return data;
    },

    // ─── Trending ───
    async getTrending(type = 'all', window = 'week', page = 1) {
        return this._fetch(`/api/trending/${type}/${window}?page=${page}`);
    },

    // ─── Categories ───
    async getPopular(type, page = 1) {
        return this._fetch(`/api/${type}/popular?page=${page}`);
    },
    async getTopRated(type, page = 1) {
        return this._fetch(`/api/${type}/top_rated?page=${page}`);
    },
    async getNowPlaying(page = 1) {
        return this._fetch(`/api/movie/now_playing?page=${page}`);
    },
    async getAiringToday(page = 1) {
        return this._fetch(`/api/tv/airing_today?page=${page}`);
    },
    async getUpcoming(page = 1) {
        return this._fetch(`/api/movie/upcoming?page=${page}`);
    },
    async getOnTheAir(page = 1) {
        return this._fetch(`/api/tv/on_the_air?page=${page}`);
    },

    // ─── Search ───
    async search(query, page = 1) {
        return this._fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    },

    // ─── Detail ───
    async getMovieDetail(id) {
        return this._fetch(`/api/movie/${id}`);
    },
    async getTVDetail(id) {
        return this._fetch(`/api/tv/${id}`);
    },
    async getSeasonDetail(tvId, season) {
        return this._fetch(`/api/tv/${tvId}/season/${season}`);
    },

    // ─── Genres ───
    async getGenres(type) {
        return this._fetch(`/api/genres/${type}`);
    },

    // ─── Discover ───
    async discover(type, { page = 1, genre, year, sort_by } = {}) {
        let url = `/api/discover/${type}?page=${page}`;
        if (genre) url += `&genre=${genre}`;
        if (year) url += `&year=${year}`;
        if (sort_by) url += `&sort_by=${sort_by}`;
        return this._fetch(url);
    },

    // ─── Person ───
    async getPerson(id) {
        return this._fetch(`/api/person/${id}`);
    },

    // ─── Sources ───
    async getSources() {
        return this._fetch('/api/sources');
    },
    async getSourceUrl(provider, tmdbId, type, season, episode, imdbId) {
        let url = `/api/source-url?provider=${provider}&tmdbId=${tmdbId}&type=${type}`;
        if (season) url += `&season=${season}`;
        if (episode) url += `&episode=${episode}`;
        if (imdbId) url += `&imdbId=${imdbId}`;
        return this._fetch(url);
    },

    // ─── Subtitles (Multi-source) ───
    async getSubtitles(imdbId, season, episode) {
        let url = `/api/subtitles/${imdbId}`;
        if (season && episode) url += `?season=${season}&episode=${episode}`;
        return this._fetch(url);
    },
    async getSubtitlesNew(imdbId) {
        return this._fetch(`/api/subtitles-new/${imdbId}`);
    },
    async getSubtitlesStremio(type, imdbId, season, episode) {
        let id = imdbId;
        if (type === 'tv' && season && episode) id += `:${season}:${episode}`;
        return this._fetch(`/api/subtitles-stremio/${type === 'tv' ? 'series' : 'movie'}/${id}`);
    },
    async getSubtitlesSubDL(query) {
        return this._fetch(`/api/subtitles-subdl?query=${encodeURIComponent(query)}`);
    },
    getSubtitleFileUrl(url) {
        return `/api/subtitle-file?url=${encodeURIComponent(url)}`;
    },

    // ─── MorphTV / TeaTV ───
    async searchMorphTV(title, year, season, episode) {
        let url = `/api/morphtv/search?title=${encodeURIComponent(title)}&year=${year}`;
        if (season) url += `&season=${season}`;
        if (episode) url += `&episode=${episode}`;
        return this._fetch(url);
    },
    async searchTeaTV(id, season, episode, imdbId) {
        let url = `/api/teatv/search?id=${encodeURIComponent(id)}`;
        if (imdbId) url += `&imdbId=${encodeURIComponent(imdbId)}`;
        if (season) url += `&season=${season}`;
        if (episode) url += `&episode=${episode}`;
        return this._fetch(url);
    },

    // ─── Trakt ───
    async getTraktTrending(type) {
        return this._fetch(`/api/trakt/${type}/trending`);
    },

    // ─── Addon List ───
    async getAddonList() {
        return this._fetch('/api/addon-list');
    },

    // ─── Keys Info ───
    async getKeysInfo() {
        return this._fetch('/api/keys-info');
    }
};
