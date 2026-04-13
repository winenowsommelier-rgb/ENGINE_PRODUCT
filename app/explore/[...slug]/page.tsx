import ExploreClient from "../ExploreClient";

interface Props {
  params: Promise<{ slug: string[] }>;
}

export default async function ExploreSlugPage({ params }: Props) {
  const { slug } = await params;
  return <ExploreClient slug={slug} />;
}
