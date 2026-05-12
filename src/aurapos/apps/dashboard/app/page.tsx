# apps/dashboard/app/page.tsx
import type { ReactNode } from 'react';

export default function Page() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-gray-600">Welcome to the dashboard.</p>
    </main>
  );
}
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3001