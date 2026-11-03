#!/usr/bin/env python3
"""Audit deployed PEOPLEENT pages over HTTP; does not query Google Search Console.

Returns nonzero if the live site's crawl-facing response is inconsistent with
the checked-out sitemap and canonical markup. Saves a diagnostic JSON report.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

BASE = "https://peopleent.pagero.kr"
ROOT = Path(__file__).resolve().parents[1]
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
BROWSER_UA = "Mozilla/5.0 (compatible; PEOPLEENT-indexability-check/1.0)"
BOT_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)"
BOT_SAMPLE = ("/", "/insight/", "/corporate-event/", "/insight/event-agency-cost/")
MAX_BODY_BYTES = 2_000_000


class PageHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals = []
        self.robots = []
        self.in_body = False
        self.in_ignored = 0
        self.text = []
        self.has_html = False
        self.title = ""
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.has_html = True
        if tag in ("script", "style", "noscript"):
            self.in_ignored += 1
        if tag == "body":
            self.in_body = True
        if tag == "title":
            self.in_title = True
        if tag == "link" and str(a.get("rel", "")).lower() == "canonical":
            self.canonicals.append(a.get("href", ""))
        if tag == "meta" and str(a.get("name", "")).lower() in ("robots", "googlebot"):
            self.robots.append(a.get("content", ""))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.in_ignored = max(0, self.in_ignored - 1)
        if tag == "body":
            self.in_body = False
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_body and self.in_ignored == 0:
            self.text.append(data)

    @property
    def visible_characters(self):
        return len(re.sub(r"\s+", " ", " ".join(self.text)).strip())


def sitemap_urls(payload: bytes) -> list[str]:
    root = ET.fromstring(payload)
    urls = [node.text.strip() for node in root.findall("./sm:url/sm:loc", NS)
            if node.text and node.text.strip()]
    if not urls or len(set(urls)) != len(urls):
        raise ValueError("Sitemap has no URLs or contains duplicates")
    return urls


def robots_allows(payload: str, urls: list[str]) -> list[str]:
    parser = urllib.robotparser.RobotFileParser()
    parser.parse(payload.splitlines())
    issues = []
    if f"Sitemap: {BASE}/sitemap.xml" not in payload:
        issues.append("robots.txt does not advertise canonical sitemap URL")
    for url in urls:
        if not parser.can_fetch("Googlebot", url):
            issues.append("robots.txt disallows Googlebot: " + url)
    return issues


def check_page_html(content: str, expected_url: str, headers: dict) -> dict:
    parsed = PageHTML()
    parsed.feed(content)
    issues = []
    if not parsed.has_html:
        issues.append("Missing HTML document (possible error/challenge page)")
    if parsed.canonicals != [expected_url]:
        issues.append("Canonical is not the single expected production URL")
    directives = " ".join(parsed.robots + [headers.get("x-robots-tag", "")]).lower()
    if re.search(r"(?:^|[,;\s])noindex(?:[,;\s]|$)", directives):
        issues.append("Noindex directive on production")
    if re.search(r"(?:^|[,;\s])nofollow(?:[,;\s]|$)", directives):
        issues.append("Nofollow directive on production")
    if parsed.visible_characters < 200:
        issues.append("Too little server-rendered visible text (fewer than 200 characters)")
    if not parsed.title.strip():
        issues.append("Title missing from live HTML")
    if "just a moment" in content[:4000].lower() and "cloudflare" in content[:4000].lower():
        issues.append("Cloudflare challenge detected")
    return {
        "canonical": parsed.canonicals,
        "title": parsed.title.strip()[:120],
        "visible_characters": parsed.visible_characters,
        "x_robots_tag": headers.get("x-robots-tag", ""),
        "issues": issues,
    }


def request(url: str, agent: str, attempts: int = 3, delay: float = 1) -> dict:
    last = {}
    for attempt in range(attempts):
        start = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": agent,
                "Accept": "text/html,application/xml,text/plain;q=0.9,*/*;q=0.7",
            })
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read(MAX_BODY_BYTES + 1)
                if len(data) > MAX_BODY_BYTES:
                    raise ValueError("Response exceeds maximum audit byte size")
                return {
                    "url": url,
                    "status": response.status,
                    "final_url": response.url,
                    "content_type": response.headers.get("content-type", ""),
                    "headers": dict((k.lower(), v) for k, v in response.headers.items()),
                    "content": data,
                    "elapsed_seconds": round(time.monotonic() - start, 2),
                }
        except urllib.error.HTTPError as exc:
            last = {"url": url, "status": exc.code, "error": f"HTTP {exc.code}",
                    "elapsed_seconds": round(time.monotonic() - start, 2)}
        except (ValueError, OSError, TimeoutError) as exc:
            last = {"url": url, "status": None,
                    "error": str(exc)[:200],
                    "elapsed_seconds": round(time.monotonic() - start, 2)}
        if attempt + 1 < attempts:
            time.sleep(delay * (attempt + 1))
    return last


def audit_page(url: str, agent: str) -> dict:
    result = request(url, agent)
    issues = []
    if result.get("status") != 200:
        issues.append("Expected HTTP 200, received " + str(result.get("status"))
                      + ": " + result.get("error", ""))
    else:
        if result.get("final_url") != url:
            issues.append("Unexpected redirect away from canonical production URL")
        if "text/html" not in result.get("content_type", "").lower():
            issues.append("Response content-type is not HTML")
        parsed = check_page_html(result["content"].decode("utf-8", "replace"),
                                 url, result.get("headers", {}))
        result.update(parsed)
        issues.extend(parsed["issues"])
    return {
        "url": url, "agent": "crawler-like" if agent == BOT_UA else "standard",
        "status": result.get("status"), "final_url": result.get("final_url"),
        "content_type": result.get("content_type", ""),
        "canonical": result.get("canonical", []),
        "title": result.get("title", ""),
        "visible_characters": result.get("visible_characters", 0),
        "x_robots_tag": result.get("x_robots_tag", ""),
        "elapsed_seconds": result.get("elapsed_seconds"),
        "issues": issues,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="live-indexability-report.json")
    ap.add_argument("--samples-only", action="store_true",
                    help="Check homepage, hub, and example pages instead of all 35 URLs")
    args = ap.parse_args()

    expected = sitemap_urls((ROOT / "sitemap.xml").read_bytes())
    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "host": BASE, "checked_out_sitemap_count": len(expected),
        "note": ("Googlebot user-agent simulation is not proof of Google's own crawl. "
                 "HTTP tests cannot determine whether Google has indexed a page."),
        "preflight": [], "pages": [],
    }
    problems = []

    robots = request(BASE + "/robots.txt", BROWSER_UA)
    if robots.get("status") != 200:
        problems.append("robots.txt not accessible: HTTP " + str(robots.get("status"))
                        + " " + robots.get("error", ""))
    elif "text/plain" not in robots.get("content_type", "").lower():
        problems.append("robots.txt content-type is not text/plain")
    else:
        problems.extend(robots_allows(robots["content"].decode("utf-8", "replace"), expected))
    report["preflight"].append({"path": "/robots.txt", "status": robots.get("status"),
                                 "error": robots.get("error", "")})

    live_map = request(BASE + "/sitemap.xml", BROWSER_UA)
    if live_map.get("status") != 200:
        problems.append("sitemap.xml not accessible: HTTP " + str(live_map.get("status"))
                        + " " + live_map.get("error", ""))
    else:
        try:
            live = sitemap_urls(live_map["content"])
            if set(live) != set(expected):
                missing = sorted(set(expected) - set(live))
                extra = sorted(set(live) - set(expected))
                problems.append("Live sitemap differs from GitHub: missing=" + str(missing[:8])
                                + " extra=" + str(extra[:8]))
        except ET.ParseError as exc:
            problems.append("Live sitemap is not valid XML: " + str(exc))
        except ValueError as exc:
            problems.append("Live sitemap error: " + str(exc))
    report["preflight"].append({"path": "/sitemap.xml", "status": live_map.get("status"),
                                 "error": live_map.get("error", "")})

    urls = [url for url in expected if urlsplit(url).path in BOT_SAMPLE] if args.samples_only else expected
    jobs = [(url, BROWSER_UA) for url in urls]
    jobs.extend((BASE + path, BOT_UA) for path in BOT_SAMPLE)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(audit_page, url, ua) for url, ua in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            report["pages"].append(result)
            if result["issues"]:
                problems.extend(f"{result['agent']} {result['url']}: {msg}"
                                for msg in result["issues"])

    report["pages"].sort(key=lambda row: (row["url"], row["agent"]))
    report["summary"] = {
        "regular_pages_checked": len(urls),
        "crawler_like_samples": len(BOT_SAMPLE),
        "issues": len(problems),
        "result": "PASS" if not problems else "FAIL",
        "diagnostics": problems,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"LIVE SEARCH AUDIT: {len(urls)} normal pages, {len(BOT_SAMPLE)} crawler-like samples, "
          f"{len(problems)} issues; report: {output}")
    for issue in problems[:35]:
        print("FAIL:", issue)
    if len(problems) > 35:
        print(f"FAIL: ... {len(problems)-35} additional issues in report")
    if not problems:
        print("PASS: live HTTP, robots, sitemap, canonical, visible HTML and production indexing directives")
    return 1 if problems else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, ValueError, ET.ParseError, OSError) as exc:
        sys.exit(f"FAIL: {exc}")
