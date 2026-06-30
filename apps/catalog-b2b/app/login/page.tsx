'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push('/');
    } else {
      setError('Invalid password');
      setPassword('');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="bg-white border border-neutral-200 rounded-xl p-10 w-full max-w-sm shadow-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl font-bold tracking-tight text-neutral-900">WNLQ9</span>
          <span className="ml-2 text-xs font-semibold tracking-widest text-white bg-neutral-800 rounded px-2 py-0.5 align-middle">B2B</span>
          <p className="mt-3 text-sm text-neutral-500">Wholesale access</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full border border-neutral-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white py-3 rounded-lg text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </main>
  );
}
