import { getAllProductsB2B } from '@/lib/catalog-data';

export default function HomePage() {
  const products = getAllProductsB2B();
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>WNLQ9 B2B Catalog</h1>
      <p>{products.length} B2B products</p>
      <ul>
        {products.map((p) => (
          <li key={p.sku}>
            <strong>{p.sku}</strong> — {p.name} — B2B: {p.b2b_price ?? 'N/A'}
          </li>
        ))}
      </ul>
    </main>
  );
}
