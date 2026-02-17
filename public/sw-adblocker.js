/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - Service Worker Ad Blocker
   Blocks known ad/tracking domains at the network level
   ═══════════════════════════════════════════════════════════ */

const AD_DOMAIN_PATTERNS = [
    // Major ad networks
    /doubleclick\.net/i,
    /googlesyndication\.com/i,
    /googleadservices\.com/i,
    /google-analytics\.com/i,
    /googletagmanager\.com/i,
    /adservice\.google\./i,
    /pagead2\.googlesyndication/i,
    /adnxs\.com/i,
    /adsrvr\.org/i,
    /adform\.net/i,
    /advertising\.com/i,
    /adcolony\.com/i,
    /admob\./i,

    // Pop-under / popup ad networks
    /popads\.net/i,
    /popcash\.net/i,
    /propellerads\.com/i,
    /propellerpops\.com/i,
    /popmyads\.com/i,
    /popunder\.net/i,
    /juicyads\.com/i,
    /exoclick\.com/i,
    /exosrv\.com/i,
    /hilltopads\.net/i,
    /richpush\.co/i,
    /push\.house/i,
    /pushame\.com/i,
    /a-ads\.com/i,
    /adsterra\.com/i,
    /adsterratools\.com/i,
    /ad\.plus/i,
    /monetag\.com/i,
    /surfe\.pro/i,
    /onclkds\.com/i,
    /onclickalgo\.com/i,
    /clickadu\.com/i,
    /clickaine\.com/i,
    /clickosmedia\.com/i,
    /revcontent\.com/i,
    /mgid\.com/i,
    /outbrain\.com/i,
    /taboola\.com/i,

    // Streaming-specific ad domains
    /whos\.amung\.us/i,
    /streamads\.net/i,
    /vidads\.net/i,
    /ads\.stickyadstv\.com/i,
    /vastads\.net/i,
    /ad-maven\.com/i,
    /admaven\.com/i,
    /betterads\.co/i,
    /trafficjunky\.net/i,
    /trafficstars\.com/i,
    /s\.magsrv\.com/i,
    /cdn\.tsyndicate\.com/i,
    /syndication\.realsrv\.com/i,
    /ero-advertising\.com/i,
    /tsyndicate\.com/i,
    /bannedcontent\.com/i,

    // Tracking/analytics used by embed sites
    /mc\.yandex\.ru/i,
    /top\.mail\.ru/i,
    /counter\.yadro\.ru/i,
    /hotjar\.com/i,
    /mixpanel\.com/i,
    /segment\.io/i,
    /amplitude\.com/i,

    // Crypto miners
    /coinhive\.com/i,
    /coin-hive\.com/i,
    /minero\.cc/i,
    /cryptoloot\.pro/i,
    /authedmine\.com/i,

    // Common embed ad/tracker patterns
    /\.ads\./i,
    /\/ads\//i,
    /\/adserver/i,
    /\/ad\.js/i,
    /\/pop\.js/i,
    /\/popunder/i,
    /\/popup\.js/i,
    /banner.*ad/i,
    /\/prebid/i,
    /\/vast\//i,
    /\/vpaid\//i,

    // Malware / scam redirectors
    /adf\.ly/i,
    /bit\.ly.*\/ad/i,
    /shorte\.st/i,
    /linkvertise\.com/i,
    /ouo\.io/i,

    // Notification / push spam
    /notifpush\.com/i,
    /pushwoosh\.com/i,
    /sendpulse\.com/i,
    /pushengage\.com/i,
    /izooto\.com/i,
    /webpushr\.com/i,
    /subscribers\.com/i,

    // Embed-site specific ad domains
    /landingtracker\.com/i,
    /dolohen\.com/i,
    /acint\.net/i,
    /adsco\.re/i,
    /whos\.amung\.us/i,
    /mc\.webvisor/i,
    /mtracking\.net/i,
];

const AD_PATH_PATTERNS = [
    /\/pop\b/i,
    /\/ads?\b/i,
    /\/advert/i,
    /\/banner/i,
    /\/sponsor/i,
    /\/tracker/i,
    /\/pixel\b/i,
    /\/beacon\b/i,
    /\/analytics/i,
    /impression/i,
    /click\.php/i,
    /\/stat\b/i,
];

function isAdRequest(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        const fullUrl = parsed.href;

        // Check domain patterns
        for (const pattern of AD_DOMAIN_PATTERNS) {
            if (pattern.test(hostname) || pattern.test(fullUrl)) return true;
        }

        // Check path patterns (only for non-same-origin requests)
        for (const pattern of AD_PATH_PATTERNS) {
            if (pattern.test(parsed.pathname)) return true;
        }

        return false;
    } catch {
        return false;
    }
}

// Install - take control immediately
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate - claim all clients
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Fetch - intercept and block ad requests
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Don't block our own server requests
    if (url.includes(self.location.origin)) return;

    // Block known ad requests
    if (isAdRequest(url)) {
        // Return empty response for blocked requests
        const contentType = getBlockedContentType(url);
        event.respondWith(new Response(contentType.body, {
            status: 200,
            headers: { 'Content-Type': contentType.type }
        }));
        return;
    }
});

function getBlockedContentType(url) {
    if (url.endsWith('.js') || url.includes('.js?')) {
        return { type: 'application/javascript', body: '/* blocked */' };
    }
    if (url.endsWith('.css') || url.includes('.css?')) {
        return { type: 'text/css', body: '/* blocked */' };
    }
    if (url.endsWith('.gif') || url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.webp')) {
        return { type: 'image/gif', body: '' };
    }
    if (url.endsWith('.html') || url.includes('.html?')) {
        return { type: 'text/html', body: '' };
    }
    return { type: 'text/plain', body: '' };
}
