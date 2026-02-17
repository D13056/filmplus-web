/* ═══════════════════════════════════════════════════════════
   FilmPlus Web - Service Worker Ad Blocker v2
   Comprehensive network-level ad blocking for embed players
   ═══════════════════════════════════════════════════════════ */

// ── Known ad/tracking hostnames (exact match or suffix match) ──
const AD_HOSTS = new Set([
    // Google Ads
    'pagead2.googlesyndication.com',
    'tpc.googlesyndication.com',
    'googleads.g.doubleclick.net',
    'www.googleadservices.com',
    'adservice.google.com',
    'www.google-analytics.com',
    'ssl.google-analytics.com',
    'www.googletagmanager.com',
    'stats.g.doubleclick.net',
    'ad.doubleclick.net',
    'static.doubleclick.net',
    'cm.g.doubleclick.net',
    'ade.googlesyndication.com',
    'partner.googleadservices.com',
    'fundingchoicesmessages.google.com',

    // Major ad networks
    'ib.adnxs.com',
    'secure.adnxs.com',
    'acdn.adnxs.com',
    'nym1-ib.adnxs.com',
    'match.adsrvr.org',
    'track.adform.net',
    'ads.yahoo.com',
    'ad.turn.com',
    'pixel.advertising.com',
    'bh.contextweb.com',
    'ads.pubmatic.com',
    'gads.pubmatic.com',
    'hbopenbid.pubmatic.com',
    'ssp.lkqd.net',
    'ad-delivery.net',
    'cdn.snigelweb.com',
    'loader.snigelweb.com',

    // Pop-under / popup networks
    'serve.popads.net',
    'cdn.popcash.net',
    'www.popcash.net',
    'go.ad2upapp.com',
    'cdn.propellerads.com',
    'ads.propellerads.com',
    'ad.propellerads.com',
    'propu.sh',
    'go.oclasrv.com',
    'go.mobisla.com',
    'go.strfrge.com',
    'go.hpyrdr.com',
    'notifpushing.com',
    'cdn.pushape.com',
    'go.onclasrv.com',
    'syndication.exoclick.com',
    'main.exoclick.com',
    'syndication.exosrv.com',
    'ads.exosrv.com',
    'static.exosrv.com',
    'ads.hilltopads.net',
    'www.juicyads.com',
    'a.juicyads.com',
    'ads.juicyads.com',
    'richpush.co',
    'cdn.richpush.co',
    'push.house',
    'cdn.push.house',
    'pushame.com',
    'cdn.pushame.com',
    'a-ads.com',
    'www.a-ads.com',
    'ad.a-ads.com',
    'ads.stickyadstv.com',
    'cdn.stickyadstv.com',

    // Monetization / ad injection
    'www.adsterra.com',
    'ads.adsterra.com',
    'www2.adsterra.com',
    'ad.adsterra.com',
    'hb.adsterratools.com',
    'www.monetag.com',
    'a.monetag.com',
    'd.monetag.com',
    'a.magsrv.com',
    's.magsrv.com',
    'cdn.tsyndicate.com',
    'loader.tsyndicate.com',
    'syndication.realsrv.com',
    'onclkds.com',
    'www.onclkds.com',
    'onclickalgo.com',
    'cdn.onclickalgo.com',
    'clickadu.com',
    'www.clickadu.com',
    'clickaine.com',
    'cdn.clickaine.com',
    'clickosmedia.com',
    'revcontent.com',
    'labs-cdn.revcontent.com',
    'trends.revcontent.com',
    'ads.mgid.com',
    'jsc.mgid.com',
    'servicer.mgid.com',
    'cdn.taboola.com',
    'api.taboola.com',
    'trc.taboola.com',
    'cdn.outbrain.com',
    'widgets.outbrain.com',
    'log.outbrain.com',
    'ad-maven.com',
    'www.ad-maven.com',
    'cdn.ad-maven.com',
    'go.ad-maven.com',
    'www.admaven.com',
    'cdn.admaven.com',
    'ad.admaven.com',
    'go.admaven.com',
    'betterads.co',
    'ad.betterads.co',
    'trafficjunky.net',
    'ads.trafficjunky.net',
    'cdn.trafficjunky.net',
    'www.trafficstars.com',
    'ads.trafficstars.com',
    'tsyndicate.com',
    'bannedcontent.com',
    'surfe.pro',
    'www.surfe.pro',
    'dolohen.com',
    'www.dolohen.com',
    'acint.net',
    'www.acint.net',
    'landingtracker.com',
    'mtracking.net',

    // Crypto miners
    'coinhive.com',
    'www.coinhive.com',
    'coin-hive.com',
    'minero.cc',
    'cryptoloot.pro',
    'authedmine.com',

    // Tracking / analytics (from embed sites)
    'mc.yandex.ru',
    'top.mail.ru',
    'counter.yadro.ru',
    'www.hotjar.com',
    'script.hotjar.com',
    'static.hotjar.com',
    'api.mixpanel.com',
    'cdn.mxpnl.com',
    'cdn.segment.io',
    'cdn.segment.com',
    'api.segment.io',
    'api.amplitude.com',
    'cdn.amplitude.com',
    'whos.amung.us',
    'widgets.amung.us',

    // Notification / push spam
    'notifpush.com',
    'cdn.pushwoosh.com',
    'cp.pushwoosh.com',
    'cdn.sendpulse.com',
    'login.sendpulse.com',
    'cdn.izooto.com',
    'lsdk.io',
    'cdn.subscribers.com',
    'cdn.pushengage.com',
    'clientcdn.pushengage.com',
    'webpushr.com',
    'cdn.webpushr.com',

    // URL shorteners with ads
    'adf.ly',
    'www.adf.ly',
    'shorte.st',
    'www.shorte.st',
    'linkvertise.com',
    'www.linkvertise.com',
    'ouo.io',
    'ouo.press',

    // Common embed-site ad domains
    'newcrev.com',
    'yablfrede.com',
    'kfrfrfgdsj.com',
    'lpcloudsvr302.com',
    'lpcloudsvr300.com',
    'apalsfrede.com',
    'awefrjker.com',
    'bfrfrfgdsj.com',
    'pfrfrfgdsj.com',
    'qfrfrfgdsj.com',
    'tfrfrfgdsj.com',
    'wfrfrfgdsj.com',
    'xfrfrfgdsj.com',
]);

// ── Pattern-based domain matching ──
const AD_DOMAIN_PATTERNS = [
    /^ad[sx]?\./i,
    /^ads\d?\./i,
    /\.ads\./i,
    /^track(ing)?\./i,
    /^pixel\./i,
    /^beacon\./i,
    /^telemetry\./i,
    /^metrics\./i,
    /^analytics\./i,
    /^stat[sx]?\./i,
    /^click\./i,
    /^banner\./i,
    /^sponsor\./i,
    /pop(up|under|cash|ads)/i,
    /adserv(er|ing|ice)/i,
    /doubleclick/i,
    /googlesyndication/i,
    /googleadservices/i,
    /adnxs\.com/i,
    /adsrvr\.org/i,
    /exoclick/i,
    /exosrv/i,
    /propellerads/i,
    /hilltopads/i,
    /adsterra/i,
    /monetag/i,
    /trafficjunky/i,
    /trafficstars/i,
    /admaven/i,
    /ad-maven/i,
    /tsyndicate/i,
    /realsrv/i,
    /magsrv/i,
    /onclkds/i,
    /clickadu/i,
    /pushame/i,
    /richpush/i,
    /coinhive/i,
    /cryptoloot/i,
];

// ── URL path patterns that indicate ads ──
const AD_PATH_PATTERNS = [
    /\/pop(up|under|out|exit)?\.(js|html|php)/i,
    /\/ads?\/(banner|display|show|serve|click|pixel)/i,
    /\/adserver/i,
    /\/ad[_-]?manager/i,
    /\/vast(\/|\?|\.xml)/i,
    /\/vpaid/i,
    /\/prebid/i,
    /\/impression/i,
    /\/click\.php/i,
    /\/redirect\?.*camp/i,
    /\/beacon\b/i,
    /\/pixel\.gif/i,
    /\/pixel\.png/i,
    /\/tracking\//i,
    /\/analytics\.js/i,
    /\/ga\.js/i,
    /\/gtm\.js/i,
    /\/tag\.min\.js/i,
    /\/pagead\//i,
];

function isAdRequest(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        // Exact host match
        if (AD_HOSTS.has(hostname)) return true;

        // Check if it's a subdomain of a known ad host
        for (const adHost of AD_HOSTS) {
            if (hostname.endsWith('.' + adHost)) return true;
        }

        // Pattern-based domain check
        for (const pattern of AD_DOMAIN_PATTERNS) {
            if (pattern.test(hostname)) return true;
        }

        // Path-based check
        for (const pattern of AD_PATH_PATTERNS) {
            if (pattern.test(parsed.pathname + parsed.search)) return true;
        }

        return false;
    } catch {
        return false;
    }
}

// Install - take control immediately
self.addEventListener('install', () => {
    self.skipWaiting();
});

// Activate - claim all clients
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Fetch - intercept and block ad requests
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Never block our own server requests
    if (url.startsWith(self.location.origin)) return;

    // Never block known video/streaming CDNs
    if (isVideoRequest(url)) return;

    // Block known ad requests
    if (isAdRequest(url)) {
        event.respondWith(createBlockedResponse(url));
        return;
    }
});

function isVideoRequest(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();

        // Video file extensions
        if (/\.(mp4|m3u8|ts|webm|mkv|avi|mov|mpd|m4s|m4v|flv)(\?|$)/i.test(path)) return true;

        // Known video/streaming CDNs
        const videoDomains = [
            'vidsrc', 'vidplay', 'filemoon', 'streamtape', 'doodstream',
            'mixdrop', 'upstream', 'streamlare', 'uqload', 'mp4upload',
            'vidoza', 'voe.sx', 'vidcloud', 'rabbitstream', 'megacloud',
            'dokicloud', 'rapid-cloud', 'cdn.plyr.io', 'hls.', 'stream.',
            'embed.', 'player.', 'play.', 'cdn.jwplayer.com', 'ssl.p.jwpcdn.com',
            'content.jwplatform.com', 'cdn.plyr.io', 'cdnjs.cloudflare.com',
            'vjs.zencdn.net', 'hls.js', 'plyr', 'tmdb', 'image.tmdb.org',
            'autoembed', 'multiembed', '2embed', 'smashystream',
        ];
        for (const d of videoDomains) {
            if (hostname.includes(d)) return true;
        }

        // HLS/DASH content types
        if (path.includes('.m3u8') || path.includes('.mpd') || path.includes('.ts')) return true;

        return false;
    } catch {
        return false;
    }
}

function createBlockedResponse(url) {
    const path = new URL(url).pathname.toLowerCase();

    if (path.endsWith('.js') || path.includes('.js?')) {
        return new Response('/* ad blocked */', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript' }
        });
    }
    if (path.endsWith('.css') || path.includes('.css?')) {
        return new Response('/* ad blocked */', {
            status: 200,
            headers: { 'Content-Type': 'text/css' }
        });
    }
    if (/\.(gif|png|jpg|jpeg|webp|svg|ico)(\?|$)/.test(path)) {
        // Return 1x1 transparent GIF
        const gif = new Uint8Array([71,73,70,56,57,97,1,0,1,0,0,0,0,59]);
        return new Response(gif, {
            status: 200,
            headers: { 'Content-Type': 'image/gif' }
        });
    }
    if (path.endsWith('.html') || path.includes('.html?') || path.endsWith('.php')) {
        return new Response('<!DOCTYPE html><html><body></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
        });
    }
    return new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
    });
}
