import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
    </main>
  );
}
NEXT_PUBLIC_API_URL=http://localhost:3000