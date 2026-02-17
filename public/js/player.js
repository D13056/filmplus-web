/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - Player Module v2
   Video player with HLS, loading overlay, quality UI,
   subtitle sync, prebuffering & position memory
   ═══════════════════════════════════════════════════════════ */

const Player = {
    iframe: null,
    video: null,
    hls: null,
    currentSubs: [],
    _savedPosition: 0,
    _subtitleOffset: 0,
    _subtitleFontSize: 100,
    _subtitleBg: 'rgba(0,0,0,0.75)',
    _playbackSpeed: 1,
    _speeds: [0.5, 0.75, 1, 1.25, 1.5, 2],

    init() {
        this.iframe = document.getElementById('player-iframe');
        this.video = document.getElementById('player-video');
        this._initSubtitleControls();
        this._initExtraControls();
    },

    // ─── Extra Player Controls (skip, speed, PIP) ───

    _initExtraControls() {
        // Skip back 10s
        document.getElementById('skip-back-btn')?.addEventListener('click', () => {
            if (this.video && !this.video.classList.contains('hidden')) {
                this.video.currentTime = Math.max(0, this.video.currentTime - 10);
            }
        });
        // Skip forward 30s
        document.getElementById('skip-forward-btn')?.addEventListener('click', () => {
            if (this.video && !this.video.classList.contains('hidden')) {
                this.video.currentTime = Math.min(this.video.duration || Infinity, this.video.currentTime + 30);
            }
        });
        // Playback speed cycle
        document.getElementById('speed-btn')?.addEventListener('click', () => {
            if (this.video && !this.video.classList.contains('hidden')) {
                const idx = this._speeds.indexOf(this._playbackSpeed);
                this._playbackSpeed = this._speeds[(idx + 1) % this._speeds.length];
                this.video.playbackRate = this._playbackSpeed;
                document.getElementById('speed-label').textContent = this._playbackSpeed + 'x';
            }
        });
        // Picture-in-Picture
        document.getElementById('pip-btn')?.addEventListener('click', () => {
            if (this.video && !this.video.classList.contains('hidden')) {
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(() => {});
                } else {
                    this.video.requestPictureInPicture().catch(() => {});
                }
            }
        });
    },

    // ─── Loading Overlay ───

    showLoading(status, stage) {
        const overlay = document.getElementById('player-loading-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden', 'fade-out');
        if (status) document.getElementById('loading-status').textContent = status;
        if (stage) document.getElementById('loading-stage').textContent = stage;
        this._setLoadingProgress(0);
    },

    updateLoading(status, stage, progress) {
        const overlay = document.getElementById('player-loading-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        if (status) document.getElementById('loading-status').textContent = status;
        if (stage) document.getElementById('loading-stage').textContent = stage;
        if (progress !== undefined) this._setLoadingProgress(progress);
    },

    hideLoading() {
        const overlay = document.getElementById('player-loading-overlay');
        if (!overlay) return;
        this._setLoadingProgress(100);
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('fade-out');
        }, 500);
    },

    _setLoadingProgress(pct) {
        const bar = document.getElementById('loading-progress-bar');
        if (bar) bar.style.width = Math.min(pct, 100) + '%';
    },

    // ─── Position Memory ───

    savePosition() {
        if (this.video && this.video.currentTime > 1 && !this.video.ended) {
            this._savedPosition = this.video.currentTime;
        }
    },

    restorePosition() {
        if (this._savedPosition > 1 && this.video) {
            const pos = this._savedPosition;
            const restore = () => {
                if (this.video.duration && pos < this.video.duration - 5) {
                    this.video.currentTime = pos;
                }
            };
            // Try immediately, and also on loadedmetadata as fallback
            if (this.video.readyState >= 1) {
                restore();
            } else {
                this.video.addEventListener('loadedmetadata', restore, { once: true });
            }
        }
    },

    clearSavedPosition() {
        this._savedPosition = 0;
    },

    // ─── Play Methods ───

    playEmbed(url) {
        this.savePosition();
        this.stopVideo();
        this.iframe.style.display = 'block';
        this.video.classList.add('hidden');
        this.iframe.src = url || '';
        this.hideLoading();
        // Hide quality selector for embed mode
        const qs = document.querySelector('.quality-selector');
        if (qs) qs.style.display = 'none';
    },

    playDirect(url) {
        this.savePosition();
        this.iframe.style.display = 'none';
        this.video.classList.remove('hidden');
        this.clearSubtitleTracks();
        if (url.includes('.m3u8') || url.includes('stream-proxy')) {
            this.playHLS(url);
        } else {
            this.stopHLS();
            this.video.src = url;
            this.video.play().catch(() => {});
            this.restorePosition();
            this.hideLoading();
        }
    },

    playHLSUrl(url) {
        this.savePosition();
        this.iframe.style.display = 'none';
        this.video.classList.remove('hidden');
        this.clearSubtitleTracks();
        this.playHLS(url);
    },

    playHLS(url) {
        this.stopHLS();
        if (Hls.isSupported()) {
            this.hls = new Hls({
                // ─── Aggressive Prebuffering Config ───
                maxBufferLength: 120,          // Buffer up to 120s ahead
                maxMaxBufferLength: 600,       // Allow up to 10min buffer
                maxBufferSize: 200 * 1000 * 1000, // 200MB buffer
                maxBufferHole: 0.1,            // Minimal hole tolerance for smooth playback
                backBufferLength: 120,         // Keep 120s behind for rewind
                startLevel: -1,                // Auto-detect best quality
                abrEwmaDefaultEstimate: 5000000, // Assume 5Mbps initially
                enableWorker: true,
                lowLatencyMode: false,
                progressive: true,
                startPosition: -1,
                // Faster ABR switching
                abrEwmaFastLive: 3.0,
                abrEwmaSlowLive: 9.0,
                abrEwmaFastVoD: 3.0,
                abrEwmaSlowVoD: 9.0,
                abrBandWidthUpFactor: 0.7,
                abrBandWidthFactor: 0.9,
                // Faster fragment loading for less buffering
                fragLoadingMaxRetry: 8,
                fragLoadingRetryDelay: 500,
                fragLoadingMaxRetryTimeout: 16000,
                manifestLoadingMaxRetry: 6,
                levelLoadingMaxRetry: 6,
                // Preload next segments aggressively
                testBandwidth: true,
                startFragPrefetch: true, // Prefetch next fragment while playing
            });

            this.updateLoading('Preparing your stream', 'CONNECTING TO HD SERVER', 20);

            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);

            this.hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                this.updateLoading('Stream ready', 'PREPARING HD PLAYBACK', 70);
                this._populateQualitySelector(data.levels);
                this.video.play().catch(() => {});
                this.restorePosition();
            });

            this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
                this.updateLoading('Almost ready', 'OPTIMIZING QUALITY', 85);
            });

            // Hide overlay once video starts playing
            const onPlaying = () => {
                this.updateLoading('Enjoy your movie', 'NOW PLAYING IN HD', 100);
                this.hideLoading();
                this.video.removeEventListener('playing', onPlaying);
            };
            this.video.addEventListener('playing', onPlaying);

            // Also hide on canplay as safety net
            this.video.addEventListener('canplay', () => {
                this.hideLoading();
            }, { once: true });

            this.hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                this._updateCurrentQuality(data.level);
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('HLS Fatal Error:', data);
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        this.updateLoading('Reconnecting', 'FINDING BEST SERVER', 30);
                        this.hls.startLoad();
                    } else {
                        this.hideLoading();
                        this.stopHLS();
                    }
                } else if (data.details === 'bufferStalledError') {
                    // Non-fatal stall: force load from current position
                    console.warn('Buffer stalled, forcing recovery...');
                    if (this.hls) this.hls.startLoad(this.video.currentTime);
                }
            });

            // Auto-recover from freeze: if video stalls for 3s while not paused, force reload
            this._stallTimer = null;
            this.video.addEventListener('waiting', () => {
                if (!this.video.paused && this.hls) {
                    this._stallTimer = setTimeout(() => {
                        console.warn('Stall recovery: forcing fragment reload');
                        this.hls.startLoad(this.video.currentTime);
                    }, 3000);
                }
            });
            this.video.addEventListener('playing', () => {
                if (this._stallTimer) { clearTimeout(this._stallTimer); this._stallTimer = null; }
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            this.video.src = url;
            this.video.play().catch(() => {});
            this.restorePosition();
            this.hideLoading();
            // Show quality selector in non-HLS too
            const qs = document.querySelector('.quality-selector');
            if (qs) qs.style.display = 'none';
        }
    },

    stopHLS() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    },

    stopVideo() {
        this.stopHLS();
        if (this.video) {
            this.video.pause();
            this.video.src = '';
        }
    },

    stop() {
        this.savePosition();
        this.stopVideo();
        if (this.iframe) this.iframe.src = '';
    },

    // ─── Quality Management ───

    _populateQualitySelector(levels) {
        const select = document.getElementById('quality-select');
        if (!select) return;
        const qs = document.querySelector('.quality-selector');
        if (qs) qs.style.display = 'flex';

        select.innerHTML = '<option value="-1">Auto</option>';
        if (!levels || levels.length === 0) return;

        // Sort by resolution descending
        const sorted = levels.map((l, i) => ({ index: i, height: l.height, bitrate: l.bitrate }))
            .sort((a, b) => b.height - a.height);

        sorted.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.index;
            opt.textContent = `${l.height}p (${(l.bitrate / 1000000).toFixed(1)}Mbps)`;
            select.appendChild(opt);
        });

        // Default to auto
        select.value = '-1';
    },

    _updateCurrentQuality(levelIndex) {
        const select = document.getElementById('quality-select');
        if (!select || !this.hls) return;
        // If on auto, don't change select but show which is active
        if (this.hls.autoLevelEnabled) {
            select.value = '-1';
            // Update auto label with current
            const level = this.hls.levels[levelIndex];
            if (level) {
                const autoOpt = select.querySelector('option[value="-1"]');
                if (autoOpt) autoOpt.textContent = `Auto (${level.height}p)`;
            }
        }
    },

    getQualities() {
        if (!this.hls) return [];
        return this.hls.levels.map((level, i) => ({
            index: i,
            height: level.height,
            width: level.width,
            bitrate: level.bitrate,
            label: `${level.height}p`
        }));
    },

    setQuality(index) {
        if (!this.hls) return;
        this.hls.currentLevel = index; // -1 for auto
    },

    // ─── Subtitle Management ───

    clearSubtitleTracks() {
        if (!this.video) return;
        const tracks = this.video.querySelectorAll('track');
        tracks.forEach(t => t.remove());
    },

    addSubtitleTrack(label, url, lang = 'en', isDefault = false) {
        if (!this.video) return;
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = label;
        track.srclang = lang;
        track.src = url;
        if (isDefault) track.default = true;
        this.video.appendChild(track);

        if (isDefault) {
            setTimeout(() => {
                for (let i = 0; i < this.video.textTracks.length; i++) {
                    if (this.video.textTracks[i].label === label) {
                        this.video.textTracks[i].mode = 'showing';
                    }
                }
                this._applySubtitleStyles();
            }, 100);
        }
    },

    setSubtitle(index) {
        if (!this.video) return;
        for (let i = 0; i < this.video.textTracks.length; i++) {
            this.video.textTracks[i].mode = (i === index) ? 'showing' : 'hidden';
        }
        this._applySubtitleStyles();
    },

    disableSubtitles() {
        if (!this.video) return;
        for (let i = 0; i < this.video.textTracks.length; i++) {
            this.video.textTracks[i].mode = 'hidden';
        }
    },

    // ─── Subtitle Sync ───

    adjustSubtitleOffset(delta) {
        this._subtitleOffset += delta;
        this._subtitleOffset = Math.round(this._subtitleOffset * 10) / 10;
        document.getElementById('sub-sync-value').textContent = this._subtitleOffset.toFixed(1) + 's';
        this._applySubtitleOffset();
    },

    resetSubtitleOffset() {
        this._subtitleOffset = 0;
        document.getElementById('sub-sync-value').textContent = '0.0s';
        this._applySubtitleOffset();
    },

    _applySubtitleOffset() {
        if (!this.video) return;
        for (let i = 0; i < this.video.textTracks.length; i++) {
            const track = this.video.textTracks[i];
            if (track.mode === 'showing' && track.cues) {
                for (let j = 0; j < track.cues.length; j++) {
                    const cue = track.cues[j];
                    if (cue._origStart === undefined) {
                        cue._origStart = cue.startTime;
                        cue._origEnd = cue.endTime;
                    }
                    cue.startTime = cue._origStart + this._subtitleOffset;
                    cue.endTime = cue._origEnd + this._subtitleOffset;
                }
            }
        }
    },

    // ─── Subtitle Styling ───

    setSubtitleFontSize(delta) {
        this._subtitleFontSize = Math.max(50, Math.min(200, this._subtitleFontSize + delta));
        document.getElementById('sub-size-value').textContent = this._subtitleFontSize + '%';
        this._applySubtitleStyles();
    },

    setSubtitleBg(bg) {
        this._subtitleBg = bg;
        this._applySubtitleStyles();
    },

    _applySubtitleStyles() {
        // Use CSS ::cue styling via a dynamic style tag
        let styleEl = document.getElementById('sub-cue-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'sub-cue-styles';
            document.head.appendChild(styleEl);
        }
        const fontSize = (this._subtitleFontSize / 100) * 1.1;
        styleEl.textContent = `
            video::cue {
                font-size: ${fontSize}rem;
                background: ${this._subtitleBg};
                color: #fff;
                font-family: 'Inter', sans-serif;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                padding: 4px 8px;
            }
        `;
    },

    _initSubtitleControls() {
        // Quality selector
        const qualitySelect = document.getElementById('quality-select');
        if (qualitySelect) {
            qualitySelect.addEventListener('change', (e) => {
                this.setQuality(parseInt(e.target.value));
            });
        }

        // Subtitle settings toggle
        const settingsBtn = document.getElementById('subtitle-settings-btn');
        const subControls = document.getElementById('subtitle-controls');
        const closeBtn = document.getElementById('sub-ctrl-close');

        if (settingsBtn && subControls) {
            settingsBtn.addEventListener('click', () => {
                subControls.classList.toggle('hidden');
            });
        }
        if (closeBtn && subControls) {
            closeBtn.addEventListener('click', () => {
                subControls.classList.add('hidden');
            });
        }

        // Sync controls
        const syncMinus = document.getElementById('sub-sync-minus');
        const syncPlus = document.getElementById('sub-sync-plus');
        const syncReset = document.getElementById('sub-sync-reset');
        if (syncMinus) syncMinus.addEventListener('click', () => this.adjustSubtitleOffset(-0.5));
        if (syncPlus) syncPlus.addEventListener('click', () => this.adjustSubtitleOffset(0.5));
        if (syncReset) syncReset.addEventListener('click', () => this.resetSubtitleOffset());

        // Font size controls
        const sizeMinus = document.getElementById('sub-size-minus');
        const sizePlus = document.getElementById('sub-size-plus');
        if (sizeMinus) sizeMinus.addEventListener('click', () => this.setSubtitleFontSize(-10));
        if (sizePlus) sizePlus.addEventListener('click', () => this.setSubtitleFontSize(10));

        // Background select
        const bgSelect = document.getElementById('sub-bg-select');
        if (bgSelect) {
            bgSelect.addEventListener('change', (e) => this.setSubtitleBg(e.target.value));
        }

        // Apply initial styles
        this._applySubtitleStyles();
    },

    // Load subtitles from OpenSubtitles
    async loadSubtitles(imdbId, season, episode) {
        try {
            const subs = await API.getSubtitles(imdbId, season, episode);
            this.currentSubs = subs;
            return subs;
        } catch (e) {
            console.error('Failed to load subtitles:', e);
            return [];
        }
    },
};
