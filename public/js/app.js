/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - Main Application
   SPA routing, page rendering, state management
   ═══════════════════════════════════════════════════════════ */

const App = {
    // ─── State ───
    currentPage: 'home',
    currentDetail: null,
    currentType: null,
    browseState: {
        movies: { page: 1, genre: '', year: '', sort: 'popularity.desc' },
        tv: { page: 1, genre: '', year: '', sort: 'popularity.desc' }
    },
    searchState: { query: '', page: 1 },
    watchState: { tmdbId: null, type: null, season: 1, episode: 1, detail: null },
    genresCache: { movie: null, tv: null },
    sourcesCache: null,
    searchDebounce: null,

    // ─── Local Storage Helpers ───
    storage: {
        get(key, def = null) {
            try { const v = localStorage.getItem(`fp_${key}`); return v ? JSON.parse(v) : def; }
            catch { return def; }
        },
        set(key, val) {
            try { localStorage.setItem(`fp_${key}`, JSON.stringify(val)); } catch {}
        },
        remove(key) { localStorage.removeItem(`fp_${key}`); }
    },

    // ─── Init ───
    async init() {
        Player.init();
        this.bindEvents();
        this.loadTheme();
        this.loadSettings();
        await this.loadGenres();
        this.populateYearFilters();
        this.handleRoute();

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());
    },

    // ─── Routing ───
    handleRoute() {
        const hash = location.hash.slice(1) || 'home';
        const parts = hash.split('/');
        const page = parts[0];

        switch (page) {
            case 'home':
                this.showPage('home');
                this.loadHome();
                break;
            case 'movies':
                this.showPage('movies');
                this.loadMovies();
                break;
            case 'tvshows':
                this.showPage('tvshows');
                this.loadTVShows();
                break;
            case 'genres':
                this.showPage('genres');
                this.loadGenresPage();
                break;
            case 'countries':
                this.showPage('countries');
                this.loadCountriesPage();
                break;
            case 'country':
                this.showPage('countries');
                this.loadCountryContent(parts[1], parts[2] || 'movie');
                break;
            case 'search':
                this.showPage('search');
                if (parts[1]) {
                    this.searchState.query = decodeURIComponent(parts[1]);
                    document.getElementById('global-search').value = this.searchState.query;
                    this.performSearch();
                }
                break;
            case 'movie':
                this.showPage('detail');
                this.loadDetail('movie', parts[1]);
                break;
            case 'tv':
                this.showPage('detail');
                this.loadDetail('tv', parts[1]);
                break;
            case 'watch':
                this.showPage('watch');
                this.loadWatch(parts[1], parts[2], parts[3], parts[4]);
                break;
            case 'favorites':
                this.showPage('favorites');
                this.loadFavorites();
                break;
            case 'watchlist':
                this.showPage('watchlist');
                this.loadWatchlist();
                break;
            case 'history':
                this.showPage('history');
                this.loadHistory();
                break;
            case 'settings':
                this.showPage('settings');
                break;
            default:
                this.showPage('home');
                this.loadHome();
        }
    },

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById(`page-${pageId}`);
        if (page) page.classList.add('active');
        this.currentPage = pageId;

        // Update sidebar active state
        document.querySelectorAll('.sidebar-menu li').forEach(li => {
            li.classList.toggle('active', li.dataset.page === pageId);
        });

        // Scroll to top
        document.getElementById('page-container').scrollTop = 0;
        window.scrollTo(0, 0);

        // Stop player when leaving watch page
        if (pageId !== 'watch') {
            this._saveWatchProgressNow();
            this._stopWatchProgressTracker();
            Player.stop();
        }

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
    },

    navigate(hash) {
        location.hash = hash;
    },

    // ─── Event Binding ───
    bindEvents() {
        // Sidebar navigation
        document.querySelectorAll('.sidebar-menu li').forEach(li => {
            li.addEventListener('click', () => this.navigate(li.dataset.page));
        });
        document.querySelector('.sidebar-settings').addEventListener('click', () => this.navigate('settings'));

        // Mobile menu toggle
        document.getElementById('menu-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Click outside sidebar to close on mobile
        document.getElementById('main-content').addEventListener('click', (e) => {
            if (!e.target.closest('#menu-toggle')) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });

        // Global search
        const searchInput = document.getElementById('global-search');
        searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounce);
            const q = e.target.value.trim();
            if (q.length < 2) {
                document.getElementById('search-suggestions').classList.add('hidden');
                return;
            }
            this.searchDebounce = setTimeout(() => this.showSearchSuggestions(q), 300);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = e.target.value.trim();
                if (q) {
                    document.getElementById('search-suggestions').classList.add('hidden');
                    this.navigate(`search/${encodeURIComponent(q)}`);
                }
            }
        });
        // Close suggestions on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-bar')) {
                document.getElementById('search-suggestions').classList.add('hidden');
            }
        });

        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());

        // Movie filters
        ['movie-genre-filter', 'movie-year-filter', 'movie-sort-filter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                this.browseState.movies.page = 1;
                this.browseState.movies.genre = document.getElementById('movie-genre-filter').value;
                this.browseState.movies.year = document.getElementById('movie-year-filter').value;
                this.browseState.movies.sort = document.getElementById('movie-sort-filter').value;
                this.loadMovies(true);
            });
        });

        // TV filters
        ['tv-genre-filter', 'tv-year-filter', 'tv-sort-filter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                this.browseState.tv.page = 1;
                this.browseState.tv.genre = document.getElementById('tv-genre-filter').value;
                this.browseState.tv.year = document.getElementById('tv-year-filter').value;
                this.browseState.tv.sort = document.getElementById('tv-sort-filter').value;
                this.loadTVShows(true);
            });
        });

        // Load more buttons
        document.querySelector('#movies-load-more button').addEventListener('click', () => {
            this.browseState.movies.page++;
            this.loadMovies(false);
        });
        document.querySelector('#tvshows-load-more button').addEventListener('click', () => {
            this.browseState.tv.page++;
            this.loadTVShows(false);
        });
        document.querySelector('#search-load-more button').addEventListener('click', () => {
            this.searchState.page++;
            this.performSearch(false);
        });

        // Detail page buttons
        document.getElementById('detail-play').addEventListener('click', () => {
            if (!this.currentDetail) return;
            const type = this.currentType;
            const id = this.currentDetail.id;
            if (type === 'tv') {
                this.navigate(`watch/tv/${id}/1/1`);
            } else {
                this.navigate(`watch/movie/${id}`);
            }
        });
        document.getElementById('detail-trailer').addEventListener('click', () => this.playTrailer());
        document.getElementById('detail-favorite').addEventListener('click', () => this.toggleFavorite());
        document.getElementById('detail-watchlist').addEventListener('click', () => this.toggleWatchlist());

        // Season selector on detail page
        document.getElementById('season-select').addEventListener('change', (e) => {
            this.loadSeasonEpisodes(this.currentDetail.id, parseInt(e.target.value));
        });

        // Source selector on watch page
        document.getElementById('source-select').addEventListener('change', (e) => {
            this.changeSource(e.target.value);
        });

        // Subtitle selector on watch page
        document.getElementById('subtitle-select').addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) {
                Player.disableSubtitles();
            } else {
                this.loadSubtitleTrack(val);
            }
        });

        // Watch page season selector
        document.getElementById('watch-season-select').addEventListener('change', (e) => {
            this.loadWatchEpisodes(parseInt(e.target.value));
        });

        // Hero buttons
        document.getElementById('hero-play').addEventListener('click', () => {
            const item = this._heroItem;
            if (!item) return;
            const type = item.media_type || (item.title ? 'movie' : 'tv');
            if (type === 'tv') this.navigate(`watch/tv/${item.id}/1/1`);
            else this.navigate(`watch/movie/${item.id}`);
        });
        document.getElementById('hero-details').addEventListener('click', () => {
            const item = this._heroItem;
            if (!item) return;
            const type = item.media_type || (item.title ? 'movie' : 'tv');
            this.navigate(`${type}/${item.id}`);
        });

        // Trailer modal close
        document.querySelector('#trailer-modal .modal-close').addEventListener('click', () => this.closeTrailer());
        document.querySelector('#trailer-modal .modal-backdrop').addEventListener('click', () => this.closeTrailer());

        // Genre tabs
        document.querySelectorAll('.genre-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.genre-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.loadGenresPage(tab.dataset.type);
            });
        });

        // Country tabs
        document.querySelectorAll('.country-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.country-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('countries-grid').classList.remove('hidden');
                this.loadCountriesPage(tab.dataset.type);
            });
        });
        // Country load more
        document.querySelector('#country-load-more button').addEventListener('click', () => {
            this._countryState.page++;
            this.loadCountryContent(this._countryState.lang, this._countryState.type, false);
        });

        // Settings
        document.getElementById('setting-theme').addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });
        document.getElementById('clear-history').addEventListener('click', () => {
            this.storage.set('history', []);
            this.loadHistory();
            this.showToast('History cleared');
        });
        document.getElementById('clear-all-data').addEventListener('click', () => {
            if (confirm('Are you sure? This will clear all favorites, watchlist, and history.')) {
                ['favorites', 'watchlist', 'history', 'continueWatching', 'settings'].forEach(k => this.storage.remove(k));
                this.showToast('All data cleared');
            }
        });
        document.getElementById('export-data').addEventListener('click', () => this.exportData());
        document.getElementById('import-data').addEventListener('click', () => this.importData());

        // See All links
        document.querySelectorAll('.see-all').forEach(link => {
            link.addEventListener('click', (e) => {
                const type = e.target.dataset.type;
                if (type === 'movie') this.navigate('movies');
                else this.navigate('tvshows');
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeTrailer();
                document.getElementById('search-suggestions').classList.add('hidden');
            }
            if (e.key === '/' && !e.target.matches('input, textarea, select')) {
                e.preventDefault();
                document.getElementById('global-search').focus();
            }
        });
    },

    // ─── Home Page ───
    async loadHome() {
        const container = document.querySelector('#page-home .content-sections');
        // Show skeletons
        document.querySelectorAll('.content-row .row-scroll').forEach(rs => {
            rs.innerHTML = this.createSkeletons(8);
        });

        try {
            const [trendingMovies, trendingTV, popMovies, popTV, topMovies, topTV] = await Promise.all([
                API.getTrending('movie', 'week'),
                API.getTrending('tv', 'week'),
                API.getPopular('movie'),
                API.getPopular('tv'),
                API.getTopRated('movie'),
                API.getTopRated('tv')
            ]);

            // Hero Banner
            if (trendingMovies.results.length > 0) {
                const hero = trendingMovies.results[Math.floor(Math.random() * Math.min(5, trendingMovies.results.length))];
                this.setHeroBanner(hero);
            }

            // Populate rows
            this.renderRow('trending-movies', trendingMovies.results, 'movie');
            this.renderRow('trending-tv', trendingTV.results, 'tv');
            this.renderRow('popular-movies', popMovies.results, 'movie');
            this.renderRow('popular-tv', popTV.results, 'tv');
            this.renderRow('toprated-movies', topMovies.results, 'movie');
            this.renderRow('toprated-tv', topTV.results, 'tv');

            // Load continue watching section
            this.loadContinueWatching();

            // Init row scroll navigation arrows
            this.initRowNavButtons();
        } catch (e) {
            console.error('Failed to load home:', e);
            this.showToast('Failed to load content', 'error');
        }
    },

    // ─── Row Scroll Navigation ───
    initRowNavButtons() {
        document.querySelectorAll('.row-scroll-wrap').forEach(wrap => {
            // Skip if already initialized
            if (wrap._rowNavInit) return;
            wrap._rowNavInit = true;

            const scroll = wrap.querySelector('.row-scroll');
            const leftBtn = wrap.querySelector('.row-nav.left');
            const rightBtn = wrap.querySelector('.row-nav.right');
            if (!scroll || !leftBtn || !rightBtn) return;

            const updateArrows = () => {
                const sl = scroll.scrollLeft;
                const cw = scroll.clientWidth;
                const sw = scroll.scrollWidth;
                // If content doesn't overflow, hide both
                if (sw <= cw + 5) {
                    leftBtn.classList.add('hidden');
                    rightBtn.classList.add('hidden');
                    return;
                }
                leftBtn.classList.toggle('hidden', sl <= 10);
                rightBtn.classList.toggle('hidden', sl + cw >= sw - 10);
            };

            const scrollAmount = () => scroll.clientWidth * 0.75;

            leftBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                scroll.scrollTo({ left: scroll.scrollLeft - scrollAmount(), behavior: 'smooth' });
            });
            rightBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                scroll.scrollTo({ left: scroll.scrollLeft + scrollAmount(), behavior: 'smooth' });
            });

            scroll.addEventListener('scroll', updateArrows, { passive: true });

            // ── Mouse drag-to-scroll ──
            let isDragging = false, startX = 0, scrollStart = 0, hasDragged = false;

            scroll.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // left click only
                // Don't intercept clicks on the scrollbar itself
                const rect = scroll.getBoundingClientRect();
                const scrollbarHeight = scroll.offsetHeight - scroll.clientHeight;
                if (e.clientY > rect.bottom - scrollbarHeight) return;
                isDragging = true;
                hasDragged = false;
                startX = e.pageX;
                scrollStart = scroll.scrollLeft;
                scroll.classList.add('dragging');
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                e.preventDefault(); // prevent text selection only during drag
                const dx = e.pageX - startX;
                if (Math.abs(dx) > 5) hasDragged = true;
                scroll.scrollLeft = scrollStart - dx;
            });

            document.addEventListener('mouseup', () => {
                if (!isDragging) return;
                isDragging = false;
                scroll.classList.remove('dragging');
                // If user dragged, prevent click on cards
                if (hasDragged) {
                    scroll.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    }, { capture: true, once: true });
                }
            });

            // ── Mouse wheel horizontal scroll ──
            scroll.addEventListener('wheel', (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    const maxScroll = scroll.scrollWidth - scroll.clientWidth;
                    const atStart = scroll.scrollLeft <= 0 && e.deltaY < 0;
                    const atEnd = scroll.scrollLeft >= maxScroll - 1 && e.deltaY > 0;
                    // Let page scroll normally if at boundary
                    if (atStart || atEnd) return;
                    e.preventDefault();
                    scroll.scrollLeft += e.deltaY;
                }
            }, { passive: false });

            // Robust initial check: retry multiple times as content renders
            const scheduleUpdate = (delay) => setTimeout(() => requestAnimationFrame(updateArrows), delay);
            scheduleUpdate(50);
            scheduleUpdate(300);
            scheduleUpdate(800);

            // Also update on window resize
            window.addEventListener('resize', updateArrows, { passive: true });
        });
    },

    setHeroBanner(item) {
        this._heroItem = item;
        const banner = document.getElementById('hero-banner');
        banner.style.backgroundImage = `url(${API.backdrop(item.backdrop_path)})`;
        document.getElementById('hero-title').textContent = item.title || item.name;
        document.getElementById('hero-overview').textContent = item.overview;
        document.getElementById('hero-rating').querySelector('span').textContent = item.vote_average?.toFixed(1);
        document.getElementById('hero-year').textContent = (item.release_date || item.first_air_date || '').split('-')[0];
        document.getElementById('hero-type').textContent = item.media_type === 'tv' ? 'TV Show' : 'Movie';
    },

    // ─── Card Rendering ───
    createCard(item, type) {
        const mediaType = type || item.media_type || (item.title ? 'movie' : 'tv');
        const title = item.title || item.name || 'Unknown';
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';

        return `
            <div class="card" data-id="${item.id}" data-type="${mediaType}" onclick="App.navigate('${mediaType}/${item.id}')">
                <div class="card-poster">
                    <img src="${API.poster(item.poster_path)}" alt="${title}" loading="lazy" onerror="this.src='/img/no-poster.svg'">
                    <div class="card-rating"><i class="fas fa-star"></i> ${rating}</div>
                    ${item.media_type ? `<div class="card-type">${mediaType === 'tv' ? 'TV' : 'Movie'}</div>` : ''}
                    <div class="card-play"><i class="fas fa-play-circle"></i></div>
                </div>
                <div class="card-info">
                    <h3>${title}</h3>
                    <span>${year}</span>
                </div>
            </div>
        `;
    },

    renderRow(containerId, items, type) {
        const row = document.querySelector(`#${containerId} .row-scroll`);
        if (!row) return;
        row.innerHTML = items.map(item => this.createCard(item, type)).join('');
    },

    renderGrid(containerId, items, type, append = false) {
        const grid = document.getElementById(containerId);
        if (!grid) return;
        const html = items.map(item => this.createCard(item, type)).join('');
        if (append) grid.innerHTML += html;
        else grid.innerHTML = html;
    },

    createSkeletons(count) {
        return Array(count).fill(`
            <div class="skeleton-card">
                <div class="skeleton skeleton-poster"></div>
                <div class="skeleton skeleton-text"></div>
            </div>
        `).join('');
    },

    // ─── Movies Browse ───
    async loadMovies(reset = true) {
        const state = this.browseState.movies;
        if (reset) {
            state.page = 1;
            document.getElementById('movies-grid').innerHTML = '<div class="skeleton skeleton-poster" style="height:200px;grid-column:1/-1"></div>';
        }
        try {
            const data = await API.discover('movie', {
                page: state.page,
                genre: state.genre,
                year: state.year,
                sort_by: state.sort
            });
            this.renderGrid('movies-grid', data.results, 'movie', state.page > 1);
            document.getElementById('movies-load-more').classList.toggle('hidden', state.page >= data.total_pages);
        } catch (e) {
            this.showToast('Failed to load movies', 'error');
        }
    },

    // ─── TV Shows Browse ───
    async loadTVShows(reset = true) {
        const state = this.browseState.tv;
        if (reset) {
            state.page = 1;
            document.getElementById('tvshows-grid').innerHTML = '<div class="skeleton skeleton-poster" style="height:200px;grid-column:1/-1"></div>';
        }
        try {
            const data = await API.discover('tv', {
                page: state.page,
                genre: state.genre,
                year: state.year,
                sort_by: state.sort
            });
            this.renderGrid('tvshows-grid', data.results, 'tv', state.page > 1);
            document.getElementById('tvshows-load-more').classList.toggle('hidden', state.page >= data.total_pages);
        } catch (e) {
            this.showToast('Failed to load TV shows', 'error');
        }
    },

    // ─── Search ───
    async showSearchSuggestions(q) {
        try {
            const data = await API.search(q, 1);
            const suggestions = document.getElementById('search-suggestions');
            const results = data.results.filter(r => r.media_type !== 'person').slice(0, 8);
            if (results.length === 0) {
                suggestions.classList.add('hidden');
                return;
            }
            suggestions.innerHTML = results.map(item => {
                const type = item.media_type;
                const title = item.title || item.name;
                const year = (item.release_date || item.first_air_date || '').split('-')[0];
                return `
                    <div class="suggestion-item" onclick="App.navigate('${type}/${item.id}');document.getElementById('search-suggestions').classList.add('hidden');">
                        <img src="${API.poster(item.poster_path)}" alt="" onerror="this.src='/img/no-poster.svg'">
                        <div class="suggestion-info">
                            <h4>${title}</h4>
                            <span>${type === 'tv' ? 'TV Show' : 'Movie'} • ${year}</span>
                        </div>
                    </div>
                `;
            }).join('');
            suggestions.classList.remove('hidden');
        } catch {}
    },

    async performSearch(reset = true) {
        const q = this.searchState.query;
        if (!q) return;
        if (reset) this.searchState.page = 1;
        document.getElementById('search-query-display').textContent = `Showing results for "${q}"`;
        try {
            const data = await API.search(q, this.searchState.page);
            const filtered = data.results.filter(r => r.media_type !== 'person');
            this.renderGrid('search-results', filtered, null, !reset);
            document.getElementById('search-load-more').classList.toggle('hidden', this.searchState.page >= data.total_pages);
        } catch (e) {
            this.showToast('Search failed', 'error');
        }
    },

    // ─── Genres Page ───
    async loadGenresPage(type = 'movie') {
        const genres = this.genresCache[type];
        if (!genres) return;
        const icons = {
            28: 'fa-explosion', 12: 'fa-compass', 16: 'fa-wand-magic-sparkles', 35: 'fa-face-laugh',
            80: 'fa-mask', 99: 'fa-video', 18: 'fa-masks-theater', 10751: 'fa-people-roof',
            14: 'fa-dragon', 36: 'fa-landmark', 27: 'fa-ghost', 10402: 'fa-music',
            9648: 'fa-magnifying-glass', 10749: 'fa-heart', 878: 'fa-rocket', 10770: 'fa-tv',
            53: 'fa-skull', 10752: 'fa-fighter-jet', 37: 'fa-hat-cowboy',
            10759: 'fa-explosion', 10762: 'fa-child', 10763: 'fa-newspaper', 10764: 'fa-star',
            10765: 'fa-rocket', 10766: 'fa-heart', 10767: 'fa-microphone', 10768: 'fa-globe'
        };
        const grid = document.getElementById('genres-grid');
        grid.innerHTML = genres.map(g => `
            <div class="genre-card" onclick="App.navigate('${type === 'movie' ? 'movies' : 'tvshows'}');App.browseState.${type === 'movie' ? 'movies' : 'tv'}.genre='${g.id}';document.getElementById('${type === 'movie' ? 'movie' : 'tv'}-genre-filter').value='${g.id}';App.load${type === 'movie' ? 'Movies' : 'TVShows'}(true);">
                <i class="fas ${icons[g.id] || 'fa-film'}"></i>
                ${g.name}
            </div>
        `).join('');
    },

    // ─── Countries / Language Page ───
    _countries: [
        { code: 'ko', name: 'Korean', flag: '🇰🇷', icon: 'fa-flag' },
        { code: 'ja', name: 'Japanese', flag: '🇯🇵', icon: 'fa-torii-gate' },
        { code: 'zh', name: 'Chinese', flag: '🇨🇳', icon: 'fa-yin-yang' },
        { code: 'hi', name: 'Hindi', flag: '🇮🇳', icon: 'fa-om' },
        { code: 'ta', name: 'Tamil', flag: '🇮🇳', icon: 'fa-film' },
        { code: 'te', name: 'Telugu', flag: '🇮🇳', icon: 'fa-film' },
        { code: 'ml', name: 'Malayalam', flag: '🇮🇳', icon: 'fa-film' },
        { code: 'es', name: 'Spanish', flag: '🇪🇸', icon: 'fa-sun' },
        { code: 'fr', name: 'French', flag: '🇫🇷', icon: 'fa-wine-glass' },
        { code: 'de', name: 'German', flag: '🇩🇪', icon: 'fa-landmark' },
        { code: 'it', name: 'Italian', flag: '🇮🇹', icon: 'fa-pizza-slice' },
        { code: 'pt', name: 'Portuguese', flag: '🇧🇷', icon: 'fa-futbol' },
        { code: 'tr', name: 'Turkish', flag: '🇹🇷', icon: 'fa-mosque' },
        { code: 'th', name: 'Thai', flag: '🇹🇭', icon: 'fa-vihara' },
        { code: 'tl', name: 'Filipino', flag: '🇵🇭', icon: 'fa-island-tropical' },
        { code: 'id', name: 'Indonesian', flag: '🇮🇩', icon: 'fa-mountain' },
        { code: 'ru', name: 'Russian', flag: '🇷🇺', icon: 'fa-snowflake' },
        { code: 'ar', name: 'Arabic', flag: '🇸🇦', icon: 'fa-moon' },
        { code: 'sv', name: 'Swedish', flag: '🇸🇪', icon: 'fa-crown' },
        { code: 'da', name: 'Danish', flag: '🇩🇰', icon: 'fa-chess-rook' },
        { code: 'no', name: 'Norwegian', flag: '🇳🇴', icon: 'fa-mountain-sun' },
        { code: 'pl', name: 'Polish', flag: '🇵🇱', icon: 'fa-landmark-dome' },
        { code: 'nl', name: 'Dutch', flag: '🇳🇱', icon: 'fa-wind' },
        { code: 'cn', name: 'Cantonese', flag: '🇭🇰', icon: 'fa-city' }
    ],
    _countryState: { type: 'movie', lang: null, page: 1 },

    loadCountriesPage(type) {
        if (type) this._countryState.type = type;
        const currentType = this._countryState.type;
        // Update tab active state
        document.querySelectorAll('.country-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.type === currentType);
        });
        const grid = document.getElementById('countries-grid');
        grid.innerHTML = this._countries.map(c => `
            <div class="genre-card" onclick="App.navigate('country/${c.code}/${currentType}')">
                <span style="font-size:1.8rem">${c.flag}</span>
                ${c.name}
            </div>
        `).join('');
        // Clear previous results
        document.getElementById('country-results').innerHTML = '';
        document.getElementById('country-load-more').classList.add('hidden');
    },

    async loadCountryContent(langCode, type = 'movie', reset = true) {
        this._countryState.lang = langCode;
        this._countryState.type = type;
        if (reset) this._countryState.page = 1;
        const countryInfo = this._countries.find(c => c.code === langCode);
        const label = countryInfo ? countryInfo.name : langCode.toUpperCase();
        // Update heading
        document.querySelector('#page-countries h1').textContent = `${countryInfo ? countryInfo.flag + ' ' : ''}${label} ${type === 'movie' ? 'Movies' : 'TV Shows'}`;
        // Update tabs
        document.querySelectorAll('.country-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.type === type);
        });
        // Rebind tabs to switch type within same country
        document.querySelectorAll('.country-tab').forEach(t => {
            t.onclick = () => this.navigate(`country/${langCode}/${t.dataset.type}`);
        });
        // Hide country cards, show results
        document.getElementById('countries-grid').classList.add('hidden');
        try {
            const data = await API.discover(type, { page: this._countryState.page, language: langCode, sort_by: 'popularity.desc' });
            this.renderGrid('country-results', data.results, type, !reset);
            document.getElementById('country-load-more').classList.toggle('hidden', this._countryState.page >= data.total_pages);
        } catch (e) {
            this.showToast('Failed to load content', 'error');
        }
    },

    // ─── Browse by Genre (from detail page clickable genres) ───
    browseByGenre(genreId, genreName, type) {
        const browseKey = type === 'movie' ? 'movies' : 'tv';
        const page = type === 'movie' ? 'movies' : 'tvshows';
        this.browseState[browseKey].genre = String(genreId);
        this.browseState[browseKey].page = 1;
        this.navigate(page);
        // Set filter dropdown after page renders
        setTimeout(() => {
            const filterId = type === 'movie' ? 'movie-genre-filter' : 'tv-genre-filter';
            const filterEl = document.getElementById(filterId);
            if (filterEl) filterEl.value = String(genreId);
            if (type === 'movie') this.loadMovies(true);
            else this.loadTVShows(true);
        }, 100);
    },

    // ─── Detail Page ───
    async loadDetail(type, id) {
        this.currentType = type;
        try {
            const data = type === 'movie' ? await API.getMovieDetail(id) : await API.getTVDetail(id);
            this.currentDetail = data;
            this.renderDetail(data, type);
        } catch (e) {
            this.showToast('Failed to load details', 'error');
            console.error(e);
        }
    },

    renderDetail(data, type) {
        // Backdrop
        const backdrop = document.getElementById('detail-backdrop');
        backdrop.style.backgroundImage = `url(${API.backdrop(data.backdrop_path)})`;

        // Poster
        document.getElementById('detail-poster-img').src = API.posterLg(data.poster_path);

        // Title
        document.getElementById('detail-title').textContent = data.title || data.name;

        // Meta
        document.getElementById('detail-rating-val').textContent = data.vote_average?.toFixed(1) || 'N/A';
        document.getElementById('detail-year').textContent = (data.release_date || data.first_air_date || '').split('-')[0];
        document.getElementById('detail-runtime').textContent = type === 'movie'
            ? (data.runtime ? `${data.runtime} min` : '')
            : (data.episode_run_time?.[0] ? `${data.episode_run_time[0]} min/ep` : `${data.number_of_seasons} Season${data.number_of_seasons > 1 ? 's' : ''}`);
        document.getElementById('detail-status').textContent = data.status || '';

        // Genres (clickable - navigate to browse by genre)
        document.getElementById('detail-genres').innerHTML = (data.genres || []).map(g =>
            `<span class="genre-tag clickable" onclick="App.browseByGenre(${g.id}, '${g.name}', '${type}')">${g.name}</span>`
        ).join('');

        // Overview
        document.getElementById('detail-overview').textContent = data.overview || 'No description available.';

        // Favorite / Watchlist buttons
        this.updateFavoriteButton();
        this.updateWatchlistButton();

        // Cast (clickable - shows filmography)
        const castScroll = document.querySelector('#detail-cast .cast-scroll');
        const cast = data.credits?.cast?.slice(0, 20) || [];
        castScroll.innerHTML = cast.map(person => `
            <div class="cast-card" onclick="App.showPersonFilmography(${person.id})" style="cursor:pointer" title="View ${person.name}'s filmography">
                <img src="${API.profile(person.profile_path)}" alt="${person.name}" onerror="this.src='/img/no-avatar.svg'" loading="lazy">
                <h4>${person.name}</h4>
                <span>${person.character || ''}</span>
            </div>
        `).join('');

        // Seasons (TV only)
        const seasonsSection = document.getElementById('detail-seasons');
        if (type === 'tv' && data.seasons?.length > 0) {
            seasonsSection.classList.remove('hidden');
            const select = document.getElementById('season-select');
            select.innerHTML = data.seasons
                .filter(s => s.season_number > 0)
                .map(s => `<option value="${s.season_number}">Season ${s.season_number} (${s.episode_count} episodes)</option>`)
                .join('');
            this.loadSeasonEpisodes(data.id, data.seasons.find(s => s.season_number > 0)?.season_number || 1);
        } else {
            seasonsSection.classList.add('hidden');
        }

        // Similar content - use TMDB similar, fallback to genre-based recommendations
        const similar = data.similar?.results?.slice(0, 15) || [];
        if (similar.length > 0) {
            this.renderRow('detail-similar', similar, type);
        } else {
            // Fallback: discover by first genre
            const firstGenre = data.genres?.[0]?.id;
            if (firstGenre) {
                API.discover(type, { genre: firstGenre }).then(disc => {
                    const filtered = (disc.results || []).filter(r => r.id !== data.id).slice(0, 15);
                    this.renderRow('detail-similar', filtered, type);
                    this.initRowNavButtons();
                }).catch(() => {});
            }
        }
        this.initRowNavButtons();  // init arrows for similar row

        // Trailer button
        const trailerBtn = document.getElementById('detail-trailer');
        const videos = data.videos?.results || [];
        const trailer = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube') || videos.find(v => v.site === 'YouTube');
        trailerBtn.style.display = trailer ? '' : 'none';
        trailerBtn.dataset.key = trailer?.key || '';
    },

    async loadSeasonEpisodes(tvId, seasonNum) {
        try {
            const season = await API.getSeasonDetail(tvId, seasonNum);
            const list = document.getElementById('episodes-list');
            list.innerHTML = (season.episodes || []).map(ep => `
                <div class="episode-item" onclick="App.navigate('watch/tv/${tvId}/${seasonNum}/${ep.episode_number}')">
                    <div class="episode-still">
                        <img src="${ep.still_path ? API.backdropMd(ep.still_path) : API.poster(this.currentDetail?.poster_path)}" alt="" loading="lazy">
                        <div class="ep-play-icon"><i class="fas fa-play"></i></div>
                    </div>
                    <div class="episode-info">
                        <h4>E${ep.episode_number}. ${ep.name}</h4>
                        <div class="ep-meta">${ep.air_date || ''} • ${ep.runtime ? ep.runtime + ' min' : ''} • ★ ${ep.vote_average?.toFixed(1) || 'N/A'}</div>
                        <p>${ep.overview || ''}</p>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            console.error('Failed to load episodes:', e);
        }
    },

    // ─── Watch Page ───
    async loadWatch(type, tmdbId, season, episode) {
        this.watchState = { tmdbId, type, season: parseInt(season) || 1, episode: parseInt(episode) || 1, detail: null };
        this._extractionFailed = false;
        this._preloadedStreams.clear();
        this._failedSources.clear();
        this._preloadGeneration = (this._preloadGeneration || 0) + 1; // Invalidate stale preloads
        Player.clearSavedPosition();

        // Show loading overlay immediately
        Player.showLoading('Loading movie info', 'PREPARING YOUR EXPERIENCE');

        let detail;
        try {
            // Load detail info
            detail = type === 'movie' ? await API.getMovieDetail(tmdbId) : await API.getTVDetail(tmdbId);
            this.watchState.detail = detail;

            // Set title
            document.getElementById('watch-title').textContent = detail.title || detail.name;
            if (type === 'tv') {
                document.getElementById('watch-ep-info').textContent = `Season ${season} • Episode ${episode}`;
            } else {
                document.getElementById('watch-ep-info').textContent = (detail.release_date || '').split('-')[0];
            }
        } catch (e) {
            console.error('Failed to load content details:', e);
            this.showToast('Failed to load content info. Retrying...', 'error');
            // Retry once for detail
            try {
                API._cache.delete(`/api/${type}/${tmdbId}`);
                detail = type === 'movie' ? await API.getMovieDetail(tmdbId) : await API.getTVDetail(tmdbId);
                this.watchState.detail = detail;
                document.getElementById('watch-title').textContent = detail.title || detail.name;
            } catch (e2) {
                console.error('Retry also failed:', e2);
                this.showToast('Failed to load player — check your connection', 'error');
                Player.hideLoading();
                return;
            }
        }

        // Load sources (separate try-catch so detail failure doesn't block sources)
        try {
            await this.loadSources();
        } catch (e) {
            console.error('Failed to load sources:', e);
            // Still try to play — changeSource has its own fallback chain
            this.showToast('Source loading issue — trying alternatives...', 'error');
        }

        // Load subtitles (fire and forget)
        this.loadSubtitlesForWatch(detail);

        // Show episode selector for TV
        if (type === 'tv' && detail.seasons) {
            try {
                const epSection = document.getElementById('watch-episodes');
                epSection.classList.remove('hidden');
                const seasonSelect = document.getElementById('watch-season-select');
                seasonSelect.innerHTML = detail.seasons
                    .filter(s => s.season_number > 0)
                    .map(s => `<option value="${s.season_number}" ${s.season_number == season ? 'selected' : ''}>Season ${s.season_number}</option>`)
                    .join('');
                this.loadWatchEpisodes(parseInt(season) || 1);
            } catch (e) { console.error('Episode selector error:', e); }
        } else {
            document.getElementById('watch-episodes').classList.add('hidden');
        }

        // Add to history
        this.addToHistory({
            id: detail.id,
            type,
            title: detail.title || detail.name,
            poster_path: detail.poster_path,
            backdrop_path: detail.backdrop_path,
            season, episode,
            timestamp: Date.now()
        });

        // Start tracking watch progress for continue watching
        this._startWatchProgressTracker(detail, type, season, episode);
    },

    async loadSources() {
        if (!this.sourcesCache) {
            this.sourcesCache = await API.getSources();
        }
        // Restore source selector UI
        this._restoreSourceSelector();
        const select = document.getElementById('source-select');

        // Show ALL servers in dropdown — every source extracts streams natively (no iframes)
        let optionsHtml = this.sourcesCache.map(s =>
            `<option value="${s.id}">${s.name} ${s.quality || ''}</option>`
        ).join('');
        select.innerHTML = optionsHtml;

        // Also populate settings default source
        const settingSelect = document.getElementById('setting-default-source');
        if (settingSelect && settingSelect.children.length === 0) {
            settingSelect.innerHTML = this.sourcesCache.map(s =>
                `<option value="${s.id}">${s.name} ${s.quality || ''}</option>`
            ).join('');
        }

        // === AGGRESSIVE PARALLEL PRELOAD — load ALL servers at once ===
        this._preloadAllParallel();

        // Use default source from settings, or start with first source
        const defaultSource = this.storage.get('settings')?.defaultSource;
        if (defaultSource && this.sourcesCache.find(s => s.id === defaultSource)) {
            select.value = defaultSource;
        } else {
            select.value = this.sourcesCache[0]?.id || 'moviesapi';
        }

        // Load the selected source — await it so errors propagate properly
        try {
            await this.changeSource(select.value);
        } catch (e) {
            console.error('Initial source load failed:', e);
        }
    },

    _failedSources: new Set(),
    _preloadedStreams: new Map(), // Cache preloaded stream URLs

    // Mark the active source in the dropdown
    _highlightActiveSource(providerId) {
        const select = document.getElementById('source-select');
        if (select) select.value = providerId;
        // Show quality selector for all HLS sources (all play natively now)
        const qs = document.querySelector('.quality-selector');
        if (qs) qs.style.display = '';
    },

    // Ensure source selector is visible and functional
    _restoreSourceSelector() {
        const sourceSelector = document.querySelector('.source-selector');
        if (!sourceSelector) return;
        // Clean up any old badges from previous version
        sourceSelector.querySelectorAll('.direct-stream-badge, .direct-label').forEach(el => el.remove());
        // Ensure select and label are visible
        const select = document.getElementById('source-select');
        if (select) {
            select.style.display = '';
        } else {
            const newSelect = document.createElement('select');
            newSelect.id = 'source-select';
            sourceSelector.appendChild(newSelect);
            newSelect.addEventListener('change', (e) => this.changeSource(e.target.value));
        }
        const origLabel = sourceSelector.querySelector('label');
        if (origLabel) origLabel.style.display = '';
    },

    _preloadGeneration: 0,

    // === AGGRESSIVE PARALLEL PRELOAD — all servers at once ===
    _preloadAllParallel() {
        const { tmdbId, type, season, episode, detail } = this.watchState;
        if (!tmdbId || !this.sourcesCache) return;
        const gen = this._preloadGeneration;

        console.log('[Preload] Extracting ALL servers in parallel (no iframes)...');

        this.sourcesCache.forEach(source => {
            if (this._preloadedStreams.has(source.id)) return;

            if (source.apiOnly) {
                // API sources (MorphTV, TeaTV) — preload search results
                const title = detail?.title || detail?.name || '';
                const year = (detail?.release_date || detail?.first_air_date || '').split('-')[0];
                const imdbId = detail?.external_ids?.imdb_id || '';
                let apiPromise;
                if (source.id === 'morphtv') {
                    apiPromise = API.searchMorphTV(title, year, type === 'tv' ? season : null, type === 'tv' ? episode : null);
                } else if (source.id === 'teatv') {
                    apiPromise = API.searchTeaTV(imdbId || tmdbId, type === 'tv' ? season : null, type === 'tv' ? episode : null, imdbId);
                }
                if (apiPromise) {
                    apiPromise.then(result => {
                        if (gen !== this._preloadGeneration) return;
                        this._preloadedStreams.set(source.id, { apiResult: result, apiProvider: source.id });
                        console.log(`[Preload] ${source.name} API cached`);
                    }).catch(() => {});
                }
            } else {
                // Extraction sources — extract stream server-side (no iframe!)
                API.extractStream(tmdbId, type, season, episode, source.id).then(stream => {
                    if (gen !== this._preloadGeneration) return;
                    if (stream.success && stream.hlsUrl) {
                        this._preloadedStreams.set(source.id, stream);
                        console.log(`[Preload] ⚡ ${source.name} stream extracted & cached`);
                    }
                }).catch(() => {});
            }
        });
    },

    async changeSource(providerId) {
        const { tmdbId, type, season, episode, detail } = this.watchState;
        if (!tmdbId) return;

        Player.savePosition();
        Player.showLoading('Connecting to server', 'INITIALIZING');

        const sourceInfo = this.sourcesCache?.find(s => s.id === providerId);
        const sourceName = sourceInfo?.name || providerId;

        // ─── API providers (MorphTV, TeaTV) — direct MP4 playback ───
        if (sourceInfo?.apiOnly) {
            try {
                Player.updateLoading(`Loading ${sourceName}`, 'SEARCHING API', 30);
                const preloaded = this._preloadedStreams.get(providerId);
                if (preloaded?.apiResult) {
                    const success = this._playApiResult(preloaded.apiResult, providerId);
                    if (success) {
                        this._failedSources.clear();
                        this._highlightActiveSource(providerId);
                        return;
                    }
                }
                const success = await this.tryApiProvider(providerId, detail, type, season, episode);
                if (success) {
                    this._failedSources.clear();
                    this._highlightActiveSource(providerId);
                    return;
                }
            } catch (e) {
                console.warn(`${sourceName} failed:`, e.message);
            }
            this._failedSources.add(providerId);
            this.autoFallbackSource();
            return;
        }

        // ─── Extraction sources — server-side stream extraction → native HLS player ───
        try {
            // Check preloaded cache first for instant playback
            let stream = this._preloadedStreams.get(providerId);
            if (stream && stream.success && stream.hlsUrl) {
                Player.updateLoading('Stream ready', 'STARTING PLAYBACK', 80);
            } else {
                Player.updateLoading(`Extracting from ${sourceName}`, 'SCANNING SERVERS', 15);
                stream = await API.extractStream(tmdbId, type, season, episode, providerId);
                if (stream.success && stream.hlsUrl) {
                    this._preloadedStreams.set(providerId, stream);
                }
            }

            if (stream && stream.success && stream.hlsUrl) {
                Player.playHLSUrl(stream.hlsUrl);
                this._failedSources.clear();
                this._highlightActiveSource(providerId);
                // Add extracted subtitles if any
                if (stream.subtitles && stream.subtitles.length > 0) {
                    stream.subtitles.forEach((sub, i) => {
                        const label = (typeof sub === 'object') ? (sub.label || `Sub ${i + 1}`) : `Sub ${i + 1}`;
                        const url = (typeof sub === 'object') ? sub.url : sub;
                        const lang = (typeof sub === 'object') ? (sub.lang || 'en') : 'en';
                        Player.addSubtitleTrack(label, url, lang, i === 0);
                    });
                }
                console.log(`[Play] ${sourceName} via ${stream.source} — native HLS`);
                return;
            }
        } catch (e) {
            console.warn(`${sourceName} extraction failed:`, e.message);
        }

        // Extraction failed — try next server
        this._failedSources.add(providerId);
        this.autoFallbackSource();
    },

    // Play from preloaded API result (MorphTV/TeaTV)
    _playApiResult(result, provider) {
        const items = result?.data || result?.links || result?.results || [];
        if (!Array.isArray(items) || items.length === 0) return false;
        const sorted = [...items].sort((a, b) => {
            const qA = parseInt((a.quality || '0').replace(/[^0-9]/g, '')) || 0;
            const qB = parseInt((b.quality || '0').replace(/[^0-9]/g, '')) || 0;
            return qB - qA;
        });
        const link = sorted.find(d => d.file || d.link || d.url);
        if (link) {
            const videoUrl = link.file || link.link || link.url;
            Player.playDirect(videoUrl);
            this.showToast(`Playing via ${provider}`, 'success');
            return true;
        }
        return false;
    },

    // Smart ad shield - absorbs first click (popup trigger), then lets video controls work
    activateAdShield() {
        // Remove any existing shield
        const existing = document.getElementById('ad-shield');
        if (existing) existing.remove();

        const shield = document.createElement('div');
        shield.id = 'ad-shield';
        shield.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:5;cursor:pointer;background:transparent;';
        
        let clickCount = 0;
        shield.addEventListener('click', (e) => {
            clickCount++;
            if (clickCount >= 2) {
                // After absorbing first click (popup trigger), remove shield
                shield.remove();
            }
            e.stopPropagation();
        });

        // Auto-remove after 8 seconds regardless (user may have already clicked past ads)
        setTimeout(() => { if (shield.parentNode) shield.remove(); }, 8000);

        const playerArea = document.getElementById('player-area');
        if (playerArea) {
            playerArea.style.position = 'relative';
            playerArea.appendChild(shield);
        }
    },

    // Instant auto-fallback to next server — uses preloaded cache for zero delay
    autoFallbackSource() {
        if (!this.sourcesCache) return;
        const select = document.getElementById('source-select');
        // Find next source that hasn't failed
        const nextSource = this.sourcesCache.find(s => !this._failedSources.has(s.id));
        if (nextSource) {
            if (select) select.value = nextSource.id;
            this.showToast(`⚡ Switching to ${nextSource.name}...`);
            this.changeSource(nextSource.id);
        } else {
            // All sources tried
            this._failedSources.clear();
            Player.hideLoading();
            this.showSourceUnavailable();
        }
    },

    // Show a clean "source unavailable" message in the player area
    showSourceUnavailable() {
        Player.hideLoading();
        const playerArea = document.getElementById('player-area');
        // Remove any existing unavailable overlay
        const existing = document.getElementById('source-unavailable-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'source-unavailable-overlay';
        overlay.innerHTML = `
            <div class="source-unavail-content">
                <i class="fas fa-satellite-dish"></i>
                <h3>Content Temporarily Unavailable</h3>
                <p>All servers are currently busy or this title is not yet available for streaming.</p>
                <div class="source-unavail-actions">
                    <button class="btn btn-primary" onclick="App._failedSources.clear();App._extractionFailed=false;App._preloadedStreams.clear();App.loadSources();this.closest('#source-unavailable-overlay').remove();">
                        <i class="fas fa-redo"></i> Try Again
                    </button>
                    <button class="btn btn-secondary" onclick="history.back();">
                        <i class="fas fa-arrow-left"></i> Go Back
                    </button>
                </div>
            </div>
        `;
        playerArea.appendChild(overlay);
    },

    async tryApiProvider(provider, detail, type, season, episode) {
        const title = detail.title || detail.name;
        const year = (detail.release_date || detail.first_air_date || '').split('-')[0];
        const imdbId = detail.external_ids?.imdb_id || '';
        const tmdbId = detail.id;
        try {
            let result;
            if (provider === 'morphtv') {
                result = await API.searchMorphTV(title, year, type === 'tv' ? season : null, type === 'tv' ? episode : null);
            } else if (provider === 'teatv') {
                result = await API.searchTeaTV(imdbId || tmdbId, type === 'tv' ? season : null, type === 'tv' ? episode : null, imdbId);
            }
            // Handle multiple API response formats (data, links, results)
            const items = result?.data || result?.links || result?.results || [];
            if (Array.isArray(items) && items.length > 0) {
                // Find a playable link, prefer highest quality
                const sorted = [...items].sort((a, b) => {
                    const qA = parseInt((a.quality || '0').replace(/[^0-9]/g, '')) || 0;
                    const qB = parseInt((b.quality || '0').replace(/[^0-9]/g, '')) || 0;
                    return qB - qA;
                });
                const link = sorted.find(d => d.file || d.link || d.url);
                if (link) {
                    const videoUrl = link.file || link.link || link.url;
                    Player.playDirect(videoUrl);
                    this.showToast(`Playing via ${provider}`, 'success');
                    return true;
                }
            }
            this.showToast(`No links from ${provider}, switching...`, 'error');
            return false;
        } catch (e) {
            this.showToast(`${provider} unavailable, switching...`, 'error');
            return false;
        }
    },

    async loadSubtitlesForWatch(detail) {
        const select = document.getElementById('subtitle-select');
        select.innerHTML = '<option value="">None</option><option value="" disabled>Loading...</option>';

        const imdbId = detail.external_ids?.imdb_id;
        if (!imdbId) {
            select.innerHTML = '<option value="">No subtitles available</option>';
            return;
        }

        try {
            const { season, episode, type } = this.watchState;
            const isTV = type === 'tv';

            // Try multiple subtitle sources in parallel
            const results = await Promise.allSettled([
                Player.loadSubtitles(imdbId, isTV ? season : null, isTV ? episode : null),
                API.getSubtitlesStremio(type, imdbId, isTV ? season : null, isTV ? episode : null).catch(() => ({ subtitles: [] })),
                API.getSubtitlesSubDL(detail.title || detail.name).catch(() => []),
            ]);

            // Merge all subtitles
            let allSubs = [];

            // OpenSubtitles classic
            const osSubs = results[0].status === 'fulfilled' ? results[0].value : [];
            allSubs.push(...osSubs.map(s => ({
                lang: s.SubLanguageID || s.LanguageName || 'Unknown',
                langName: s.LanguageName || s.SubLanguageID || 'Unknown',
                url: s.SubDownloadLink || s.SubtitlesLink || '',
                downloads: parseInt(s.SubDownloadsCnt || 0),
                source: 'OpenSub'
            })));

            // Stremio
            const stremioSubs = results[1].status === 'fulfilled' ? results[1].value : { subtitles: [] };
            if (stremioSubs.subtitles) {
                allSubs.push(...stremioSubs.subtitles.map(s => ({
                    lang: s.lang || 'Unknown',
                    langName: s.lang || 'Unknown',
                    url: s.url || '',
                    downloads: 0,
                    source: 'Stremio'
                })));
            }

            // SubDL
            const subdlSubs = results[2].status === 'fulfilled' ? results[2].value : [];
            if (Array.isArray(subdlSubs)) {
                allSubs.push(...subdlSubs.map(s => ({
                    lang: s.language || 'Unknown',
                    langName: s.language || 'Unknown',
                    url: s.url || s.download_url || '',
                    downloads: 0,
                    source: 'SubDL'
                })));
            }

            const prefLang = this.storage.get('settings')?.subLang || 'eng';

            // Show ALL subtitle sources (including same language from different providers)
            // Filter out subs with no URL, deduplicate by URL
            const seenUrls = new Set();
            const uniqueSubs = allSubs.filter(sub => {
                if (!sub.url || seenUrls.has(sub.url)) return false;
                seenUrls.add(sub.url);
                return true;
            });

            // Sort: preferred language first, then by downloads
            uniqueSubs.sort((a, b) => {
                const aLang = a.lang.toLowerCase();
                const bLang = b.lang.toLowerCase();
                const aPref = aLang.startsWith(prefLang.substring(0, 2));
                const bPref = bLang.startsWith(prefLang.substring(0, 2));
                if (aPref && !bPref) return -1;
                if (!aPref && bPref) return 1;
                // Same language group: sort by source then downloads
                if (aLang === bLang) return (b.downloads || 0) - (a.downloads || 0);
                return aLang.localeCompare(bLang);
            });

            select.innerHTML = '<option value="">None</option>' + uniqueSubs.map((sub, idx) =>
                `<option value="${sub.url}">${sub.langName} — ${sub.source}</option>`
            ).join('');

            if (uniqueSubs.length === 0) {
                select.innerHTML = '<option value="">No subtitles found</option>';
            } else {
                // Auto-select English subtitles by default
                const engOption = Array.from(select.options).find(o => {
                    const text = o.textContent.toLowerCase();
                    return text.startsWith('eng') || text.startsWith('english') || text.includes('eng ');
                });
                if (engOption && engOption.value) {
                    select.value = engOption.value;
                    this.loadSubtitleTrack(engOption.value);
                }
            }

        } catch (e) {
            select.innerHTML = '<option value="">Subtitles unavailable</option>';
        }
    },

    async loadSubtitleTrack(url) {
        if (!url) {
            Player.disableSubtitles();
            return;
        }
        const proxyUrl = API.getSubtitleFileUrl(url);
        // Don't clear ALL tracks — just add the new one and activate it
        Player.clearSubtitleTracks();
        Player.addSubtitleTrack('Selected', proxyUrl, 'en', true);
        // Reset sync offset for new subtitle
        Player.resetSubtitleOffset();
    },

    async loadWatchEpisodes(seasonNum) {
        try {
            const season = await API.getSeasonDetail(this.watchState.tmdbId, seasonNum);
            const list = document.getElementById('watch-ep-list');
            list.innerHTML = (season.episodes || []).map(ep => `
                <div class="watch-ep-btn ${ep.episode_number == this.watchState.episode && seasonNum == this.watchState.season ? 'active' : ''}"
                     onclick="App.navigate('watch/tv/${this.watchState.tmdbId}/${seasonNum}/${ep.episode_number}')"
                     title="${ep.name}">
                    ${ep.episode_number}
                </div>
            `).join('');
        } catch (e) {
            console.error('Failed to load watch episodes:', e);
        }
    },

    // ─── Favorites ───
    toggleFavorite() {
        if (!this.currentDetail) return;
        const favs = this.storage.get('favorites', []);
        const idx = favs.findIndex(f => f.id === this.currentDetail.id && f.type === this.currentType);
        if (idx >= 0) {
            favs.splice(idx, 1);
            this.showToast('Removed from favorites');
        } else {
            favs.push({
                id: this.currentDetail.id,
                type: this.currentType,
                title: this.currentDetail.title || this.currentDetail.name,
                poster_path: this.currentDetail.poster_path,
                vote_average: this.currentDetail.vote_average,
                release_date: this.currentDetail.release_date || this.currentDetail.first_air_date
            });
            this.showToast('Added to favorites', 'success');
        }
        this.storage.set('favorites', favs);
        this.updateFavoriteButton();
    },

    updateFavoriteButton() {
        if (!this.currentDetail) return;
        const favs = this.storage.get('favorites', []);
        const isFav = favs.some(f => f.id === this.currentDetail.id);
        const btn = document.getElementById('detail-favorite');
        btn.innerHTML = isFav ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
        btn.classList.toggle('active', isFav);
    },

    // ─── Watchlist ───
    toggleWatchlist() {
        if (!this.currentDetail) return;
        const list = this.storage.get('watchlist', []);
        const idx = list.findIndex(f => f.id === this.currentDetail.id && f.type === this.currentType);
        if (idx >= 0) {
            list.splice(idx, 1);
            this.showToast('Removed from watchlist');
        } else {
            list.push({
                id: this.currentDetail.id,
                type: this.currentType,
                title: this.currentDetail.title || this.currentDetail.name,
                poster_path: this.currentDetail.poster_path,
                vote_average: this.currentDetail.vote_average,
                release_date: this.currentDetail.release_date || this.currentDetail.first_air_date
            });
            this.showToast('Added to watchlist', 'success');
        }
        this.storage.set('watchlist', list);
        this.updateWatchlistButton();
    },

    updateWatchlistButton() {
        if (!this.currentDetail) return;
        const list = this.storage.get('watchlist', []);
        const isIn = list.some(f => f.id === this.currentDetail.id);
        const btn = document.getElementById('detail-watchlist');
        btn.innerHTML = isIn ? '<i class="fas fa-bookmark"></i>' : '<i class="far fa-bookmark"></i>';
        btn.classList.toggle('active', isIn);
    },

    loadFavorites() {
        const favs = this.storage.get('favorites', []);
        if (favs.length === 0) {
            document.getElementById('favorites-grid').innerHTML = '';
            document.getElementById('favorites-empty').classList.remove('hidden');
        } else {
            document.getElementById('favorites-empty').classList.add('hidden');
            this.renderGrid('favorites-grid', favs);
        }
    },

    loadWatchlist() {
        const list = this.storage.get('watchlist', []);
        if (list.length === 0) {
            document.getElementById('watchlist-grid').innerHTML = '';
            document.getElementById('watchlist-empty').classList.remove('hidden');
        } else {
            document.getElementById('watchlist-empty').classList.add('hidden');
            this.renderGrid('watchlist-grid', list);
        }
    },

    // ─── History ───
    addToHistory(item) {
        let history = this.storage.get('history', []);
        // Remove duplicate
        history = history.filter(h => !(h.id === item.id && h.type === item.type && h.season === item.season && h.episode === item.episode));
        history.unshift(item);
        if (history.length > 100) history = history.slice(0, 100);
        this.storage.set('history', history);
    },

    loadHistory() {
        const history = this.storage.get('history', []);
        if (history.length === 0) {
            document.getElementById('history-grid').innerHTML = '';
            document.getElementById('history-empty').classList.remove('hidden');
        } else {
            document.getElementById('history-empty').classList.add('hidden');
            this.renderGrid('history-grid', history.map(h => ({
                ...h,
                media_type: h.type
            })));
        }
    },

    // ─── Trailer ───
    playTrailer() {
        const key = document.getElementById('detail-trailer').dataset.key;
        if (!key) return;
        document.getElementById('trailer-iframe').src = `https://www.youtube.com/embed/${key}?autoplay=1&rel=0`;
        document.getElementById('trailer-modal').classList.remove('hidden');
    },

    closeTrailer() {
        document.getElementById('trailer-iframe').src = '';
        document.getElementById('trailer-modal').classList.add('hidden');
    },

    // ─── Person Filmography ───
    async showPersonFilmography(personId) {
        try {
            this.showLoading();
            const person = await API.getPerson(personId);
            this.hideLoading();

            // Combine cast credits, sort by popularity — filter out dubious/uncredited entries
            const credits = person.combined_credits?.cast || [];
            const sorted = credits
                .filter(c => c.poster_path && (c.vote_count || 0) >= 3 && c.character && c.character.toLowerCase() !== 'self')
                .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
                .slice(0, 40);

            // Build modal content
            const modal = document.getElementById('person-modal');
            document.getElementById('person-name').textContent = person.name;
            document.getElementById('person-photo').src = API.posterLg(person.profile_path) || '/img/no-avatar.svg';
            document.getElementById('person-photo').onerror = function() { this.src = '/img/no-avatar.svg'; };

            // Bio
            const bio = person.biography?.slice(0, 300) || 'No biography available.';
            document.getElementById('person-bio').textContent = bio + (person.biography?.length > 300 ? '...' : '');

            // Info
            const infoHtml = [];
            if (person.birthday) infoHtml.push(`<span><i class="fas fa-birthday-cake"></i> ${person.birthday}</span>`);
            if (person.place_of_birth) infoHtml.push(`<span><i class="fas fa-map-marker-alt"></i> ${person.place_of_birth}</span>`);
            if (person.known_for_department) infoHtml.push(`<span><i class="fas fa-star"></i> ${person.known_for_department}</span>`);
            document.getElementById('person-info').innerHTML = infoHtml.join('');

            // Filmography grid  
            document.getElementById('person-filmography').innerHTML = sorted.map(item => {
                const title = item.title || item.name;
                const year = (item.release_date || item.first_air_date || '').split('-')[0];
                const type = item.media_type || (item.title ? 'movie' : 'tv');
                const rating = item.vote_average?.toFixed(1) || '';
                return `
                    <div class="filmography-card" onclick="document.getElementById('person-modal').classList.add('hidden');App.navigate('${type}/${item.id}')">
                        <img src="${API.poster(item.poster_path)}" alt="${title}" loading="lazy" onerror="this.src='/img/no-poster.svg'">
                        <div class="filmography-info">
                            <h4>${title}</h4>
                            <span>${year}${item.character ? ' • ' + item.character : ''}${rating ? ' • ★ ' + rating : ''}</span>
                        </div>
                    </div>
                `;
            }).join('');

            modal.classList.remove('hidden');
        } catch (e) {
            this.hideLoading();
            this.showToast('Could not load filmography', 'error');
            console.error(e);
        }
    },

    closePersonModal() {
        document.getElementById('person-modal').classList.add('hidden');
    },

    // ─── Genres ───
    async loadGenres() {
        try {
            const [movieGenres, tvGenres] = await Promise.all([
                API.getGenres('movie'),
                API.getGenres('tv')
            ]);
            this.genresCache.movie = movieGenres.genres;
            this.genresCache.tv = tvGenres.genres;

            // Populate filter dropdowns
            const movieFilter = document.getElementById('movie-genre-filter');
            movieGenres.genres.forEach(g => {
                movieFilter.innerHTML += `<option value="${g.id}">${g.name}</option>`;
            });
            const tvFilter = document.getElementById('tv-genre-filter');
            tvGenres.genres.forEach(g => {
                tvFilter.innerHTML += `<option value="${g.id}">${g.name}</option>`;
            });
        } catch (e) {
            console.error('Failed to load genres:', e);
        }
    },

    populateYearFilters() {
        const currentYear = new Date().getFullYear();
        ['movie-year-filter', 'tv-year-filter'].forEach(id => {
            const select = document.getElementById(id);
            for (let y = currentYear; y >= 1970; y--) {
                select.innerHTML += `<option value="${y}">${y}</option>`;
            }
        });
    },

    // ─── Theme ───
    loadTheme() {
        const theme = this.storage.get('theme', 'dark');
        this.setTheme(theme);
    },

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.storage.set('theme', theme);
        const icon = document.querySelector('#theme-toggle i');
        const lightThemes = ['light', 'arctic'];
        icon.className = lightThemes.includes(theme) ? 'fas fa-sun' : 'fas fa-moon';
        const settingSelect = document.getElementById('setting-theme');
        if (settingSelect) settingSelect.value = theme;
    },

    toggleTheme() {
        const themes = ['dark', 'light', 'midnight', 'ocean', 'forest', 'sunset', 'rosegold', 'nebula', 'arctic', 'mocha', 'crimson', 'emerald'];
        const current = this.storage.get('theme', 'dark');
        const idx = themes.indexOf(current);
        this.setTheme(themes[(idx + 1) % themes.length]);
    },

    // ─── Settings ───
    loadSettings() {
        const settings = this.storage.get('settings', {});
        if (settings.subLang) document.getElementById('setting-sub-lang').value = settings.subLang;
        if (settings.autoplay !== undefined) document.getElementById('setting-autoplay').checked = settings.autoplay;

        // Save settings on change
        ['setting-sub-lang', 'setting-autoplay', 'setting-default-source'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => this.saveSettings());
        });
    },

    saveSettings() {
        this.storage.set('settings', {
            subLang: document.getElementById('setting-sub-lang').value,
            autoplay: document.getElementById('setting-autoplay').checked,
            defaultSource: document.getElementById('setting-default-source').value
        });
        this.showToast('Settings saved', 'success');
    },

    exportData() {
        const data = {
            favorites: this.storage.get('favorites', []),
            watchlist: this.storage.get('watchlist', []),
            history: this.storage.get('history', []),
            continueWatching: this.storage.get('continueWatching', []),
            settings: this.storage.get('settings', {}),
            theme: this.storage.get('theme', 'dark')
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'filmplus_backup.json';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Data exported', 'success');
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    if (data.favorites) this.storage.set('favorites', data.favorites);
                    if (data.watchlist) this.storage.set('watchlist', data.watchlist);
                    if (data.history) this.storage.set('history', data.history);
                    if (data.continueWatching) this.storage.set('continueWatching', data.continueWatching);
                    if (data.settings) this.storage.set('settings', data.settings);
                    if (data.theme) this.storage.set('theme', data.theme);
                    this.showToast('Data imported successfully', 'success');
                    location.reload();
                } catch {
                    this.showToast('Invalid backup file', 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    },

    // ─── Toast Notifications ───
    showToast(message, type = '') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // ─── Continue Watching — Watch Progress Tracking ───

    _watchProgressTimer: null,
    _watchProgressMeta: null,

    _startWatchProgressTracker(detail, type, season, episode) {
        this._stopWatchProgressTracker();
        this._watchProgressMeta = {
            id: detail.id,
            type,
            title: detail.title || detail.name,
            poster_path: detail.poster_path,
            backdrop_path: detail.backdrop_path,
            season: season ? parseInt(season) : null,
            episode: episode ? parseInt(episode) : null
        };
        // Save progress every 10 seconds
        this._watchProgressTimer = setInterval(() => this._saveWatchProgressNow(), 10000);
        // Also save on video pause and on beforeunload
        const video = document.getElementById('player-video');
        if (video) {
            video.addEventListener('pause', this._onVideoPause = () => this._saveWatchProgressNow());
        }
        window.addEventListener('beforeunload', this._onBeforeUnload = () => this._saveWatchProgressNow());
    },

    _stopWatchProgressTracker() {
        if (this._watchProgressTimer) {
            clearInterval(this._watchProgressTimer);
            this._watchProgressTimer = null;
        }
        const video = document.getElementById('player-video');
        if (video && this._onVideoPause) {
            video.removeEventListener('pause', this._onVideoPause);
        }
        if (this._onBeforeUnload) {
            window.removeEventListener('beforeunload', this._onBeforeUnload);
        }
        this._watchProgressMeta = null;
    },

    _saveWatchProgressNow() {
        const meta = this._watchProgressMeta;
        const video = document.getElementById('player-video');
        if (!meta || !video || !video.duration || video.duration < 60) return;
        const currentTime = video.currentTime;
        const duration = video.duration;
        // Only save if watched at least 30s and not finished (within last 5 min for movies, 2 min for episodes)
        const endThreshold = meta.type === 'tv' ? 120 : 300;
        if (currentTime < 30) return;
        // If basically finished, remove from continue watching
        if (currentTime >= duration - endThreshold) {
            this._removeContinueWatching(meta.id, meta.type, meta.season, meta.episode);
            return;
        }
        const progress = {
            id: meta.id,
            type: meta.type,
            title: meta.title,
            poster_path: meta.poster_path,
            backdrop_path: meta.backdrop_path,
            season: meta.season,
            episode: meta.episode,
            currentTime: Math.floor(currentTime),
            duration: Math.floor(duration),
            percent: Math.floor((currentTime / duration) * 100),
            updatedAt: Date.now()
        };
        let items = this.storage.get('continueWatching', []);
        // Remove existing entry for same content
        items = items.filter(i => !(i.id === meta.id && i.type === meta.type &&
            i.season === meta.season && i.episode === meta.episode));
        items.unshift(progress);
        if (items.length > 30) items = items.slice(0, 30);
        this.storage.set('continueWatching', items);
    },

    _removeContinueWatching(id, type, season, episode) {
        let items = this.storage.get('continueWatching', []);
        items = items.filter(i => !(i.id === id && i.type === type &&
            i.season == season && i.episode == episode));
        this.storage.set('continueWatching', items);
    },

    loadContinueWatching() {
        const section = document.getElementById('continue-watching');
        if (!section) return;
        const items = this.storage.get('continueWatching', []);
        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = '';
        const row = section.querySelector('.row-scroll');
        row.innerHTML = items.map(item => this._createContinueWatchingCard(item)).join('');

        // Bind clear button
        const clearBtn = document.getElementById('cw-clear-btn');
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', () => {
                this.storage.set('continueWatching', []);
                section.style.display = 'none';
                this.showToast('Continue watching cleared');
            });
        }
    },

    _createContinueWatchingCard(item) {
        const title = item.title || 'Unknown';
        const percent = item.percent || 0;
        const timeLeft = item.duration - item.currentTime;
        const minLeft = Math.ceil(timeLeft / 60);
        const timeLabel = minLeft >= 60 ? `${Math.floor(minLeft / 60)}h ${minLeft % 60}m left` : `${minLeft}m left`;
        const epLabel = item.type === 'tv' && item.season && item.episode
            ? `<span class="cw-ep">S${item.season}:E${item.episode}</span>` : '';
        const watchHash = item.type === 'tv'
            ? `watch/${item.type}/${item.id}/${item.season}/${item.episode}`
            : `watch/${item.type}/${item.id}`;

        return `
            <div class="card cw-card" data-id="${item.id}" data-type="${item.type}" onclick="App.navigate('${watchHash}')">
                <div class="card-poster">
                    <img src="${API.poster(item.poster_path)}" alt="${title}" loading="lazy" onerror="this.src='/img/no-poster.svg'">
                    <div class="cw-overlay">
                        <div class="cw-play"><i class="fas fa-play"></i></div>
                        <div class="cw-time">${timeLabel}</div>
                        ${epLabel}
                    </div>
                    <div class="cw-progress-bar"><div class="cw-progress" style="width:${percent}%"></div></div>
                    <button class="cw-remove" onclick="event.stopPropagation(); App._removeCWCard(${item.id}, '${item.type}', ${item.season || 'null'}, ${item.episode || 'null'})" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="card-info">
                    <h3>${title}</h3>
                    <span class="cw-meta">${item.type === 'tv' ? `S${item.season} E${item.episode}` : `${percent}% watched`}</span>
                </div>
            </div>
        `;
    },

    _removeCWCard(id, type, season, episode) {
        this._removeContinueWatching(id, type, season, episode);
        this.loadContinueWatching();
    },

    // ─── Loading ───
    showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); },
    hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => App.init());
