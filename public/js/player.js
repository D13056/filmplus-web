/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - Player Module
   Video player with HLS support and subtitle loading
   ═══════════════════════════════════════════════════════════ */

const Player = {
    iframe: null,
    video: null,
    hls: null,
    currentSubs: [],
    clickShield: null,
    clickShieldTimer: null,

    init() {
        this.iframe = document.getElementById('player-iframe');
        this.video = document.getElementById('player-video');
        this.setupClickShield();
    },

    // Setup transparent click shield to block ad click-traps
    setupClickShield() {
        const playerArea = document.getElementById('player-area');
        if (!playerArea || this.clickShield) return;

        this.clickShield = document.createElement('div');
        this.clickShield.id = 'player-click-shield';
        this.clickShield.innerHTML = '<div class="shield-message">Click to watch</div>';
        playerArea.appendChild(this.clickShield);

        // First click removes the shield temporarily, second click goes to iframe
        this.clickShield.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dismissShield();
        });
    },

    dismissShield() {
        if (!this.clickShield) return;
        this.clickShield.classList.add('dismissed');
        // Re-enable shield after 2 seconds to catch delayed popup triggers
        clearTimeout(this.clickShieldTimer);
        this.clickShieldTimer = setTimeout(() => {
            if (this.clickShield) {
                this.clickShield.classList.remove('dismissed');
            }
        }, 3000);
    },

    // Play via embed iframe - route through ad-cleaning proxy
    playEmbed(url) {
        this.stopVideo();
        this.iframe.style.display = 'block';
        this.video.classList.add('hidden');
        if (this.clickShield) this.clickShield.classList.remove('dismissed');

        if (url) {
            // Route through our server-side ad-cleaning proxy
            const proxyUrl = '/api/embed-proxy?url=' + encodeURIComponent(url);
            this.iframe.src = proxyUrl;
        } else {
            this.iframe.src = '';
        }
    },

    // Play direct video URL (mp4, m3u8)
    playDirect(url) {
        this.iframe.style.display = 'none';
        this.video.classList.remove('hidden');
        this.clearSubtitleTracks();

        if (url.includes('.m3u8')) {
            this.playHLS(url);
        } else {
            this.stopHLS();
            this.video.src = url;
            this.video.play().catch(() => {});
        }
    },

    playHLS(url) {
        this.stopHLS();
        if (Hls.isSupported()) {
            this.hls = new Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
            });
            this.hls.loadSource(url);
            this.hls.attachMedia(this.video);
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.video.play().catch(() => {});
            });
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('HLS Fatal Error:', data);
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        this.hls.startLoad();
                    } else {
                        this.stopHLS();
                    }
                }
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            this.video.src = url;
            this.video.play().catch(() => {});
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
        this.stopVideo();
        if (this.iframe) this.iframe.src = '';
    },

    // ─── Subtitle Management ───

    clearSubtitleTracks() {
        if (!this.video) return;
        // Remove all existing tracks
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

        // Enable the track
        if (isDefault) {
            setTimeout(() => {
                for (let i = 0; i < this.video.textTracks.length; i++) {
                    if (this.video.textTracks[i].label === label) {
                        this.video.textTracks[i].mode = 'showing';
                    }
                }
            }, 100);
        }
    },

    setSubtitle(index) {
        if (!this.video) return;
        for (let i = 0; i < this.video.textTracks.length; i++) {
            this.video.textTracks[i].mode = (i === index) ? 'showing' : 'hidden';
        }
    },

    disableSubtitles() {
        if (!this.video) return;
        for (let i = 0; i < this.video.textTracks.length; i++) {
            this.video.textTracks[i].mode = 'hidden';
        }
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

    // Get quality options from HLS
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
    }
};
