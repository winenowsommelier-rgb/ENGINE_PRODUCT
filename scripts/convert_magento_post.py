#!/usr/bin/env python3
"""Convert a Magento-HTML blog post (wnlq9-blog-writer output) to Journal markdown.

Keeps frontmatter; strips <title>/<script>/<style>, hero, byline, TOC;
converts product-list spans and annotated embeds to <!-- product: SKU -->;
FAQ accordions to '## Frequently Asked Questions' + '### Q'; tables,
blockquotes, headings, lists, links, images and inline tags to markdown.

Usage: python3 scripts/convert_magento_post.py <file.md> [more files...]
Writes in place.
"""
import html
import re
import sys
from pathlib import Path


def strip_inline(s: str) -> str:
    s = re.sub(r"<strong>(.*?)</strong>", r"**\1**", s, flags=re.S)
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", s, flags=re.S)
    s = re.sub(r"<em>(.*?)</em>", r"*\1*", s, flags=re.S)
    s = re.sub(r"<i>(.*?)</i>", r"*\1*", s, flags=re.S)
    s = re.sub(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', r"[\2](\1)", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)  # any leftover span/div fragments
    return html.unescape(s).strip()


def convert(text: str) -> str:
    if text.startswith("---"):
        fm_end = text.index("\n---", 3) + 4
        fm, body = text[:fm_end], text[fm_end:]
    else:
        fm, body = "", text

    # 1. drop title/script/style wholesale
    body = re.sub(r"<title>.*?</title>", "", body, flags=re.S)
    body = re.sub(r"<script>.*?</script>", "", body, flags=re.S)
    body = re.sub(r"<style>.*?</style>", "", body, flags=re.S)

    # 2. drop hero image/title, author byline, TOC blocks (template renders its own)
    body = re.sub(r'<div class="blog-hero-image">.*?</div>\s*', "", body, flags=re.S)
    body = re.sub(r'<div class="blog-hero-title">.*?</div>\s*</div>?', "", body, flags=re.S)
    body = re.sub(r"<!-- AUTHOR BYLINE -->.*?</div>\s*</div>\s*</div>", "", body, flags=re.S)
    body = re.sub(r'<div class="blog-toc">.*?</div>\s*</div>', "", body, flags=re.S)
    body = re.sub(r"<h1[^>]*>.*?</h1>", "", body, flags=re.S)
    body = re.sub(r'<div class="blog-hero-meta">.*?</div>', "", body, flags=re.S)

    # 3. product list items -> embeds (SKU span is the source of truth)
    body = re.sub(
        r"<li>\s*<span class=\"blog-product-sku\">([A-Z0-9]+)</span>.*?</li>",
        r"<!-- product: \1 -->",
        body,
        flags=re.S,
    )
    # annotated embeds -> bare embeds
    body = re.sub(r"<!--\s*product:\s*([A-Z0-9]+)\s*[—-][^>]*-->", r"<!-- product: \1 -->", body)

    # 4. FAQ accordion -> markdown
    if "blog-faq-question" in body:
        def faq_repl(m):
            q = strip_inline(m.group(1))
            a = strip_inline(m.group(2))
            return f"### {q}\n\n{a}\n"
        body = re.sub(
            r'<button class="blog-faq-question">(.*?)</button>\s*'
            r'<div class="blog-faq-answer">(.*?)</div>\s*</div>',
            faq_repl,
            body,
            flags=re.S,
        )
        # heading for the FAQ block if the section title isn't already there
        if not re.search(r"Frequently Asked Questions", body):
            body = re.sub(r'(<div class="blog-faq">)', r"## Frequently Asked Questions\n\n\1", body, count=1)

    # 5. tables -> markdown
    def table_repl(m):
        rows = re.findall(r"<tr>(.*?)</tr>", m.group(0), flags=re.S)
        out = []
        for ri, row in enumerate(rows):
            cells = [strip_inline(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, flags=re.S)]
            out.append("| " + " | ".join(cells) + " |")
            if ri == 0:
                out.append("|" + "---|" * len(cells))
        return "\n" + "\n".join(out) + "\n"
    body = re.sub(r"<table[^>]*>.*?</table>", table_repl, body, flags=re.S)

    # 6. blockquotes
    body = re.sub(
        r"<blockquote[^>]*>(.*?)</blockquote>",
        lambda m: "\n> " + strip_inline(m.group(1)).replace("\n", "\n> ") + "\n",
        body,
        flags=re.S,
    )

    # 7. headings, paragraphs, lists, images, dividers
    body = re.sub(r"<h2[^>]*>(.*?)</h2>", lambda m: "\n## " + strip_inline(m.group(1)) + "\n", body, flags=re.S)
    body = re.sub(r"<h3[^>]*>(.*?)</h3>", lambda m: "\n### " + strip_inline(m.group(1)) + "\n", body, flags=re.S)
    body = re.sub(
        r'<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>',
        r"![\2](\1)",
        body,
    )
    body = re.sub(r"<hr[^>]*>", "\n---\n", body)
    body = re.sub(r"<li>(.*?)</li>", lambda m: "- " + strip_inline(m.group(1)), body, flags=re.S)
    body = re.sub(r"</?[uo]l[^>]*>", "", body)
    body = re.sub(r"<p[^>]*>(.*?)</p>", lambda m: "\n" + strip_inline(m.group(1)) + "\n", body, flags=re.S)

    # 8. drop structural wrappers and leftover comments-markers
    body = re.sub(r"<h4[^>]*>(.*?)</h4>", lambda m: "\n**" + strip_inline(m.group(1)) + "**\n", body, flags=re.S)
    body = re.sub(r"</?div[^>]*>", "", body)
    body = re.sub(r"</?span[^>]*>", "", body)
    body = re.sub(r"<!--(?!\s*product:).*?-->", "", body, flags=re.S)
    body = html.unescape(body)
    # de-indent (nested-div indentation would read as markdown code blocks)
    body = "\n".join(l.lstrip() if not l.lstrip().startswith("|") else l.strip() for l in body.split("\n"))
    # drop decorative standalone emoji lines
    body = re.sub(r"^[\U0001F000-\U0001FAFF☀-➿️\s]+$", "", body, flags=re.M)
    body = re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"

    return fm + "\n" + body


def main() -> None:
    for arg in sys.argv[1:]:
        p = Path(arg)
        converted = convert(p.read_text())
        leftovers = re.findall(r"<(?!!--)[a-z][^>]*>", converted)
        p.write_text(converted)
        print(f"{p.name}: converted, {len(leftovers)} leftover tags" + (f" e.g. {leftovers[:3]}" if leftovers else ""))


if __name__ == "__main__":
    main()
