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
    check(len(sitemap) == 33 and len(set(sitemap)) == 31, "Sitemap must have 33 unique URLs")
    rss_root = ET.parse(ROOT/"rss.xml").getroot()
    rss_items = rss_root.findall("./channel/item")
    check(len(rss_items) == 25, "RSS must include 25 items")
    rss_links = [x.findtext("link") for x in rss_items]
    check(len(set(rss_links)) == 25, "RSS duplicate links")
    hub_file = ROOT/"insight/index.html"
    hub = parse_html(hub_file)
    hub_links = [x for x in hub.hrefs if re.fullmatch(r"/insight/[^/]+/", x)]
    check(len(hub_links) == 25 and len(set(hub_links)) == 23, "Hub must display 25 unique article cards")
    check(len(hub.lds) == 1, "Hub JSON-LD missing or duplicated")
    itemlist = next(x for x in hub.lds[0]["@graph"] if x["@type"] == "ItemList")
    check(itemlist["numberOfItems"] == 25 and len(itemlist["itemListElement"]) == 25, "Hub ItemList count mismatch")
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
    # New staffing guide has a distinct editorial format from the ten 2026-10-29 guides.
    staffing_slug = "event-staffing-plan"
    staffing_path = ROOT/"insight"/staffing_slug/"index.html"
    check(staffing_path.exists(), "Staffing guide missing")
    staffing_html = staffing_path.read_text(encoding="utf-8")
    staffing = parse_html(staffing_path)
    staffing_url = f"{BASE}/insight/{staffing_slug}/"
    check(staffing.canonicals == [staffing_url], "Staffing guide canonical mismatch")
    check(staffing.headings == ["h1"], "Staffing guide H1 mismatch")
    check(len(staffing.lds) == 1, "Staffing guide JSON-LD missing")
    staffing_article = next(x for x in staffing.lds[0]["@graph"] if x["@type"] == "Article")
    check(staffing_article["datePublished"] == "2026-11-01" and staffing_article["mainEntityOfPage"]["@id"] == staffing_url,
          "Staffing guide article date/canonical mismatch")
    check(all(f'id="{anchor}"' in staffing_html for anchor in
              ("roles", "collision", "sample", "handoff", "quote", "faq")),
          "Staffing guide missing substantive sections")
    check(staffing_html.count("<details>") >= 4, "Staffing guide FAQ missing")
    check(len(re.sub(r"<[^>]+>", "", staffing_html)) > 3500, "Staffing guide editorial depth too low")
    check(staffing_url in sitemap and staffing_url in rss_links,
          "Staffing guide absent from sitemap/RSS")
    check(f"/insight/{staffing_slug}/" in hub_links, "Staffing guide missing from hub")
    for href in staffing.hrefs:
        target = target_path(href)
        if target: check(target.exists(), f"Broken staffing guide link: {href}")
    # The newest guides use the same visible FAQ, schema and copyable tool checks.
    for slug in ("event-venue-site-inspection", "event-photo-video-shot-list"):
        page = ROOT / "insight" / slug / "index.html"
        check(page.exists(), f"New practical guide missing: {slug}")
        doc = page.read_text(encoding="utf-8")
        parsed = parse_html(page)
        url = f"{BASE}/insight/{slug}/"
        check(parsed.canonicals == [url], f"New guide canonical mismatch: {slug}")
        check(parsed.headings == ["h1"], f"New guide H1 mismatch: {slug}")
        check(len(parsed.lds) == 1, f"New guide JSON-LD missing: {slug}")
        article = next(x for x in parsed.lds[0]["@graph"] if x["@type"] == "Article")
        check(article["datePublished"] == "2026-11-03" and article["mainEntityOfPage"]["@id"] == url,
              f"New guide metadata mismatch: {slug}")
        clean = re.sub(r"<style[^>]*>.*?</style>|<script[^>]*>.*?</script>", "", doc, flags=re.I | re.S)
        check(len(re.sub(r"<[^>]+>", "", clean)) > 4000, f"Insufficient guide content: {slug}")
        check(doc.count('<details><summary>') >= 4, f"New guide missing FAQ: {slug}")
        check(all(f'id="{name}"' in doc for name in ("prep", "layout", "tech", "loading", "contract", "template") if slug == "event-venue-site-inspection"),
              f"Venue guide section missing: {slug}")
        check(all(f'id="{name}"' in doc for name in ("purpose", "matrix", "collision", "permissions", "delivery", "template") if slug == "event-photo-video-shot-list"),
              f"Photo guide section missing: {slug}")
        faq = next(x for x in parsed.lds[0]["@graph"] if x["@type"] == "FAQPage")["mainEntity"]
        visible_faq = re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", doc, flags=re.S)
        check(len(faq) == len(visible_faq) == 4 and all(
              x["name"] == visible_faq[i][0] and x["acceptedAnswer"]["text"] == visible_faq[i][1]
              for i, x in enumerate(faq)), f"New guide FAQ/schema mismatch: {slug}")
        if slug == "event-venue-site-inspection":
            check(all(f'id="{key}"' in doc for key in ("decision", "compare", "copy-venue-audit", "audit-a", "audit-b")),
                  "Venue comparison elements missing")
            check(len(re.findall(r'<select[^>]*data-venue="[AB]"', doc)) == 16,
                  "Venue comparison should have eight criteria for two sites")
            check("안전·접근성" in doc and "진행 불가" in doc,
                  "Venue approval and condition distinctions absent")
        else:
            check(all(f'id="{key}"' in doc for key in ("handoff", "tracker", "acceptance",
                      "copy-shot-tracker", "shot-summary", "shot-priority")),
                  "Photo shot tracker elements missing")
            check(len(re.findall(r'<select[^>]*data-shot-status="\d+"', doc)) == 12,
                  "Photo shot tracker must include twelve rows")
            check(len(re.findall(r'<input[^>]*data-shot-note="\d+"', doc)) == 12,
                  "Photo tracker notes missing")
            check("시상 장면을 촬영하지 못했다면" in doc,
                  "Photo recovery guidance missing")
        check('data-guide-draft-key="peopleent:insight:' in doc and 'data-guide-storage-status' in doc,
              f"Explicit browser draft UI missing: {slug}")
        check(all(len(re.findall(r'<button\b[^>]*data-guide-action="' + action + r'"', doc)) == 1
                  for action in ("save", "csv", "clear")),
              f"Draft save/CSV/clear buttons missing: {slug}")
        check('<script src="/assets/insight-draft-tools.js" defer></script>' in doc,
              f"Shared draft tool not loaded: {slug}")
        if slug == "event-venue-site-inspection":
            check(len(re.findall(r'<input[^>]*data-venue-note="[AB]-\d+"', doc)) == 16,
                  "Venue evidence note fields must match A/B items")
        else:
            check('peopleent:insight:shot:draft:v1' in doc,
                  "Shot draft storage key missing")
        check('id="guide-copy"' in doc and 'id="guide-template"' in doc, f"New guide template copy missing: {slug}")
        check(url in sitemap and url in rss_links and f"/insight/{slug}/" in hub_links,
              f"New guide navigation incomplete: {slug}")
        for href in parsed.hrefs:
            target = target_path(href)
            if target:
                check(target.exists(), f"New guide has broken internal link: {slug}: {href}")
    # 2026-11-03: new event communications and presenter-file handling guides.
    for slug in ("event-attendee-notice-message-templates", "event-speaker-presentation-management"):
        article_path = ROOT / "insight" / slug / "index.html"
        check(article_path.exists(), f"New publication missing: {slug}")
        doc = article_path.read_text(encoding="utf-8")
        parsed = parse_html(article_path)
        article_url = f"{BASE}/insight/{slug}/"
        check(parsed.canonicals == [article_url] and parsed.headings == ["h1"] and len(parsed.lds) == 1,
              f"Publication canonical/H1/schema mismatch: {slug}")
        structured = parsed.lds[0]["@graph"]
        article = next(x for x in structured if x["@type"] == "Article")
        check(article["datePublished"] == "2026-11-03" and article["mainEntityOfPage"]["@id"] == article_url,
              f"Publication date or main URL mismatch: {slug}")
        faq = next(x for x in structured if x["@type"] == "FAQPage")["mainEntity"]
        visible_faq = re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", doc, flags=re.S)
        check(len(faq) == len(visible_faq) == 4 and all(
              x["name"] == visible_faq[i][0] and x["acceptedAnswer"]["text"] == visible_faq[i][1]
              for i, x in enumerate(faq)), f"FAQ JSON-LD is not synchronized: {slug}")
        for part in ("role","data","schedule","examples","change","template") if slug.startswith("event-attendee") else ("roles","master","files","rehearsal","changes","template"):
            check(f'id="{part}"' in doc, f"Missing unique guide section {part}: {slug}")
        clean = re.sub(r"<style[^>]*>.*?</style>|<script[^>]*>.*?</script>", "", doc, flags=re.I | re.S)
        check(len(re.sub(r"<[^>]+>", "", clean)) > 6000,
              f"Publication lacks substantial unique material: {slug}")
        check('id="pe-guide-draft"' in doc and 'id="pe-guide-copy"' in doc,
              f"Editable operational template missing: {slug}")
        check(article_url in sitemap and article_url in rss_links and f"/insight/{slug}/" in hub_links,
              f"Publication missing from hub, sitemap or RSS: {slug}")
        for href in parsed.hrefs:
            target = target_path(href)
            if target: check(target.exists(), f"Broken related article link in {slug}: {href}")
    for href in hub_links:
        target = target_path(href)
        check(target is not None and target.exists(), f"Broken hub link: {href}")
    print(f"PASS: {len(NEW)} new guides; {len(hub_links)} hub articles; {len(sitemap)} sitemap URLs; {len(rss_links)} RSS items")

if __name__ == "__main__":
    try: main()
    except (AssertionError,ValueError,ET.ParseError,KeyError) as exc:
        sys.exit(f"FAIL: {exc}")
