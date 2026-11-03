#!/usr/bin/env python3
"""Offline tests for the deployed HTTP/indexability checker."""
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).resolve().parent / "check_live_indexability.py"
spec = importlib.util.spec_from_file_location("live_indexability", PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

SITEMAP = b"""<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://peopleent.pagero.kr/</loc></url>
<url><loc>https://peopleent.pagero.kr/insight/</loc></url>
</urlset>"""
GOOD_HTML = """<!doctype html><html lang="ko"><head>
<title>기업행사 운영 | PEOPLEENT</title>
<link href="https://peopleent.pagero.kr/insight/" rel="canonical">
<meta name="robots" content="index,follow">
</head><body><main><h1>기업행사 안내</h1><p>""" + ("행사 운영 실무 자료가 충분하게 표시됩니다. " * 18) + """</p></main></body></html>"""


class SitemapTests(unittest.TestCase):
    def test_sitemap_parses(self):
        self.assertEqual(audit.sitemap_urls(SITEMAP), [
            "https://peopleent.pagero.kr/", "https://peopleent.pagero.kr/insight/"
        ])

    def test_duplicates_fail(self):
        duplicate = SITEMAP.replace(
            b"<url><loc>https://peopleent.pagero.kr/insight/</loc></url>",
            b"<url><loc>https://peopleent.pagero.kr/</loc></url>"
        )
        with self.assertRaises(ValueError):
            audit.sitemap_urls(duplicate)

    def test_robots_allows_canonical_pages(self):
        text = "User-agent: *\nAllow: /\n\nSitemap: https://peopleent.pagero.kr/sitemap.xml\n"
        self.assertEqual(audit.robots_allows(text, audit.sitemap_urls(SITEMAP)), [])

    def test_googlebot_disallow_reported(self):
        text = ("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\n"
                "Disallow: /insight/\nSitemap: https://peopleent.pagero.kr/sitemap.xml\n")
        problems = audit.robots_allows(text, audit.sitemap_urls(SITEMAP))
        self.assertTrue(any("/insight/" in problem for problem in problems))


class HtmlTests(unittest.TestCase):
    def test_good_html_is_crawlable(self):
        row = audit.check_page_html(GOOD_HTML, "https://peopleent.pagero.kr/insight/", {})
        self.assertFalse(row["issues"], row)
        self.assertGreater(row["visible_characters"], 200)

    def test_mismatched_canonical_fails(self):
        row = audit.check_page_html(GOOD_HTML, "https://peopleent.pagero.kr/", {})
        self.assertTrue(any("Canonical" in problem for problem in row["issues"]))

    def test_noindex_header_or_meta_fails(self):
        row = audit.check_page_html(GOOD_HTML, "https://peopleent.pagero.kr/insight/",
                                    {"x-robots-tag": "noindex, nofollow"})
        self.assertTrue(any("Noindex" in problem for problem in row["issues"]))
        row = audit.check_page_html(GOOD_HTML.replace("index,follow", "noindex,follow"),
                                    "https://peopleent.pagero.kr/insight/", {})
        self.assertTrue(any("Noindex" in problem for problem in row["issues"]))

    def test_script_only_page_fails(self):
        body = '<html><head><title>Empty</title><link rel="canonical" href="https://peopleent.pagero.kr/insight/"></head><body><script>' + ("text " * 250) + '</script></body></html>'
        row = audit.check_page_html(body, "https://peopleent.pagero.kr/insight/", {})
        self.assertTrue(any("visible text" in problem for problem in row["issues"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
