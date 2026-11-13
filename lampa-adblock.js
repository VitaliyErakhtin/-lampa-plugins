(function () {
    'use strict';

    var PLUGIN_NAME = 'AdBlock';
    var PLUGIN_ID = 'lampa_adblock';

    // Domains / URL fragments commonly used for ads and trackers in Lampa sources.
    // You can extend this list for your sources.
    var BLOCK_PATTERNS = [
        /doubleclick\.net/i,
        /googlesyndication\.com/i,
        /googleadservices\.com/i,
        /adservice\.google/i,
        /pagead/i,
        /\/ads?\//i,
        /\/advert/i,
        /\/banner/i,
        /vast/i,
        /vmap/i,
        /ima3?\.js/i,
        /adfox/i,
        /yandex.*\/ads/i,
        /an\.yandex/i,
        /mc\.yandex\.ru\/metrika/i,
        /betweendigital/i,
        /buzzoola/i,
        /videonow/i
    ];

    function isBlocked(url) {
        if (!url || typeof url !== 'string') return false;
        for (var i = 0; i < BLOCK_PATTERNS.length; i++) {
            if (BLOCK_PATTERNS[i].test(url)) return true;
        }
        return false;
    }

    function log(msg) {
        try {
            console.log('[Lampa AdBlock] ' + msg);
        } catch (e) {}
    }

    function notify(msg) {
        try {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(msg);
            }
        } catch (e) {}
    }

    function patchFetch() {
        if (!window.fetch || window.fetch.__adblock_patched) return;
        var originalFetch = window.fetch;
        var patched = function (input, init) {
            var url = '';
            try {
                url = typeof input === 'string' ? input : (input && input.url) || '';
            } catch (e) {}
            if (isBlocked(url)) {
                log('Blocked fetch: ' + url);
                return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
            }
            return originalFetch.apply(this, arguments);
        };
        patched.__adblock_patched = true;
        window.fetch = patched;
        log('fetch patched');
    }

    function patchXHR() {
        if (!window.XMLHttpRequest || window.XMLHttpRequest.__adblock_patched) return;
        var OriginalXHR = window.XMLHttpRequest;

        function XHRProxy() {
            var xhr = new OriginalXHR();
            var blocked = false;
            var open = xhr.open;

            xhr.open = function (method, url) {
                try {
                    if (isBlocked(String(url))) {
                        blocked = true;
                        log('Blocked XHR: ' + url);
                    }
                } catch (e) {}
                return open.apply(xhr, arguments);
            };

            var send = xhr.send;
            xhr.send = function () {
                if (blocked) {
                    try {
                        Object.defineProperty(xhr, 'readyState', { value: 4 });
                        Object.defineProperty(xhr, 'status', { value: 204 });
                        Object.defineProperty(xhr, 'responseText', { value: '' });
                        Object.defineProperty(xhr, 'response', { value: '' });
                    } catch (e) {}
                    setTimeout(function () {
                        try { if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange(); } catch (e) {}
                        try { xhr.dispatchEvent(new Event('readystatechange')); } catch (e) {}
                        try { xhr.dispatchEvent(new Event('load')); } catch (e) {}
                        try { xhr.dispatchEvent(new Event('loadend')); } catch (e) {}
                    }, 0);
                    return;
                }
                return send.apply(xhr, arguments);
            };

            return xhr;
        }

        XHRProxy.__adblock_patched = true;
        XHRProxy.prototype = OriginalXHR.prototype;
        window.XMLHttpRequest = XHRProxy;
        log('XMLHttpRequest patched');
    }

    function injectCss() {
        if (document.getElementById(PLUGIN_ID + '_css')) return;
        var css = ''
            + '.ad, .ads, .advert, .advertisement, .banner-ad, .ad-banner,'
            + '[class*="advert"], [class*="banner-ad"], [id*="advert"],'
            + '.player .ad-container, .player__ad, .preroll, .midroll, .postroll,'
            + '.vast, .vpaid, .ima-container, .ad-video { display: none !important; }';
        var style = document.createElement('style');
        style.id = PLUGIN_ID + '_css';
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        (document.head || document.documentElement).appendChild(style);
        log('CSS injected');
    }

    function hookPlayer() {
        if (!window.Lampa || !Lampa.Player || Lampa.Player.__adblock_hooked) return;
        try {
            // Skip ad-related events if the player emits them
            if (Lampa.Player.listener && Lampa.Player.listener.follow) {
                Lampa.Player.listener.follow('start', function () {
                    injectCss();
                });
            }

            // Some builds expose ad playback hooks; attempt to neutralize common names
            var noop = function () { return false; };
            ['ad', 'ads', 'preroll', 'vast', 'commercial'].forEach(function (name) {
                try {
                    if (typeof Lampa.Player[name] === 'function') {
                        Lampa.Player[name] = noop;
                    }
                } catch (e) {}
            });

            Lampa.Player.__adblock_hooked = true;
            log('Player hooks installed');
        } catch (e) {
            log('Player hook error: ' + e.message);
        }
    }

    function init() {
        patchFetch();
        patchXHR();
        injectCss();
        hookPlayer();

        // Re-apply hooks after app/components are ready
        try {
            if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
                Lampa.Listener.follow('app', function (e) {
                    if (e.type === 'ready') {
                        patchFetch();
                        patchXHR();
                        hookPlayer();
                        log('Re-applied after app ready');
                    }
                });
            }
        } catch (e) {}

        // Periodic safety net for dynamically created players/elements
        setInterval(function () {
            injectCss();
            hookPlayer();
        }, 3000);

        notify('AdBlock: плагин загружен');
        log('Initialized');
    }

    function start() {
        if (window.Lampa) {
            init();
        } else {
            // Wait for Lampa API to appear
            var tries = 0;
            var timer = setInterval(function () {
                tries++;
                if (window.Lampa) {
                    clearInterval(timer);
                    init();
                } else if (tries > 100) { // ~30s
                    clearInterval(timer);
                    // Still patch network/CSS even without Lampa object
                    patchFetch();
                    patchXHR();
                    injectCss();
                    log('Initialized without Lampa API');
                }
            }, 300);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
