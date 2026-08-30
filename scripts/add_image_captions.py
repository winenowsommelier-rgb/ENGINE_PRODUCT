#!/usr/bin/env python3
"""
add_image_captions.py — Add/replace inline image captions across all blog posts.

For every inline image:
  - If the next non-blank line is an italic caption (*...*), check if it contains
    photographer attribution; if so, replace with a clean descriptive caption.
  - If there is no italic caption, add one.
  - Never mention Pexels, photographer name, or any attribution.

Usage:
    python3 scripts/add_image_captions.py [--dry-run] [--slug SLUG]
"""
import os, re, sys, argparse
import anthropic

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'catalog', 'app', 'blog', 'posts')
_claude = anthropic.Anthropic()

INLINE_IMG_RE = re.compile(r'^!\[([^\]]*)\]\(https?://[^\)]+\)\s*$')
ITALIC_LINE_RE = re.compile(r'^\*[^*].+[^*]\*\s*$')
ATTRIBUTION_MARKERS = ['via pexels', 'via unsplash', 'photo:', 'photograph:', 'credit:']


def has_attribution(line: str) -> bool:
    low = line.lower()
    return any(m in low for m in ATTRIBUTION_MARKERS)


def generate_caption(post_title: str, alt_text: str, dry_run: bool = False) -> str:
    """Ask Claude Haiku for a 1-sentence evocative caption for this image."""
    if dry_run:
        return f"[would generate caption for: {alt_text[:50] or post_title}]"

    prompt = f"""You are a photo editor for a premium wine and spirits retailer blog in Bangkok.

Blog post: "{post_title}"
Image alt text: "{alt_text}"

Write ONE short, evocative caption for this image (1 sentence, max 15 words).
- Describe what the image shows or evokes
- Match the premium, knowledgeable tone of a wine and spirits retailer
- Do NOT mention any photographer, website, or attribution
- Do NOT start with "A" or "An" — start with a vivid word or the subject

Output ONLY the caption sentence, nothing else."""

    msg = _claude.messages.create(
        model='claude-haiku-4-5',
        max_tokens=60,
        messages=[{'role': 'user', 'content': prompt}]
    )
    caption = msg.content[0].text.strip().strip('"').strip("'")
    # Remove trailing period if present for consistency
    return caption


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


def process_body(body: str, title: str, dry_run: bool = False) -> tuple:
    """Process all inline images in body. Returns (new_body, changes_count)."""
    lines = body.split('\n')
    new_lines = []
    i = 0
    changes = 0

    while i < len(lines):
        line = lines[i]
        m = INLINE_IMG_RE.match(line)

        if not m:
            new_lines.append(line)
            i += 1
            continue

        # This line is an inline image
        alt_text = m.group(1).strip()
        new_lines.append(line)
        i += 1

        # Look at next line(s) to find caption
        # Skip one blank line if present
        next_i = i
        if next_i < len(lines) and lines[next_i].strip() == '':
            # There's a blank line after the image
            # Check if the line after that is an italic caption
            if next_i + 1 < len(lines) and ITALIC_LINE_RE.match(lines[next_i + 1]):
                caption_i = next_i + 1
                existing_caption = lines[caption_i].strip()

                if has_attribution(existing_caption):
                    # Replace attribution caption with clean one
                    print(f"  → replace attribution caption for: {alt_text[:50]}")
                    caption = generate_caption(title, alt_text, dry_run=dry_run)
                    if dry_run:
                        print(f"    [DRY RUN] *{caption}*")
                    else:
                        print(f"    ✓ *{caption}*")
                    # Keep the blank line, replace caption
                    new_lines.append(lines[next_i])  # blank line
                    new_lines.append(f'*{caption}*')
                    i = caption_i + 1
                    changes += 1
                else:
                    # Caption exists and is clean — keep as-is
                    print(f"  ✓ caption OK: {existing_caption[:60]}")
                    new_lines.append(lines[next_i])
                    new_lines.append(lines[caption_i])
                    i = caption_i + 1
            else:
                # Blank line, no caption follows — add one
                print(f"  → add caption for: {alt_text[:50]}")
                caption = generate_caption(title, alt_text, dry_run=dry_run)
                if dry_run:
                    print(f"    [DRY RUN] *{caption}*")
                else:
                    print(f"    ✓ *{caption}*")
                new_lines.append(lines[next_i])  # blank line
                new_lines.append(f'*{caption}*')
                i = next_i + 1
                changes += 1
        elif next_i < len(lines) and ITALIC_LINE_RE.match(lines[next_i]):
            # Italic caption immediately after image (no blank line)
            existing_caption = lines[next_i].strip()

            if has_attribution(existing_caption):
                print(f"  → replace attribution caption for: {alt_text[:50]}")
                caption = generate_caption(title, alt_text, dry_run=dry_run)
                if dry_run:
                    print(f"    [DRY RUN] *{caption}*")
                else:
                    print(f"    ✓ *{caption}*")
                new_lines.append(f'*{caption}*')
                i = next_i + 1
                changes += 1
            else:
                print(f"  ✓ caption OK: {existing_caption[:60]}")
                new_lines.append(lines[next_i])
                i = next_i + 1
        else:
            # No caption at all — add one with a blank line before it
            print(f"  → add caption for: {alt_text[:50]}")
            caption = generate_caption(title, alt_text, dry_run=dry_run)
            if dry_run:
                print(f"    [DRY RUN] *{caption}*")
            else:
                print(f"    ✓ *{caption}*")
            new_lines.append('')
            new_lines.append(f'*{caption}*')
            changes += 1

    return '\n'.join(new_lines), changes


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
    args = parser.parse_args()

    posts = load_posts(args.slug)
    if not posts:
        print('No posts found')
        sys.exit(1)

    label = ' [DRY RUN]' if args.dry_run else ''
    print(f"Processing {len(posts)} posts{label}\n")

    total_changed = 0
    total_captions = 0

    for idx, post in enumerate(posts, 1):
        title = post['fields'].get('TITLE', post['filename'])
        print(f"\n[{idx}/{len(posts)}] {title}")

        try:
            body, n = process_body(post['body'], title, dry_run=args.dry_run)

            if n > 0 and not args.dry_run:
                content = build_frontmatter(post['fields'], body)
                with open(post['path'], 'w', encoding='utf-8') as f:
                    f.write(content)
                total_changed += 1
                total_captions += n
                print(f"  ✓ saved ({n} caption(s) added/updated)")
            elif n == 0:
                print(f"  — all captions already clean")
            elif args.dry_run and n > 0:
                total_captions += n

        except Exception as e:
            import traceback
            print(f"  ✗ error: {e}")
            traceback.print_exc()

    print(f"\nDone — {total_changed} posts updated, {total_captions} captions added/updated")
