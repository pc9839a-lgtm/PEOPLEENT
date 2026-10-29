#!/usr/bin/env python3
"""Validate PEOPLEENT insight release content, SEO metadata and reciprocal links."""
from __future__ import annotations
import json, re, sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://peopleent.pagero.kr"
NEW = [
    "event-rfp-writing",
    "event-cue-sheet-guide",
    "conference-registration-operations",
    "corporate-townhall-meeting",
    "hybrid-conference-operations",
    "vip-event-protocol",
    "event-safety-response-plan",
    "event-results-reporting",
    "corporate-awards-ceremony",
    "exhibition-booth-operations",
]

class Parse(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []
        self.headings = []
        self.canonicals = []
        self.lds = []
        self.in_script = False
        self.ld_buf = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"): self.hrefs.append(a["href"])
        if tag == "link" and a.get("rel") == "canonical": self.canonicals.append(a.get("href"))
        if tag == "h1": self.headings.append("h1")
        if tag == "script" and a.get("type") == "application/ld+json":
            self.in_script = True
            self.ld_buf = []
    def handle_data(self, data):
        if self.in_script: self.ld_buf.append(data)
    def handle_endtag(self, tag):
        if tag == "script" and self.in_script:
            self.lds.append(json.loads("".join(self.ld_buf)))
            self.in_script = False

def check(ok, message):
    if not ok: raise AssertionError(message)

def parse_html(path):
    h = Parse()
    h.feed(path.read_text(encoding="utf-8"))
    return h

def target_path(href):
    parsed = urlsplit(href)
    if parsed.scheme and parsed.netloc not in ("peopleent.pagero.kr",): return None
    if parsed.fragment and not parsed.path: return None
    path = parsed.path
    if path.startswith("/insight/") and path.endswith("/"):
        return ROOT / path.removeprefix("/") / "index.html"
    return None

def main():
    check((ROOT/"assets/insight-article.css").exists(), "Article shared CSS absent")
    xml = ET.parse(ROOT/"sitemap.xml").getroot()
    sitemap = [node.text for node in xml.iter() if node.tag.endswith("}loc")]
    check(len(sitemap) == 28 and len(set(sitemap)) == 28, "Sitemap must have 28 unique URLs")
    rss_root = ET.parse(ROOT/"rss.xml").getroot()
    rss_items = rss_root.findall("./channel/item")
    check(len(rss_items) == 20, "RSS must include 20 items")
    rss_links = [x.findtext("link") for x in rss_items]
    check(len(set(rss_links)) == 20, "RSS duplicate links")
    hub_file = ROOT/"insight/index.html"
    hub = parse_html(hub_file)
    hub_links = [x for x in hub.hrefs if re.fullmatch(r"/insight/[^/]+/", x)]
    check(len(hub_links) == 20 and len(set(hub_links)) == 20, "Hub must display 20 unique article cards")
    check(len(hub.lds) == 1, "Hub JSON-LD missing or duplicated")
    itemlist = next(x for x in hub.lds[0]["@graph"] if x["@type"] == "ItemList")
    check(itemlist["numberOfItems"] == 20 and len(itemlist["itemListElement"]) == 20, "Hub ItemList count mismatch")
    for slug in NEW:
        path = ROOT/"insight"/slug/"index.html"
        check(path.exists(), f"New article missing: {slug}")
        text = path.read_text(encoding="utf-8")
        p = parse_html(path)
        url = f"{BASE}/insight/{slug}/"
        check(p.canonicals == [url], f"Bad canonical for {slug}")
        check(p.headings == ["h1"], f"Expected single h1 for {slug}")
        check(len(p.lds) == 1, f"Missing Article schema for {slug}")
        graph = p.lds[0]["@graph"]
        article = next(x for x in graph if x["@type"] == "Article")
        check(article["datePublished"] == "2026-10-29" and article["mainEntityOfPage"]["@id"] == url, f"Article schema date/canonical mismatch: {slug}")
        check(text.count('<section id="step-') == 6, f"Must provide six substantive sections: {slug}")
        check(text.count("<dt>Q.") >= 2, f"Must include FAQ: {slug}")
        check(len(re.sub(r"<[^>]+>", "", text)) > 1600, f"Too little editorial content: {slug}")
        check(url in sitemap and url in rss_links, f"Unlisted article: {slug}")
        check(f"/insight/{slug}/" in hub_links, f"Hub missing: {slug}")
        for href in p.hrefs:
            target = target_path(href)
            if target: check(target.exists(), f"Broken internal related link in {slug}: {href}")
    for href in hub_links:
        target = target_path(href)
        check(target is not None and target.exists(), f"Broken hub link: {href}")
    print(f"PASS: {len(NEW)} new guides; {len(hub_links)} hub articles; {len(sitemap)} sitemap URLs; {len(rss_links)} RSS items")

if __name__ == "__main__":
    try: main()
    except (AssertionError,ValueError,ET.ParseError,KeyError) as exc:
        sys.exit(f"FAIL: {exc}")
