// apps/catalog/lib/blog/local-posts.ts
// File-based blog source — replaces Hashnode. Posts live in app/blog/posts/*.md
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
export type { BlogPost, BlogPostPreview } from './hashnode-posts';
import type { BlogPost, BlogPostPreview } from './hashnode-posts';

const POSTS_DIR = path.join(process.cwd(), 'app', 'blog', 'posts');

// Simple line-by-line frontmatter parser — handles colons in values safely.
// gray-matter uses js-yaml which chokes on "KEY: value with: colons" without quotes.
function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  if (!raw.startsWith('---')) return { data: {}, content: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, content: raw };
  const block = raw.slice(4, end);
  const content = raw.slice(end + 4).trimStart();
  const data: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key) data[key] = val;
  }
  return { data, content };
}

function slugFromFilename(filename: string): string {
  return filename.replace(/\.md$/, '');
}

function tagsFromString(raw: string | undefined): { name: string; slug: string }[] {
  if (!raw) return [];
  return raw.split(',').map((t) => {
    const name = t.trim();
    return { name, slug: name.toLowerCase().replace(/\s+/g, '-') };
  });
}

function readPostFile(filename: string): BlogPost | null {
  const filePath = path.join(POSTS_DIR, filename);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const { data, content } = parseFrontmatter(raw);
  const slug = (data.SLUG as string | undefined) ?? slugFromFilename(filename);
  const title = (data.TITLE as string | undefined) ?? 'Untitled';
  const markdown = content.trim();
  const html = marked(markdown) as string;

  // Published date: from frontmatter DATE or file mtime
  let publishedAt: string;
  if (data.DATE) {
    publishedAt = new Date(data.DATE as string).toISOString();
  } else {
    const stat = fs.statSync(filePath);
    publishedAt = stat.mtime.toISOString();
  }

  return {
    id: slug,
    title,
    slug,
    brief: (data.BRIEF as string | undefined) ?? markdown.replace(/#+\s[^\n]+\n*/g, '').slice(0, 200).trim(),
    content: { html, markdown },
    coverImage: data['COVER-IMAGE'] ? { url: data['COVER-IMAGE'] as string } : null,
    tags: tagsFromString(data.TAGS as string | undefined),
    publishedAt,
    updatedAt: publishedAt,
    seo: {
      title: (data['META-TITLE'] as string | undefined) ?? null,
      description: (data['META-DESC'] as string | undefined) ?? null,
    },
    canonicalUrl: null,
  };
}

function listPostFilenames(): string[] {
  try {
    return fs
      .readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse(); // newest filename last alphabetically → most recent first
  } catch {
    return [];
  }
}

export function getAllPosts(limit = 12): BlogPostPreview[] {
  return listPostFilenames()
    .slice(0, limit)
    .map((filename) => {
      const post = readPostFile(filename);
      if (!post) return null;
      const { content: _content, ...preview } = post;
      return preview as BlogPostPreview;
    })
    .filter((p): p is BlogPostPreview => p !== null);
}

export function getPostBySlug(slug: string): BlogPost | null {
  // Try exact filename match first, then scan all posts
  const direct = readPostFile(`${slug}.md`);
  if (direct) return direct;

  const filenames = listPostFilenames();
  for (const filename of filenames) {
    const post = readPostFile(filename);
    if (post?.slug === slug) return post;
  }
  return null;
}

export function getPostsByTag(tag: string, limit = 12): BlogPostPreview[] {
  return getAllPosts(200).filter((p) => p.tags.some((t) => t.slug === tag)).slice(0, limit);
}

export function getAllPostSlugs(): { slug: string; updatedAt: string }[] {
  return listPostFilenames()
    .map((filename) => {
      const post = readPostFile(filename);
      if (!post) return null;
      return { slug: post.slug, updatedAt: post.updatedAt };
    })
    .filter((s): s is { slug: string; updatedAt: string } => s !== null);
}
