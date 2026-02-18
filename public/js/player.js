/* ═══════════════════════════════════════════════════
   FilmPlus Web — Player Module (HDOBox-style)
   Direct HLS extraction + iframe embed fallback
   Full-screen overlay player with source preloading
   ═══════════════════════════════════════════════════ */

const Player = (() => {

    /* ── State ── */
    let currentType = null;
    let currentId = null;
    let currentSeason = null;
    let currentEpisode = null;
    let currentTitle = '';
    let currentDetail = null;
    let currentProvider = null;
    let currentImdbId = null;
    let sources = [];
    let hls = null;
    let positionInterval = null;
    let resumed = false;
    let sessionGen = 0;

    /* Preloaded stream cache */
    const preloadedStreams = new Map();

    /* ── DOM refs ── */
    const overlay     = document.getElementById('player-overlay');
    const iframe      = document.getElementById('ov-player-iframe');
    const video       = document.getElementById('ov-player-video');
    const sourceSelect= document.getElementById('ov-source-select');
    const titleEl     = document.querySelector('.player-title');
    const loading     = document.querySelector('.player-loading');
    const loaderStatus= document.getElementById('loader-status');
    const loaderSources = document.getElementById('loader-sources');
    const loaderBarFill = document.getElementById('loader-bar-fill');
    const seasonTabs  = document.querySelector('.season-tabs');
    const episodeList = document.querySelector('.episode-list');
    const episodeBar  = document.querySelector('.episode-bar');

    /* ── Init ── */

    async function init() {
        try {
            const rawSources = await API.getSources();
            // Filter out API-only sources (MorphTV, TeaTV etc.) — they need special handling
            sources = rawSources.filter(s => !s.apiOnly);
        } catch (err) {
            console.warn('Failed to load sources:', err);
            sources = [];
        }
        buildSourceSelect();
        sourceSelect.addEventListener('change', onSourceChange);
        document.querySelector('.player-back').addEventListener('click', close);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) close();
        });
        initKeyboardControls();
    }

    function buildSourceSelect() {
        sourceSelect.innerHTML = '';
        sources.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name + (s.quality ? ` (${s.quality})` : '');
            sourceSelect.appendChild(opt);
        });
    }

    /* ── Keyboard Controls ── */

    function initKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            if (!overlay.classList.contains('active')) return;
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (video.style.display === 'none') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    if (video.paused) video.play().catch(() => {});
                    else video.pause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    video.volume = Math.min(1, video.volume + 0.1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    video.volume = Math.max(0, video.volume - 0.1);
                    break;
                case 'KeyF':
                    e.preventDefault();
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
                    else video.requestFullscreen().catch(() => {});
                    break;
                case 'KeyM':
                    e.preventDefault();
                    video.muted = !video.muted;
                    break;
            }
        });
    }

    /* ── Open Player ── */

    async function play(type, id, detail, season, episode) {
        const gen = ++sessionGen;

        currentType = type;
        currentId = id;
        currentDetail = detail;
        currentImdbId = detail.imdb_id || detail.external_ids?.imdb_id || null;
        currentSeason = season || null;
        currentEpisode = episode || null;
        resumed = false;
        preloadedStreams.clear();
        destroyHLS();
        hideAllPlayers();

        currentTitle = detail.title || detail.name || '';
        if (type === 'tv' && season && episode) {
            currentTitle += ` S${season}E${episode}`;
        }
        titleEl.textContent = currentTitle;

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Show episode bar for TV
        if (type === 'tv') {
            episodeBar.style.display = '';
            buildSeasonTabs(detail, season);
            buildEpisodeList(detail, season, episode);
        } else {
            episodeBar.style.display = 'none';
        }

        // Load first source and preload all
        currentProvider = sourceSelect.value;
        loadSource(currentProvider, gen).catch(e => console.warn('loadSource unhandled:', e));
        preloadAllSources(gen).catch(e => console.warn('preloadAllSources unhandled:', e));
    }

    /* ── Preload all sources in parallel ── */

    async function preloadAllSources(gen) {
        buildLoaderSources();
        let done = 0;
        let readyCount = 0;
        const total = sources.length;

        const promises = sources.map(async (s) => {
            if (gen !== sessionGen) return;
            setSourceStatus(s.id, 'testing');
            try {
                const stream = await API.extractStream(
                    currentId, currentType,
                    currentSeason, currentEpisode,
                    s.id
                );
                if (gen !== sessionGen) return;
                preloadedStreams.set(s.id, stream);
                if (stream.success) {
                    setSourceStatus(s.id, 'ready');
                    readyCount++;
                } else {
                    setSourceStatus(s.id, 'failed');
                }
            } catch {
                if (gen !== sessionGen) return;
                preloadedStreams.set(s.id, { success: false });
                setSourceStatus(s.id, 'failed');
            }
            done++;
            if (gen === sessionGen) {
                updateLoaderUI(
                    readyCount > 0 ? `${readyCount} source${readyCount > 1 ? 's' : ''} ready` : `Testing sources... (${done}/${total})`,
                    (done / total) * 100
                );
            }
        });
        await Promise.allSettled(promises);
        if (gen === sessionGen && readyCount === 0) {
            updateLoaderUI('No sources available', 100);
        }
    }

    /* ── Load a Source ── */

    async function loadSource(provider, gen) {
        if (gen !== undefined && gen !== sessionGen) return;
        showLoading(true);
        destroyHLS();
        hideAllPlayers();
        currentProvider = provider;
        updateLoaderUI('Extracting stream...', 20);

        try {
            let data = preloadedStreams.get(provider);
            if (!data) {
                updateLoaderUI('Fetching stream URL...', 40);
                data = await API.extractStream(
                    currentId, currentType,
                    currentSeason, currentEpisode,
                    provider
                );
            }

            if (gen !== undefined && gen !== sessionGen) return;

            if (data.success && data.hlsUrl) {
                updateLoaderUI('Buffering video...', 80);
                playHLS(data.hlsUrl);
                if (data.subtitles?.length) {
                    addSubtitles(data.subtitles);
                } else {
                    loadFallbackSubtitles().catch(() => {});
                }
            } else if (data.success && data.isEmbed && data.embedUrl) {
                updateLoaderUI('Loading player...', 70);
                iframe.src = data.embedUrl;
                iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
                iframe.setAttribute('referrerpolicy', 'origin');
                iframe.style.display = 'block';
                iframe.onload = () => showLoading(false);
                iframe.onerror = () => showLoading(false);
                setTimeout(() => showLoading(false), 8000);
            } else {
                const fallback = findNextWorkingSource(provider);
                if (fallback) {
                    console.log(`Source "${provider}" failed, auto-switching to "${fallback}"`);
                    sourceSelect.value = fallback;
                    return loadSource(fallback, gen);
                }
                showLoading(false);
                App.showToast(data.error ? 'Source unavailable — try another' : 'Source not available — try another');
            }
        } catch (err) {
            if (gen !== undefined && gen !== sessionGen) return;
            console.error('loadSource error:', err);
            const fallback = findNextWorkingSource(provider);
            if (fallback) {
                console.log(`Source "${provider}" error, auto-switching to "${fallback}"`);
                sourceSelect.value = fallback;
                return loadSource(fallback, gen);
            }
            showLoading(false);
            App.showToast('Failed to load source — try another');
        }
    }

    /* ── Find next working preloaded source ── */
    function findNextWorkingSource(failedProvider) {
        for (const s of sources) {
            if (s.id === failedProvider) continue;
            const cached = preloadedStreams.get(s.id);
            if (cached && cached.success) return s.id;
        }
        return null;
    }

    /* ── Subtitle handling ── */

    function addSubtitles(subs) {
        clearSubtitles();
        subs.forEach((sub, i) => {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = sub.label || sub.lang || 'Sub';
            track.srclang = sub.lang || 'en';
            track.src = sub.url;
            if (i === 0) track.default = true;
            video.appendChild(track);
        });
    }

    function clearSubtitles() {
        video.querySelectorAll('track').forEach(t => t.remove());
    }

    /* ── Subtitle Fallback (Stremio OpenSubtitles) ── */

    async function loadFallbackSubtitles() {
        if (!currentImdbId) return;
        try {
            const data = await API.fetchSubtitles(currentType, currentImdbId, currentSeason, currentEpisode);
            if (data.subtitles?.length) {
                addSubtitles(data.subtitles.slice(0, 8));
            }
        } catch (e) {
            // Silently ignore
        }
    }

    /* ── HLS Playback (direct streams) ── */

    function playHLS(url) {
        destroyHLS();
        hideAllPlayers();
        video.style.display = 'block';
        showLoading(true);

        let loadingHidden = false;
        function hideLoadingOnce() {
            if (loadingHidden) return;
            loadingHidden = true;
            showLoading(false);
        }

        if (Hls.isSupported()) {
            hls = new Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
                maxBufferSize: 120 * 1000 * 1000,
                maxBufferHole: 0.1,
                startLevel: -1,
                capLevelToPlayerSize: true,
                capLevelOnFPSDrop: true,
                progressive: true,
                lowLatencyMode: false,
                backBufferLength: 30,
                enableWorker: true,
                startFragPrefetch: true,
                abrEwmaDefaultEstimate: 800000,
                abrBandWidthUpFactor: 0.7,
                abrBandWidthFactor: 0.95,
                abrMaxWithRealBitrate: true,
                fragLoadPolicy: {
                    default: {
                        maxTimeToFirstByteMs: 8000,
                        maxLoadTimeMs: 20000,
                        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 8000 },
                        errorRetry: { maxNumRetry: 8, retryDelayMs: 200, maxRetryDelayMs: 8000, backoff: 'exponential' }
                    }
                },
                manifestLoadPolicy: {
                    default: {
                        maxTimeToFirstByteMs: 10000,
                        maxLoadTimeMs: 15000,
                        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
                        errorRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 8000, backoff: 'exponential' }
                    }
                }
            });

            hls.loadSource(url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                updateLoaderUI('Buffering video...', 90);
                resumePosition();
                video.play().catch(() => {});
            });

            video.addEventListener('playing', hideLoadingOnce, { once: true });
            video.addEventListener('canplay', () => {
                setTimeout(hideLoadingOnce, 500);
            }, { once: true });
            setTimeout(hideLoadingOnce, 10000);

            // Network retry with exponential backoff
            let networkRetries = 0;
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    console.error('HLS fatal error:', data);
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        networkRetries++;
                        if (networkRetries <= 8) {
                            const delay = Math.min(500 * Math.pow(1.5, networkRetries - 1), 8000);
                            console.warn(`[HLS] Fatal network error, retry #${networkRetries} in ${delay}ms`);
                            setTimeout(() => { if (hls) hls.startLoad(); }, delay);
                        } else {
                            hideLoadingOnce();
                            App.showToast('Stream error — try another source');
                        }
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    } else {
                        hideLoadingOnce();
                        App.showToast('Stream error — try another source');
                    }
                } else if (data.details === 'bufferStalledError') {
                    // Stall recovery: drop quality
                    if (hls) {
                        const currentLevel = hls.currentLevel;
                        if (currentLevel > 0) {
                            hls.currentLevel = 0;
                            setTimeout(() => { if (hls) hls.currentLevel = -1; }, 6000);
                        }
                        hls.startLoad(video.currentTime);
                    }
                }
            });

            // Reset retry counter on successful fragment
            hls.on(Hls.Events.FRAG_BUFFERED, () => { networkRetries = 0; });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('playing', hideLoadingOnce, { once: true });
            video.addEventListener('loadedmetadata', () => {
                resumePosition();
                video.play().catch(() => {});
            }, { once: true });
            setTimeout(hideLoadingOnce, 10000);
        } else {
            showLoading(false);
            App.showToast('HLS not supported in this browser');
        }

        startPositionTracking();
    }

    function destroyHLS() {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.removeAttribute('src');
        video.load();
    }

    /* ── Position Tracking ── */

    function resumePosition() {
        if (resumed) return;
        const saved = API.getPosition(currentType, currentId, currentSeason, currentEpisode);
        if (!saved || saved <= 5) { resumed = true; return; }

        function doSeek() {
            if (resumed) return;
            resumed = true;
            if (video.duration && isFinite(video.duration) && saved >= video.duration - 10) return;
            video.currentTime = saved;
            App.showToast(`Resumed from ${formatTime(saved)}`);
        }

        if (video.readyState >= 3) { doSeek(); return; }
        video.addEventListener('playing', doSeek, { once: true });
        video.addEventListener('canplay', doSeek, { once: true });
        setTimeout(doSeek, 5000);
    }

    function startPositionTracking() {
        stopPositionTracking();
        positionInterval = setInterval(() => {
            if (!video.paused && video.currentTime > 0 && video.duration > 0) {
                API.savePosition(currentType, currentId, currentSeason, currentEpisode, video.currentTime);
                API.updateContinueWatching({
                    id: currentId,
                    type: currentType,
                    title: currentDetail.title || currentDetail.name,
                    poster_path: currentDetail.poster_path,
                    backdrop_path: currentDetail.backdrop_path,
                    season: currentSeason,
                    episode: currentEpisode,
                    currentTime: Math.floor(video.currentTime),
                    duration: Math.floor(video.duration),
                    percent: Math.floor((video.currentTime / video.duration) * 100),
                    updatedAt: Date.now()
                });
            }
        }, 5000);
    }

    function stopPositionTracking() {
        if (positionInterval) {
            clearInterval(positionInterval);
            positionInterval = null;
        }
    }

    function formatTime(s) {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    }

    /* ── Episode Navigation ── */

    function buildSeasonTabs(detail, activeSeason) {
        seasonTabs.innerHTML = '';
        const seasons = (detail.seasons || []).filter(s => s.season_number > 0);
        seasons.forEach(s => {
            const chip = document.createElement('div');
            chip.className = 'season-tab' + (s.season_number == activeSeason ? ' active' : '');
            chip.textContent = `Season ${s.season_number}`;
            chip.addEventListener('click', () => selectSeason(detail, s.season_number));
            seasonTabs.appendChild(chip);
        });
    }

    async function selectSeason(detail, seasonNum) {
        currentSeason = seasonNum;
        buildSeasonTabs(detail, seasonNum);
        try {
            const seasonData = await API.getSeasonDetail(currentId, seasonNum);
            buildEpisodeChips(seasonData.episodes || [], seasonNum, currentEpisode);
        } catch (err) {
            console.error('Failed to load season:', err);
        }
    }

    function buildEpisodeList(detail, season, episode) {
        episodeList.innerHTML = '<div class="ep-chip">Loading...</div>';
        API.getSeasonDetail(currentId, season).then(data => {
            buildEpisodeChips(data.episodes || [], season, episode);
        }).catch(() => {
            episodeList.innerHTML = '';
        });
    }

    function buildEpisodeChips(episodes, season, activeEp) {
        episodeList.innerHTML = '';
        episodes.forEach(ep => {
            const chip = document.createElement('div');
            chip.className = 'ep-chip' + (ep.episode_number == activeEp ? ' active' : '');
            chip.textContent = `E${ep.episode_number}: ${ep.name || 'Episode ' + ep.episode_number}`;
            chip.title = ep.overview || '';
            chip.addEventListener('click', () => playEpisode(season, ep.episode_number));
            episodeList.appendChild(chip);
        });
    }

    function playEpisode(season, episode) {
        const gen = ++sessionGen;
        currentSeason = season;
        currentEpisode = episode;
        resumed = false;
        preloadedStreams.clear();

        currentTitle = (currentDetail.title || currentDetail.name || '') + ` S${season}E${episode}`;
        titleEl.textContent = currentTitle;

        episodeList.querySelectorAll('.ep-chip').forEach(c => {
            const epNum = parseInt(c.textContent.match(/E(\d+)/)?.[1]);
            c.classList.toggle('active', epNum === episode);
        });

        loadSource(currentProvider, gen).catch(e => console.warn('loadSource unhandled:', e));
        preloadAllSources(gen).catch(e => console.warn('preloadAllSources unhandled:', e));

        history.replaceState(null, '', `#watch/tv/${currentId}/${season}/${episode}`);
    }

    /* ── Close ── */

    function close(skipNav) {
        sessionGen++;
        currentImdbId = null;
        destroyHLS();
        hideAllPlayers();
        stopPositionTracking();
        clearSubtitles();
        iframe.src = 'about:blank';
        preloadedStreams.clear();
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        if (!skipNav && currentType && currentId) {
            location.hash = `${currentType}/${currentId}`;
        }
    }

    /* ── Helpers ── */

    function hideAllPlayers() {
        video.pause();
        iframe.style.display = 'none';
        video.style.display = 'none';
        iframe.src = 'about:blank';
    }

    function showLoading(show) {
        if (show) {
            loading.style.display = 'flex';
            loading.offsetHeight;
            loading.classList.remove('hidden');
            updateLoaderUI('Connecting to servers...', 0);
        } else {
            loading.classList.add('hidden');
            setTimeout(() => {
                if (loading.classList.contains('hidden')) {
                    loading.style.display = 'none';
                }
            }, 600);
        }
    }

    function updateLoaderUI(statusText, progress) {
        if (loaderStatus) loaderStatus.textContent = statusText;
        if (loaderBarFill) loaderBarFill.style.width = Math.min(progress, 100) + '%';
    }

    function buildLoaderSources() {
        if (!loaderSources) return;
        loaderSources.innerHTML = '';
        sources.forEach(s => {
            const el = document.createElement('div');
            el.className = 'loader-src';
            el.id = 'lsrc-' + s.id;
            el.innerHTML = `<span class="src-dot"></span><span>${s.name}</span>`;
            loaderSources.appendChild(el);
        });
    }

    function setSourceStatus(srcId, status) {
        const el = document.getElementById('lsrc-' + srcId);
        if (el) {
            el.classList.remove('testing', 'ready', 'failed');
            if (status) el.classList.add(status);
        }
    }

    function onSourceChange() {
        if (video.currentTime > 0 && video.duration > 0) {
            API.savePosition(currentType, currentId, currentSeason, currentEpisode, video.currentTime);
        }
        resumed = false;
        loadSource(sourceSelect.value, sessionGen).catch(e => console.warn('loadSource unhandled:', e));
    }

    /* ── Public ── */

    return {
        init,
        play,
        playHLS,
        playEpisode,
        close,
        stop: () => close(true),
        get currentId() { return currentId; },
        get currentType() { return currentType; }
    };
})();
