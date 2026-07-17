#!/usr/bin/env python3
"""
curate_inline_images.py — Replace/add inline images inside blog post bodies.

For posts that HAVE inline images: replace every Unsplash `![]()` with a curated Pexels/Pixabay photo.
For posts with NO inline images: insert 2-3 images after the first major ## sections.

Usage:
    PEXELS_API_KEY=xxx PIXABAY_API_KEY=yyy python3 scripts/curate_inline_images.py [--dry-run] [--slug SLUG]

Pixabay (PIXABAY_API_KEY) is optional — used as a fallback when Pexels has no
results for a query. Get a free key at https://pixabay.com/api/docs/.
"""
import os, sys, re, time, argparse
import requests
import anthropic

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'catalog', 'app', 'blog', 'posts')
PEXELS_API_KEY = os.environ.get('PEXELS_API_KEY', '')
PEXELS_SEARCH = 'https://api.pexels.com/v1/search'
PIXABAY_API_KEY = os.environ.get('PIXABAY_API_KEY', '')
PIXABAY_SEARCH = 'https://pixabay.com/api/'

_claude = anthropic.Anthropic()

# Matches inline images: ![alt text](url)
INLINE_IMG_RE = re.compile(r'!\[([^\]]*)\]\(https?://[^\)]+\)')


# ---------------------------------------------------------------------------
# Frontmatter helpers (same as curate_blog_images.py)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Pexels
# ---------------------------------------------------------------------------

def search_pexels(query: str, per_page: int = 10):
    if not PEXELS_API_KEY:
        raise RuntimeError('PEXELS_API_KEY env var not set')
    try:
        resp = requests.get(
            PEXELS_SEARCH,
            headers={'Authorization': PEXELS_API_KEY},
            params={'query': query, 'per_page': per_page, 'orientation': 'landscape'},
            timeout=15,
        )
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response else 0
        if status == 401:
            raise RuntimeError('Pexels API key rejected (401)') from e
        if status == 429:
            raise RuntimeError('Pexels rate limit hit (429) — wait before retrying') from e
        raise

    photos = resp.json().get('photos', [])
    if not photos:
        return None

    best = next((p for p in photos if p.get('width', 0) >= 1920), photos[0])
    img_url = best['src'].get('large2x') or best['src'].get('large')
    photographer = best.get('photographer', 'Pexels')
    photo_url = best.get('url', 'https://www.pexels.com')

    return {
        'url': img_url,
        'credit': f"{photographer} via Pexels",
        'credit_url': photo_url,
    }


def search_pixabay(query: str, per_page: int = 10):
    """
    Search Pixabay and return best photo dict, or None if no results/no key.
    Same return shape as search_pexels() so callers can treat them interchangeably.
    """
    if not PIXABAY_API_KEY:
        return None

    try:
        resp = requests.get(
            PIXABAY_SEARCH,
            params={
                'key': PIXABAY_API_KEY,
                'q': query,
                'image_type': 'photo',
                'orientation': 'horizontal',
                'per_page': max(per_page, 3),  # Pixabay minimum is 3
                'safesearch': 'true',
            },
            timeout=15,
        )
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response else 0
        if status == 429:
            raise RuntimeError('Pixabay rate limit hit (429) — wait before retrying') from e
        raise

    hits = resp.json().get('hits', [])
    if not hits:
        return None

    best = next((p for p in hits if p.get('imageWidth', 0) >= 1920), hits[0])
    img_url = best.get('largeImageURL') or best.get('webformatURL')
    user = best.get('user', 'Pixabay')
    photo_url = best.get('pageURL', 'https://pixabay.com')

    return {
        'url': img_url,
        'credit': f"{user} via Pixabay",
        'credit_url': photo_url,
    }


def fetch_photo(query: str):
    """Try Pexels, then Pixabay, then a broadened 2-word Pexels/Pixabay retry."""
    photo = search_pexels(query)
    if not photo:
        photo = search_pixabay(query)
    if not photo:
        broad = ' '.join(query.split()[:2])
        photo = search_pexels(broad) or search_pixabay(broad)
    time.sleep(0.4)
    return photo


# ---------------------------------------------------------------------------
# Claude: generate replacement query for an existing image
# ---------------------------------------------------------------------------

def query_for_existing_image(alt_text: str, post_title: str) -> str:
    prompt = f"""You are a photo editor for a premium wine and spirits retailer in Bangkok.

A blog post titled "{post_title}" has an inline image with this alt text:
"{alt_text}"

Write a single Pexels search query (3-6 words) that will find a beautiful, editorial-quality
photo matching that alt text description. Focus on the subject (wine, whisky, food, vineyard, etc).
Output ONLY the search query, nothing else."""

    msg = _claude.messages.create(
        model='claude-haiku-4-5',
        max_tokens=50,
        messages=[{'role': 'user', 'content': prompt}]
    )
    return msg.content[0].text.strip().strip('"').strip("'")


# ---------------------------------------------------------------------------
# Claude: generate queries for NEW images to insert in a post
# ---------------------------------------------------------------------------

def queries_for_new_images(title: str, tags: str, section_headings: list[str]) -> list[dict]:
    """Return [{heading, query, alt_text}] for up to 3 insertion points."""
    headings_str = '\n'.join(f'- {h}' for h in section_headings[:6])
    prompt = f"""You are a photo editor for a premium wine and spirits retailer blog in Bangkok.

Blog post: "{title}"
Tags: {tags}
Sections:
{headings_str}

Choose 2-3 sections where an inline editorial photo would most enhance the article.
For each, provide:
1. The exact section heading text (copy it exactly)
2. A Pexels search query (3-6 words) for a relevant, atmospheric photo
3. A descriptive alt text for the image (one sentence, factual)

Respond in this exact format, one per line, no extra text:
HEADING: <exact heading> | QUERY: <search query> | ALT: <alt text>"""

    msg = _claude.messages.create(
        model='claude-haiku-4-5',
        max_tokens=250,
        messages=[{'role': 'user', 'content': prompt}]
    )
    result = []
    for line in msg.content[0].text.strip().split('\n'):
        line = line.strip()
        if not line.startswith('HEADING:'):
            continue
        try:
            parts = {p.split(':')[0].strip(): ':'.join(p.split(':')[1:]).strip()
                     for p in line.split('|')}
            result.append({
                'heading': parts.get('HEADING', '').strip(),
                'query': parts.get('QUERY', '').strip(),
                'alt': parts.get('ALT', '').strip(),
            })
        except Exception:
            continue
    return result[:3]


# ---------------------------------------------------------------------------
# Body manipulation
# ---------------------------------------------------------------------------

def replace_inline_images(body: str, title: str, dry_run: bool = False) -> tuple[str, int]:
    """Replace all Unsplash (and other non-Pexels) inline images. Returns (new_body, count)."""
    matches = list(INLINE_IMG_RE.finditer(body))
    count = 0
    offset = 0

    for m in matches:
        url = m.group(0)
        if 'pexels.com' in url:
            continue  # already curated

        alt_text = m.group(1)
        print(f"  → replacing: {alt_text[:60]}")

        query = query_for_existing_image(alt_text, title)
        print(f"    query: {query}")
        photo = fetch_photo(query)

        if not photo:
            print(f"    ✗ no results — keeping original")
            continue

        new_md = f"![{alt_text}]({photo['url']})\n*Photo: {photo['credit']}*"
        start = m.start() + offset
        end = m.end() + offset

        # Check if there's already a *caption* line right after
        rest = body[end + offset - offset:]  # body at current state
        # We'll work on the whole body after all matches by doing a simpler string replace
        body = body[:start] + new_md + body[end:]
        offset += len(new_md) - (end - start)
        count += 1

        if dry_run:
            print(f"    [DRY RUN] would use: {photo['url'][:80]}")
        else:
            print(f"    ✓ {photo['url'][:80]}")

    return body, count


def insert_new_images(body: str, title: str, tags: str, dry_run: bool = False) -> tuple[str, int]:
    """Insert images after chosen ## section headings. Returns (new_body, count)."""
    # Find all ## headings (not ### which are subsections)
    heading_re = re.compile(r'^(##\s+.+)$', re.MULTILINE)
    headings = [m.group(1).lstrip('# ').strip() for m in heading_re.finditer(body)]

    if not headings:
        print("  ✗ no ## headings found — skipping")
        return body, 0

    insertions = queries_for_new_images(title, tags, headings)
    print(f"  → inserting {len(insertions)} image(s)")

    count = 0
    for ins in insertions:
        heading = ins['heading']
        query = ins['query']
        alt = ins['alt']

        # Find the heading in body — match flexibly (strip ## prefix)
        pattern = re.compile(r'^(#{1,3}\s+' + re.escape(heading) + r')\s*$', re.MULTILINE)
        match = pattern.search(body)
        if not match:
            # Try partial match
            pattern2 = re.compile(r'^#{1,3}\s+.*' + re.escape(heading[:20]) + r'.*$', re.MULTILINE)
            match = pattern2.search(body)
        if not match:
            print(f"  ✗ could not locate heading: {heading[:50]}")
            continue

        print(f"  → after: {heading[:50]} | query: {query}")
        photo = fetch_photo(query)
        if not photo:
            print(f"    ✗ no results (Pexels/Pixabay) — skipping")
            continue

        img_block = f"\n\n![{alt}]({photo['url']})\n*Photo: {photo['credit']}*\n"

        # Insert after the heading line and the blank line that follows
        insert_pos = match.end()
        # Skip past a blank line if present
        after = body[insert_pos:]
        nl_match = re.match(r'\n+', after)
        if nl_match:
            insert_pos += nl_match.end()

        body = body[:insert_pos] + img_block + body[insert_pos:]
        count += 1

        if dry_run:
            print(f"    [DRY RUN] {photo['url'][:80]}")
        else:
            print(f"    ✓ {photo['url'][:80]}")

    return body, count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_posts():
    posts = []
    for fname in sorted(os.listdir(POSTS_DIR)):
        if not fname.endswith('.md'):
            continue
        path = os.path.join(POSTS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read()
        fields, body = parse_frontmatter(raw)
        inline_count = len(INLINE_IMG_RE.findall(body))
        posts.append({
            'filename': fname, 'path': path,
            'fields': fields, 'body': body, 'raw': raw,
            'inline_count': inline_count,
        })
    return posts


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--slug', default=None)
    args = parser.parse_args()

    if not PEXELS_API_KEY and not args.dry_run:
        print('ERROR: Set PEXELS_API_KEY env var')
        sys.exit(1)

    posts = load_posts()
    if args.slug:
        posts = [p for p in posts if args.slug in p['filename'] or args.slug == p['fields'].get('SLUG', '')]
        if not posts:
            print(f'No post found matching --slug {args.slug}')
            sys.exit(1)

    label = ' [DRY RUN]' if args.dry_run else ''
    has_images = [p for p in posts if p['inline_count'] > 0]
    no_images = [p for p in posts if p['inline_count'] == 0]
    print(f"Posts with inline images (replace): {len(has_images)}")
    print(f"Posts without inline images (insert): {len(no_images)}")
    print(f"Total: {len(posts)}{label}\n")

    total_changed = 0
    total_failed = 0

    for i, post in enumerate(posts, 1):
        title = post['fields'].get('TITLE', post['filename'])
        tags = post['fields'].get('TAGS', '')
        print(f"\n[{i}/{len(posts)}] {title}")

        try:
            body = post['body']
            changed = 0

            if post['inline_count'] > 0:
                body, n = replace_inline_images(body, title, dry_run=args.dry_run)
                changed += n
            else:
                body, n = insert_new_images(body, title, tags, dry_run=args.dry_run)
                changed += n

            if changed > 0 and not args.dry_run:
                new_content = build_frontmatter(post['fields'], body)
                with open(post['path'], 'w', encoding='utf-8') as f:
                    f.write(new_content)
                total_changed += 1
                print(f"  ✓ saved ({changed} image(s) updated)")
            elif changed == 0:
                print(f"  — no changes")

        except RuntimeError as e:
            print(f"\nFATAL: {e}")
            sys.exit(1)
        except Exception as e:
            import traceback
            print(f"  ✗ error: {e}")
            traceback.print_exc()
            total_failed += 1

    print(f"\nDone — {total_changed} posts updated, {total_failed} failed")
