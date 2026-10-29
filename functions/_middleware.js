// Host-restricted GA4 instrumentation for the PageRo-owned service only.
// No tracking on preview deployments, API, admin, or other domains.
const HOST = 'peopleent.pagero.kr';
const GA4_ID = 'G-501Z526B8H';
const MARKER = 'data-pagero-portfolio-ga4';
const RESTRICTED_PATH = /^\/(?:api|admin|dashboard|account)(?:\/|$)/i;

function tag() {
  return `<script ${MARKER}>(function(){if(location.hostname!=='${HOST}')return;window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config','${GA4_ID}');var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${GA4_ID}';document.head.appendChild(s)})();</script>`;
}

export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (context.request.method !== 'GET' || !response.ok || url.hostname.toLowerCase() !== HOST || RESTRICTED_PATH.test(url.pathname) || !type.includes('text/html')) return response;

  const html = await response.text();
  if (!/<\/head>/i.test(html) || html.includes(MARKER)) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
  const modified = html.replace(/<\/head>/i, tag() + '\n</head>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(modified, { status: response.status, statusText: response.statusText, headers });
}
