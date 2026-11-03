// PEOPLEENT on-site navigation measurement. Loaded by the production-only middleware.
// Never transmit text fields, search terms, full URLs, query strings or contact details.
(function () {
  'use strict';
  if (window.location.hostname !== 'peopleent.pagero.kr') return;

  var SERVICES = new Set([
    '/corporate-event/', '/public-event/', '/conference/',
    '/seminar/', '/live-streaming/', '/academic-event/'
  ]);
  var TOPICS = new Set(['전체', '발주·견적', '현장 운영', '행사 기획', '제작·정산', '시상·전시']);
  var ARTICLE = /^\/insight\/[a-z0-9-]+\/$/;

  // Only bounded, known page paths. Never send untrusted paths or query parameters.
  function safePath(path) {
    if (path === '/' || path === '/insight/' || SERVICES.has(path) || ARTICLE.test(path)) {
      return path;
    }
    return '/other/';
  }

  var source = safePath(window.location.pathname);
  var from = source === '/' ? 'home'
    : source === '/insight/' ? 'insight_hub'
    : ARTICLE.test(source) ? 'article'
    : SERVICES.has(source) ? 'service'
    : 'other';

  function send(name, properties) {
    if (typeof window.gtag !== 'function') return;
    try {
      window.gtag('event', name, properties);
    } catch (_) {
      // Tracking must never interrupt link navigation or form interaction.
    }
  }

  function placement(link) {
    if (link.closest('.pe-sticky-cta, .sticky')) return 'sticky';
    if (link.closest('.pe-next-service, .pe-pathway-service')) return 'related_service';
    if (link.closest('.pe-next-links, .pe-pathway-links')) return 'reading_path';
    if (link.closest('#pe-articles')) return 'article_card';
    if (link.closest('.hero-actions, .hero')) return 'hero';
    if (link.closest('.pe-inline-cta, .closing, .cta')) return 'inline_cta';
    return 'body';
  }

  document.addEventListener('click', function (event) {
    var element = event.target;
    if (!element || typeof element.closest !== 'function') return;
    var link = element.closest('a[href]');
    if (!link) return;

    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;

    var destination;
    try {
      destination = new URL(href, window.location.href);
    } catch (_) {
      return;
    }

    var where = placement(link);
    var fields = { source_type: from, source_path: source, link_position: where };
    var destPath = destination.pathname;

    if ((destination.hostname === 'peopleent.com' || destination.hostname === 'www.peopleent.com')
        && /^\/contact\/?$/.test(destPath) && destination.protocol === 'https:') {
      // This only records opening a contact page; it is NOT a submitted lead.
      send('pe_contact_click', fields);
    } else if (destination.hostname === window.location.hostname && SERVICES.has(destPath)) {
      send('pe_service_click', Object.assign(fields, { destination_path: destPath }));
    } else if (destination.hostname === window.location.hostname && ARTICLE.test(destPath)) {
      send('pe_article_click', Object.assign(fields, { destination_path: destPath }));
    }
  }, true);

  var searchObserved = false;
  document.addEventListener('input', function (event) {
    if (source !== '/insight/' || searchObserved || !event.target
        || event.target.id !== 'pe-guide-search') return;
    if (!String(event.target.value || '').trim()) return;
    searchObserved = true;
    send('pe_search_used', { source_type: 'insight_hub', source_path: '/insight/' });
    // Do not transmit the search term, its length, or selected results.
  }, true);

  document.addEventListener('click', function (event) {
    if (source !== '/insight/') return;
    var element = event.target;
    if (!element || typeof element.closest !== 'function') return;
    var button = element.closest('button[data-pe-topic]');
    if (!button) return;
    var topic = button.getAttribute('data-pe-topic');
    if (!TOPICS.has(topic)) return;
    send('pe_topic_filter', { source_type: 'insight_hub', source_path: '/insight/', topic_group: topic });
  }, true);
})();
