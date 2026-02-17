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
        document.getElementById('menu-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Click outside sidebar to close on mobile
        document.getElementById('main-content').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
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
                ['favorites', 'watchlist', 'history', 'settings'].forEach(k => this.storage.remove(k));
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

        // Genres
        document.getElementById('detail-genres').innerHTML = (data.genres || []).map(g =>
            `<span class="genre-tag">${g.name}</span>`
        ).join('');

        // Overview
        document.getElementById('detail-overview').textContent = data.overview || 'No description available.';

        // Favorite / Watchlist buttons
        this.updateFavoriteButton();
        this.updateWatchlistButton();

        // Cast
        const castScroll = document.querySelector('#detail-cast .cast-scroll');
        const cast = data.credits?.cast?.slice(0, 20) || [];
        castScroll.innerHTML = cast.map(person => `
            <div class="cast-card">
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

        // Similar
        const similar = data.similar?.results?.slice(0, 15) || [];
        this.renderRow('detail-similar', similar, type);
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
        this._extractionFailed = false; // Reset for new content

        try {
            // Load detail info
            const detail = type === 'movie' ? await API.getMovieDetail(tmdbId) : await API.getTVDetail(tmdbId);
            this.watchState.detail = detail;

            // Set title
            document.getElementById('watch-title').textContent = detail.title || detail.name;
            if (type === 'tv') {
                document.getElementById('watch-ep-info').textContent = `Season ${season} • Episode ${episode}`;
            } else {
                document.getElementById('watch-ep-info').textContent = (detail.release_date || '').split('-')[0];
            }

            // Load sources
            await this.loadSources();

            // Load subtitles
            this.loadSubtitlesForWatch(detail);

            // Show episode selector for TV
            if (type === 'tv' && detail.seasons) {
                const epSection = document.getElementById('watch-episodes');
                epSection.classList.remove('hidden');
                const seasonSelect = document.getElementById('watch-season-select');
                seasonSelect.innerHTML = detail.seasons
                    .filter(s => s.season_number > 0)
                    .map(s => `<option value="${s.season_number}" ${s.season_number == season ? 'selected' : ''}>Season ${s.season_number}</option>`)
                    .join('');
                this.loadWatchEpisodes(parseInt(season) || 1);
            } else {
                document.getElementById('watch-episodes').classList.add('hidden');
            }

            // Add to history
            this.addToHistory({
                id: detail.id,
                type,
                title: detail.title || detail.name,
                poster_path: detail.poster_path,
                season, episode,
                timestamp: Date.now()
            });

        } catch (e) {
            console.error('Failed to load watch page:', e);
            this.showToast('Failed to load player', 'error');
        }
    },

    async loadSources() {
        if (!this.sourcesCache) {
            this.sourcesCache = await API.getSources();
        }
        const select = document.getElementById('source-select');
        select.innerHTML = this.sourcesCache.map(s =>
            `<option value="${s.id}">${s.name} ${s.quality || ''}</option>`
        ).join('');

        // Also populate settings default source
        const settingSelect = document.getElementById('setting-default-source');
        if (settingSelect && settingSelect.children.length === 0) {
            settingSelect.innerHTML = this.sourcesCache.map(s =>
                `<option value="${s.id}">${s.name} ${s.quality || ''}</option>`
            ).join('');
        }

        // Use default source from settings, or auto-select best quality embed source
        const defaultSource = this.storage.get('settings')?.defaultSource;
        if (defaultSource) {
            select.value = defaultSource;
        } else {
            // Auto-select highest quality working embed source (skip API-only providers)
            const bestSource = this.sourcesCache.find(s => !s.apiOnly);
            if (bestSource) select.value = bestSource.id;
        }

        // Load the source
        this.changeSource(select.value);
    },

    _failedSources: new Set(),

    async changeSource(providerId) {
        const { tmdbId, type, season, episode, detail } = this.watchState;
        const imdbId = detail?.external_ids?.imdb_id || '';

        // ─── Strategy: Extract direct stream first (ad-free), fallback to embed ───
        // Try direct HLS extraction (no ads, plays in our own player)
        if (!this._extractionFailed) {
            try {
                this.showToast('Extracting stream...', 'info');
                const stream = await API.extractStream(tmdbId, type, season, episode);
                if (stream.success && stream.hlsUrl) {
                    Player.playHLSUrl(stream.hlsUrl);
                    this._failedSources.clear();
                    this.showToast('Playing ad-free stream', 'success');
                    
                    // Add extracted subtitles if any
                    if (stream.subtitles && stream.subtitles.length > 0) {
                        stream.subtitles.forEach((sub, i) => {
                            const label = (typeof sub === 'object') ? (sub.label || `Sub ${i + 1}`) : `Sub ${i + 1}`;
                            const url = (typeof sub === 'object') ? sub.url : sub;
                            const lang = (typeof sub === 'object') ? (sub.lang || 'en') : 'en';
                            Player.addSubtitleTrack(label, url, lang, i === 0);
                        });
                    }
                    return;
                }
            } catch (e) {
                console.warn('Stream extraction failed:', e.message);
            }
            // Mark extraction as failed so we don't retry on every source change
            this._extractionFailed = true;
        }

        // Fallback: use embed iframe
        try {
            const result = await API.getSourceUrl(providerId, tmdbId, type, season, episode, imdbId);

            if (result.apiProvider) {
                const success = await this.tryApiProvider(result.apiProvider, detail, type, season, episode);
                if (!success) {
                    this._failedSources.add(providerId);
                    this.autoFallbackSource();
                }
                return;
            }

            if (result.url) {
                Player.playEmbed(result.url);
                this._failedSources.clear();
                this.activateAdShield();
            } else {
                this._failedSources.add(providerId);
                this.autoFallbackSource();
            }
        } catch (e) {
            console.error('changeSource error:', e);
            this._failedSources.add(providerId);
            this.showToast('Source unavailable, trying next...', 'error');
            this.autoFallbackSource();
        }
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

    // Auto-fallback to next best embed source (tracks all failed sources to prevent loops)
    autoFallbackSource() {
        if (!this.sourcesCache) return;
        const select = document.getElementById('source-select');
        // Find next embed source that hasn't failed yet
        const nextSource = this.sourcesCache.find(s => !this._failedSources.has(s.id) && !s.apiOnly);
        if (nextSource) {
            select.value = nextSource.id;
            this.showToast(`Trying ${nextSource.name} ${nextSource.quality || ''}...`, 'info');
            this.changeSource(nextSource.id);
        } else {
            // All sources tried, reset and just use first embed source
            this._failedSources.clear();
            const firstEmbed = this.sourcesCache.find(s => !s.apiOnly);
            if (firstEmbed) {
                select.value = firstEmbed.id;
                Player.playEmbed('');
            }
            this.showToast('No working sources available', 'error');
        }
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

            // Group by language, pick best per language
            const langMap = {};
            allSubs.forEach(sub => {
                if (!sub.url) return;
                const key = sub.lang.toLowerCase();
                if (!langMap[key] || sub.downloads > (langMap[key].downloads || 0)) {
                    langMap[key] = sub;
                }
            });

            const entries = Object.entries(langMap).sort((a, b) => {
                if (a[0].startsWith(prefLang.substring(0, 2))) return -1;
                if (b[0].startsWith(prefLang.substring(0, 2))) return 1;
                return (b[1].downloads || 0) - (a[1].downloads || 0);
            });

            select.innerHTML = '<option value="">None</option>' + entries.map(([lang, sub]) =>
                `<option value="${sub.url}">${sub.langName} (${sub.source})</option>`
            ).join('');

            if (entries.length === 0) {
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
        if (!url) return;
        const proxyUrl = API.getSubtitleFileUrl(url);
        Player.clearSubtitleTracks();
        Player.addSubtitleTrack('Selected', proxyUrl, 'en', true);
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
        icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        const settingSelect = document.getElementById('setting-theme');
        if (settingSelect) settingSelect.value = theme;
    },

    toggleTheme() {
        const current = this.storage.get('theme', 'dark');
        this.setTheme(current === 'dark' ? 'light' : 'dark');
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

    // ─── Loading ───
    showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); },
    hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => App.init());
