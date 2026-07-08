#!/usr/bin/env python3
"""
curate_blog_images.py — Replace blog cover images with quality Pexels photos.

Usage:
    PEXELS_API_KEY=xxx python3 scripts/curate_blog_images.py [--dry-run] [--slug SLUG]

Options:
    --dry-run    Print what would change without writing files
    --slug SLUG  Process only the post with this slug or filename fragment
"""
import os, sys, time, argparse
import requests
import anthropic

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'catalog', 'app', 'blog', 'posts')
PEXELS_API_KEY = os.environ.get('PEXELS_API_KEY', '')
PEXELS_SEARCH = 'https://api.pexels.com/v1/search'

_claude = anthropic.Anthropic()


# ---------------------------------------------------------------------------
# Frontmatter helpers
# ---------------------------------------------------------------------------

def parse_frontmatter(raw: str):
    """Return (fields_dict, body_markdown). Preserves insertion order."""
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
    """Reconstruct full file content from fields dict and markdown body."""
    lines = [f"{k}: {v}" for k, v in fields.items()]
    return '---\n' + '\n'.join(lines) + '\n---\n\n' + body


# ---------------------------------------------------------------------------
# Post loading
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
        posts.append({'filename': fname, 'path': path, 'fields': fields, 'body': body, 'raw': raw})
    return posts


# ---------------------------------------------------------------------------
# Claude: generate Pexels search query
# ---------------------------------------------------------------------------

def generate_search_query(title: str, tags: str) -> str:
    """Ask Claude Haiku to craft a precise Pexels search query for this post."""
    prompt = f"""You are a photo editor for a premium wine and spirits retailer in Bangkok.

Given this blog post:
- Title: {title}
- Tags: {tags}

Write a single Pexels image search query (3-6 words max) that will find a beautiful,
atmospheric, editorial-quality photo that perfectly represents this article's subject.

Rules:
- Focus on the SUBJECT (wine glass, whisky bottle, vineyard, etc.) not abstract concepts
- Good examples: "red wine glass pouring", "Japanese whisky rocks glass", "Burgundy vineyard autumn"
- Avoid: "Bangkok", "Thailand", people faces, food only (unless article is about food pairing)
- Output ONLY the search query, nothing else."""

    msg = _claude.messages.create(
        model='claude-haiku-4-5',
        max_tokens=50,
        messages=[{'role': 'user', 'content': prompt}]
    )
    return msg.content[0].text.strip().strip('"').strip("'")


# ---------------------------------------------------------------------------
# Pexels: search + select best photo
# ---------------------------------------------------------------------------

def search_pexels(query: str, per_page: int = 10):
    """
    Search Pexels and return best photo dict, or None if no results.
    Trusts Pexels' relevance ranking; prefers first result with width >= 1920px.
    Returns: {url, credit, credit_url} or None
    """
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
            raise RuntimeError('Pexels API key rejected (401) — check PEXELS_API_KEY') from e
        if status == 429:
            raise RuntimeError('Pexels rate limit hit (429) — wait before retrying') from e
        raise

    photos = resp.json().get('photos', [])
    if not photos:
        return None

    # Trust Pexels relevance order; pick first with adequate resolution
    best = next((p for p in photos if p.get('width', 0) >= 1920), photos[0])

    img_url = best['src'].get('large2x') or best['src'].get('large')
    photographer = best.get('photographer', 'Pexels')
    photo_url = best.get('url', 'https://www.pexels.com')

    return {
        'url': img_url,
        'credit': f"{photographer} via Pexels",
        'credit_url': photo_url,
    }


# ---------------------------------------------------------------------------
# Write back
# ---------------------------------------------------------------------------

def update_post_image(post: dict, photo: dict, dry_run: bool = False) -> bool:
    """Rewrite only COVER-* frontmatter fields. Returns True if file changed."""
    fields = post['fields']
    old_url = fields.get('COVER-IMAGE', '')

    fields['COVER-IMAGE'] = photo['url']
    fields['COVER-CREDIT'] = photo['credit']
    fields['COVER-CREDIT-URL'] = photo['credit_url']

    if dry_run:
        print(f"  [DRY RUN] {photo['url'][:90]}")
        return False

    new_content = build_frontmatter(fields, post['body'])
    with open(post['path'], 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"  ✓  old: {old_url[:80]}")
    print(f"     new: {photo['url'][:80]}")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true', help='Print changes without writing files')
    parser.add_argument('--slug', default=None, help='Only process post matching this slug or filename fragment')
    args = parser.parse_args()

    if not PEXELS_API_KEY and not args.dry_run:
        print('ERROR: Set PEXELS_API_KEY env var  (get a free key at https://www.pexels.com/api/)')
        sys.exit(1)

    posts = load_posts()
    if args.slug:
        posts = [p for p in posts if args.slug in p['filename'] or args.slug == p['fields'].get('SLUG', '')]
        if not posts:
            print(f'No post found matching --slug {args.slug}')
            sys.exit(1)

    label = ' [DRY RUN]' if args.dry_run else ''
    print(f"Processing {len(posts)} post(s){label}\n")

    changed = 0
    failed = 0

    for i, post in enumerate(posts, 1):
        title = post['fields'].get('TITLE', post['filename'])
        tags = post['fields'].get('TAGS', '')
        print(f"[{i}/{len(posts)}] {title}")

        try:
            query = generate_search_query(title, tags)
            print(f"  query: {query}")

            photo = search_pexels(query)
            if not photo:
                broad = ' '.join(query.split()[:2])
                print(f"  no results — retrying: {broad}")
                photo = search_pexels(broad)

            if not photo:
                print(f"  ✗ no Pexels results — skipping")
                failed += 1
                continue

            if update_post_image(post, photo, dry_run=args.dry_run):
                changed += 1

        except RuntimeError as e:
            # Auth / rate-limit errors — stop immediately, no point continuing
            print(f"\nFATAL: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"  ✗ error: {e}")
            failed += 1

        if i < len(posts):
            time.sleep(0.5)

    print(f"\nDone — {changed} updated, {failed} failed, {len(posts) - changed - failed} unchanged")
