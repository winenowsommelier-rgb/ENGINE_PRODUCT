// scripts/blog-publish.ts
// Usage (run from repo root):
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --file post.md
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine,pairing" --stdin
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-image https://...
//   npx tsx scripts/blog-publish.ts --title "..." --tags "wine" --file post.md --cover-sku WN0001
//
// Must be run from repo root. --cover-sku reads data/live_products_export.json.
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

dotenv.config({ path: '.env.local' }); // loads .env.local from repo root

const TOKEN = process.env.HASHNODE_TOKEN;
const PUB_ID = process.env.HASHNODE_PUBLICATION_ID;

if (!TOKEN || !PUB_ID) {
  console.error('Missing HASHNODE_TOKEN or HASHNODE_PUBLICATION_ID in .env.local');
  process.exit(1);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? 'true';
      i++;
    }
  }
  return args;
}

async function readStdin(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveProductImageUrl(coverSku: string): string {
  const exportPath = path.join(process.cwd(), 'data', 'live_products_export.json');
  const products: Array<{ sku: string; image_url?: string | null }> = JSON.parse(
    fs.readFileSync(exportPath, 'utf8'),
  );
  const product = products.find((p) => p.sku === coverSku);
  if (!product) {
    console.warn(`⚠ SKU ${coverSku} not found in live_products_export.json`);
    const s = coverSku;
    return `https://wnlq9.shop/media/catalog/product/${s[0].toLowerCase()}/${s[1].toLowerCase()}/${s}.jpg`;
  }
  if (product.image_url) return product.image_url;
  console.warn(
    `⚠ image_url is null for ${coverSku} — using constructed CDN path, verify the image is correct`,
  );
  return `https://wnlq9.shop/media/catalog/product/${coverSku[0].toLowerCase()}/${coverSku[1].toLowerCase()}/${coverSku}.jpg`;
}

async function publish(
  title: string,
  tags: string[],
  contentMarkdown: string,
  slug: string,
  coverImageURL?: string,
  metaTitle?: string,
  metaDesc?: string,
): Promise<void> {
  const input: Record<string, unknown> = {
    publicationId: PUB_ID,
    title,
    slug,
    contentMarkdown,
    freeformTags: tags,
    canonicalUrl: `https://wnlq9.shop/blog/${slug}`,
    isNewsletterActivated: false,
  };
  if (coverImageURL) input.coverImageOptions = { coverImageURL };
  if (metaTitle || metaDesc) input.metaTags = { title: metaTitle, description: metaDesc };

  const res = await fetch('https://gql.hashnode.com', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      query: `
        mutation PublishPost($input: PublishPostInput!) {
          publishPost(input: $input) {
            post { id title slug url }
          }
        }
      `,
      variables: { input },
    }),
  });

  const json = await res.json();
  if (json.errors?.length) {
    console.error('Publish failed:', json.errors[0].message);
    process.exit(1);
  }

  const post = json.data.publishPost.post;
  console.log(`✓ Published: https://wnlq9.shop/blog/${post.slug}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const title = args.title;
  if (!title) {
    console.error('--title is required');
    process.exit(1);
  }

  const tags = (args.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const slug = args.slug ?? slugify(title);

  let contentMarkdown: string;
  if (args.file) {
    contentMarkdown = fs.readFileSync(args.file, 'utf8');
  } else if (args.stdin !== undefined) {
    contentMarkdown = await readStdin();
  } else {
    console.error('Provide --file <path> or --stdin');
    process.exit(1);
  }

  let coverImageURL: string | undefined;
  if (args['cover-image']) coverImageURL = args['cover-image'];
  else if (args['cover-sku']) coverImageURL = resolveProductImageUrl(args['cover-sku']);

  await publish(
    title,
    tags,
    contentMarkdown,
    slug,
    coverImageURL,
    args['meta-title'],
    args['meta-desc'],
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
