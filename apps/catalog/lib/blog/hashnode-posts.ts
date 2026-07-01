// apps/catalog/lib/blog/hashnode-posts.ts
import { hashnodeQuery } from './hashnode-client';

export type BlogPost = {
  id: string
  title: string
  slug: string
  brief: string
  content: { html: string; markdown: string }
  coverImage: { url: string } | null
  tags: { name: string; slug: string }[]
  publishedAt: string
  updatedAt: string
  seo: { title: string | null; description: string | null }
  canonicalUrl: string | null
}

type PostNode = Omit<BlogPost, 'content'> & { content?: BlogPost['content'] }

const PUB_ID = process.env.HASHNODE_PUBLICATION_ID ?? '';

const POST_FIELDS = `
  id title slug brief publishedAt updatedAt canonicalUrl
  coverImage { url }
  tags { name slug }
  seo { title description }
`;

export async function getAllPosts(first = 12): Promise<BlogPost[]> {
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: PostNode }[] } } }>(
    `query GetPosts($publicationId: ObjectId!, $first: Int!) {
      publication(id: $publicationId) {
        posts(first: $first) {
          edges { node { ${POST_FIELDS} } }
        }
      }
    }`,
    { publicationId: PUB_ID, first },
  );
  return data.publication.posts.edges.map((e) => e.node as BlogPost);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const data = await hashnodeQuery<{ publication: { post: BlogPost | null } }>(
    `query GetPost($publicationId: ObjectId!, $slug: String!) {
      publication(id: $publicationId) {
        post(slug: $slug) {
          ${POST_FIELDS}
          content { html markdown }
        }
      }
    }`,
    { publicationId: PUB_ID, slug },
  );
  return data.publication.post;
}

export async function getPostsByTag(tag: string, first = 12): Promise<BlogPost[]> {
  // NOTE: verify filter: { tagSlugs } is supported by the live Hashnode schema before
  // shipping tag pages. If not, fetch getAllPosts and filter client-side by tag slug.
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: PostNode }[] } } }>(
    `query GetPostsByTag($publicationId: ObjectId!, $first: Int!, $tag: String!) {
      publication(id: $publicationId) {
        posts(first: $first, filter: { tagSlugs: [$tag] }) {
          edges { node { ${POST_FIELDS} } }
        }
      }
    }`,
    { publicationId: PUB_ID, first, tag },
  );
  return data.publication.posts.edges.map((e) => e.node as BlogPost);
}

export async function getAllPostSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  // Ceiling: 250 posts. Hashnode uses cursor-based pagination; first: 250 silently
  // truncates if publication exceeds 250 posts. Add pagination loop when needed.
  const data = await hashnodeQuery<{ publication: { posts: { edges: { node: { slug: string; updatedAt: string } }[] } } }>(
    `query GetSlugs($publicationId: ObjectId!) {
      publication(id: $publicationId) {
        posts(first: 250) {
          edges { node { slug updatedAt } }
        }
      }
    }`,
    { publicationId: PUB_ID },
  );
  return data.publication.posts.edges.map((e) => e.node);
}
