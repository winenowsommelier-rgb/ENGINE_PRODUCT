#!/usr/bin/env python3
"""
densify_inline_images.py — Add images after EVERY ## section heading that lacks one.

Goal: every major section in every post should have a relevant photo directly below it.
Skips headings that already have an image within the next 3 lines.

Usage:
    PEXELS_API_KEY=xxx python3 scripts/densify_inline_images.py [--dry-run] [--slug SLUG] [--min-images N]
"""
import os, sys, re, time, argparse
import requests
import anthropic

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'catalog', 'app', 'blog', 'posts')
PEXELS_API_KEY = os.environ.get('PEXELS_API_KEY', '')
PEXELS_SEARCH = 'https://api.pexels.com/v1/search'

_claude = anthropic.Anthropic()

INLINE_IMG_RE = re.compile(r'!\[([^\]]*)\]\(https?://[^\)]+\)')


def parse_frontmatter(raw: str):
    if not raw.startswith('---'):
        return {}, raw
    try:
        end = raw.index('\n---', 3)
    except ValueError:
        return {}, raw
    block = raw[4:end]
    body = raw[end + 4:].lstrip('\n')
    fields = {}
    for line in block.split('\n'):
        colon = line.find(':')
        if colon == -1:
            continue
        k = line[:colon].strip()
        v = line[colon + 1:].strip()
        if k:
            fields[k] = v
    return fields, body


def build_frontmatter(fields: dict, body: str) -> str:
    lines = [f"{k}: {v}" for k, v in fields.items()]
    return '---\n' + '\n'.join(lines) + '\n---\n\n' + body


def search_pexels(query: str, per_page: int = 10):
    if not PEXELS_API_KEY:
        raise RuntimeError('PEXELS_API_KEY env var not set')
    resp = requests.get(
        PEXELS_SEARCH,
        headers={'Authorization': PEXELS_API_KEY},
        params={'query': query, 'per_page': per_page, 'orientation': 'landscape'},
        timeout=15,
    )
    resp.raise_for_status()
    photos = resp.json().get('photos', [])
    if not photos:
        return None
    best = next((p for p in photos if p.get('width', 0) >= 1920), photos[0])
    return {
        'url': best['src'].get('large2x') or best['src'].get('large'),
        'credit': f"{best.get('photographer', 'Pexels')} via Pexels",
        'credit_url': best.get('url', 'https://www.pexels.com'),
    }


def fetch_photo(query: str):
    photo = search_pexels(query)
    if not photo:
        broad = ' '.join(query.split()[:2])
        photo = search_pexels(broad)
    time.sleep(0.35)
    return photo


def heading_already_has_image(lines: list, heading_idx: int) -> bool:
    """Check if any of the next 4 lines after the heading contain an image."""
    for i in range(heading_idx + 1, min(heading_idx + 5, len(lines))):
        if INLINE_IMG_RE.search(lines[i]):
            return True
    return False


def get_image_query(post_title: str, heading: str, tags: str) -> tuple:
    """Ask Claude Haiku for a Pexels query + alt text for this heading."""
    prompt = f"""You are a photo editor for a premium wine and spirits retailer blog in Bangkok.

Blog post: "{post_title}"
Tags: {tags}
Section heading: "{heading}"

Write:
1. A Pexels search query (3-6 words) for a beautiful, editorial photo that matches this section.
   Focus on the SUBJECT (wine glass, vineyard, bottle, food, region landscape, spirits).
2. A short descriptive alt text for the image (one factual sentence).

Output EXACTLY two lines, nothing else:
QUERY: <search query>
ALT: <alt text>"""

    msg = _claude.messages.create(
        model='claude-haiku-4-5',
        max_tokens=80,
        messages=[{'role': 'user', 'content': prompt}]
    )
    text = msg.content[0].text.strip()
    query = ''
    alt = ''
    for line in text.split('\n'):
        if line.startswith('QUERY:'):
            query = line[6:].strip().strip('"').strip("'")
        elif line.startswith('ALT:'):
            alt = line[4:].strip()
    return query, alt


def densify_post(body: str, title: str, tags: str, dry_run: bool = False) -> tuple:
    """Add images after every ## heading that doesn't already have one. Returns (new_body, count)."""
    lines = body.split('\n')
    insertions = []  # list of (line_index_after_heading, query, alt)

    heading_re = re.compile(r'^##\s+(.+)$')

    for i, line in enumerate(lines):
        m = heading_re.match(line)
        if not m:
            continue
        heading_text = m.group(1).strip()

        # Skip FAQ/table/quick-reference sections (these are lists, not narrative)
        skip_headings = {'faq', 'quick pairing reference', 'quick reference', 'summary',
                         'the australian wine value comparison', 'what to avoid'}
        if heading_text.lower() in skip_headings:
            continue

        if heading_already_has_image(lines, i):
            print(f"    ✓ already has image: {heading_text[:50]}")
            continue

        print(f"  → querying image for: {heading_text[:60]}")
        query, alt = get_image_query(title, heading_text, tags)
        if not query:
            print(f"    ✗ no query returned — skipping")
            continue

        print(f"    query: {query}")
        photo = fetch_photo(query)
        if not photo:
            print(f"    ✗ no Pexels results — skipping")
            continue

        img_block = f"\n![{alt}]({photo['url']})\n*Photo: {photo['credit']}*\n"

        if dry_run:
            print(f"    [DRY RUN] {photo['url'][:80]}")
        else:
            print(f"    ✓ {photo['url'][:80]}")

        # Find insert position: after the heading line + optional blank line
        insert_after = i  # line index of the heading
        insertions.append((insert_after, img_block))

    if not insertions:
        return body, 0

    # Apply insertions in reverse order so indices don't shift
    for heading_line_idx, img_block in reversed(insertions):
        # Find where to insert: after the heading line, skip one blank line if present
        insert_at = heading_line_idx + 1
        if insert_at < len(lines) and lines[insert_at].strip() == '':
            insert_at += 1

        # Insert as new lines
        img_lines = img_block.split('\n')
        lines = lines[:insert_at] + img_lines + lines[insert_at:]

    return '\n'.join(lines), len(insertions)


def load_posts(slug=None):
    posts = []
    for fname in sorted(os.listdir(POSTS_DIR)):
        if not fname.endswith('.md'):
            continue
        if slug and slug not in fname:
            continue
        path = os.path.join(POSTS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read()
        fields, body = parse_frontmatter(raw)
        posts.append({'filename': fname, 'path': path, 'fields': fields, 'body': body})
    return posts


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--slug', default=None)
    parser.add_argument('--min-images', type=int, default=0,
                        help='Only process posts with fewer than N existing inline images')
    args = parser.parse_args()

    if not PEXELS_API_KEY and not args.dry_run:
        print('ERROR: Set PEXELS_API_KEY env var')
        sys.exit(1)

    posts = load_posts(args.slug)
    if not posts:
        print(f'No posts found')
        sys.exit(1)

    if args.min_images:
        posts = [p for p in posts if len(INLINE_IMG_RE.findall(p['body'])) < args.min_images]
        print(f"Filtered to {len(posts)} posts with fewer than {args.min_images} inline images\n")

    label = ' [DRY RUN]' if args.dry_run else ''
    print(f"Processing {len(posts)} posts{label}\n")

    total_changed = 0
    total_added = 0

    for i, post in enumerate(posts, 1):
        title = post['fields'].get('TITLE', post['filename'])
        tags = post['fields'].get('TAGS', '')
        existing = len(INLINE_IMG_RE.findall(post['body']))
        print(f"\n[{i}/{len(posts)}] {title} ({existing} existing images)")

        try:
            body, n = densify_post(post['body'], title, tags, dry_run=args.dry_run)

            if n > 0 and not args.dry_run:
                new_content = build_frontmatter(post['fields'], body)
                with open(post['path'], 'w', encoding='utf-8') as f:
                    f.write(new_content)
                total_changed += 1
                total_added += n
                print(f"  ✓ saved ({n} image(s) added)")
            elif n == 0:
                print(f"  — no sections needed images")

        except RuntimeError as e:
            print(f"\nFATAL: {e}")
            sys.exit(1)
        except Exception as e:
            import traceback
            print(f"  ✗ error: {e}")
            traceback.print_exc()

    print(f"\nDone — {total_changed} posts updated, {total_added} images added total")
