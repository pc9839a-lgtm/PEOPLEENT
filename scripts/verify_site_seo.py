#!/usr/bin/env python3
"""Static indexability audit for every published PEOPLEENT HTML URL.

Checks files and markup in the repository. It cannot confirm live HTTP responses
or Google's own index selection; those require deployment and Search Console.
"""
from __future__ import annotations

import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://peopleent.pagero.kr"
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
HTML_PATHS = sorted(
    [ROOT / "index.html"]
    + list(ROOT.glob("*/index.html"))
    + list(ROOT.glob("insight/*/index.html"))
)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def expected_url(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    return BASE + "/" if relative == "index.html" else BASE + "/" + relative.removesuffix("index.html")


def local_path(url: str, source_url: str) -> Path | None:
    parsed = urlsplit(url)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        return None
    if parsed.netloc and parsed.netloc.lower() != "peopleent.pagero.kr":
        return None
    if not parsed.path:
        return None
    path = unquote(parsed.path)
    if not path.startswith("/"):
        path = posixpath.join(urlsplit(source_url).path, path)
    path = posixpath.normpath(path)
    if parsed.path.endswith("/") or path == "/":
        path = path.rstrip("/") + "/index.html"
    return ROOT / path.lstrip("/")


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    check(HTML_PATHS, "No HTML pages found")
    sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
    loc_nodes = sitemap.findall("./sm:url", SITEMAP_NS)
    listed: dict[str, str] = {}
    for node in loc_nodes:
        loc = node.findtext("sm:loc", default="", namespaces=SITEMAP_NS)
        lastmod = node.findtext("sm:lastmod", default="", namespaces=SITEMAP_NS)
        if loc in listed:
            errors.append("Duplicate sitemap URL: " + loc)
        listed[loc] = lastmod
        if not lastmod:
            errors.append("Missing sitemap lastmod: " + loc)
        else:
            try:
                if date.fromisoformat(lastmod) > date.today():
                    warnings.append("Sitemap future-dated URL: " + loc)
            except ValueError:
                errors.append("Malformed sitemap lastmod: " + loc)
    expected = {expected_url(path) for path in HTML_PATHS}
    for url in sorted(expected - set(listed)):
        errors.append("Missing in sitemap: " + url)
    for url in sorted(set(listed) - expected):
        errors.append("Sitemap URL has no index.html: " + url)

    titles: dict[str, list[str]] = defaultdict(list)
    canonicals: dict[str, list[str]] = defaultdict(list)
    inbound = Counter()
    checked_links = 0
    schema_count = 0
    for path in HTML_PATHS:
        text = path.read_text(encoding="utf-8")
        source_url = expected_url(path)
        tag = path.relative_to(ROOT).as_posix()
        title = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
        if not title or not title.group(1).strip():
            errors.append(tag + ": missing title")
        else:
            titles[title.group(1).strip()].append(tag)
        desc = re.search(r'<meta\b[^>]*\bname="description"[^>]*\bcontent="([^"]+)"', text, re.I)
        if not desc or not desc.group(1).strip():
            errors.append(tag + ": missing meta description")
        robots = re.search(r'<meta\b[^>]*\bname="robots"[^>]*\bcontent="([^"]+)"', text, re.I)
        if not robots or not re.search(r"(?i)(?:^|,)\s*index\s*(?:,|$)", robots.group(1)):
            errors.append(tag + ": absent index robots directive")
        if robots and "noindex" in robots.group(1).lower():
            errors.append(tag + ": noindex on published page")
        canonical = re.findall(r'<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"', text, re.I)
        if canonical != [source_url]:
            errors.append(tag + ": canonical mismatch " + repr(canonical))
        for item in canonical:
            canonicals[item].append(tag)
        if len(re.findall(r"<h1\b", text, re.I)) != 1:
            errors.append(tag + ": expected exactly one H1")
        blocks = re.findall(r'<script\b[^>]*\btype="application/ld\+json"[^>]*>(.*?)</script>', text, re.I | re.S)
        if not blocks:
            errors.append(tag + ": missing JSON-LD")
        for block in blocks:
            try:
                obj = json.loads(block)
                check(isinstance(obj, dict) and "@context" in obj, "invalid schema root")
                schema_count += 1
            except (ValueError, AssertionError) as exc:
                errors.append(tag + ": invalid JSON-LD " + str(exc))
        for link in re.findall(r'\b(?:href|src)="([^"]+)"', text, re.I):
            target = local_path(link, source_url)
            if target is None:
                continue
            checked_links += 1
            if not target.is_file():
                errors.append(tag + ": broken local link " + link)
            elif target.name == "index.html":
                inbound[expected_url(target)] += 1
    for title, files in titles.items():
        if len(files) > 1:
            errors.append("Duplicate HTML title: " + title + " (" + ", ".join(files) + ")")
    for canonical, files in canonicals.items():
        if len(files) > 1:
            errors.append("Duplicate canonical: " + canonical)

    robots_txt = (ROOT / "robots.txt").read_text(encoding="utf-8")
    check(re.search(r"(?mi)^User-agent:\s*\*\s*$", robots_txt) is not None, "robots.txt user agent missing")
    check(re.search(r"(?mi)^Allow:\s*/\s*$", robots_txt) is not None, "robots.txt general allow missing")
    check("Sitemap: " + BASE + "/sitemap.xml" in robots_txt, "robots.txt sitemap missing")

    home = (ROOT / "index.html").read_text(encoding="utf-8")
    for service in ("corporate-event", "public-event", "conference", "seminar", "academic-event", "live-streaming"):
        if f'href="/{service}/"' not in home:
            errors.append("Homepage missing service link: " + service)
    if '<main class="deck"' not in home:
        errors.append("Homepage has no semantic main")
    for needed in ("overflow:visible;scroll-snap-type:none", ".slide [data-reveal]{opacity:1;transform:none}"):
        if needed not in home:
            errors.append("Homepage JS-independent visibility rule missing: " + needed)

    middleware = (ROOT / "functions/_middleware.js").read_text(encoding="utf-8")
    if "headers.set('X-Robots-Tag', 'noindex, nofollow')" not in middleware:
        errors.append("Preview deployment noindex header missing")

    unreachable = sorted(url for url in expected if url != BASE + "/" and inbound[url] == 0)
    if unreachable:
        warnings.append(str(len(unreachable)) + " sitemap pages have no static inbound HTML link: " + ", ".join(unreachable))

    print(
        f"Site SEO static audit: {len(HTML_PATHS)} pages; {len(listed)} sitemap URLs; "
        f"{schema_count} JSON-LD scripts; {checked_links} local href/src references."
    )
    for w in warnings:
        print("WARN:", w)
    for e in errors:
        print("FAIL:", e)
    if errors:
        raise AssertionError(f"{len(errors)} site SEO static audit errors")
    print("PASS: published pages, canonical, robots, JSON-LD, internal links, sitemap and preview indexability")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, ET.ParseError, OSError) as exc:
        sys.exit(f"FAIL: {exc}")
