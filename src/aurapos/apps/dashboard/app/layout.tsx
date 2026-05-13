"use client";
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Dashboard layout',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isAuthenticated = document.cookie
      .split(';')
      .some((c) => c.trim().startsWith('token='));
    const publicPaths = ['/login', '/signup'];
    if (!isAuthenticated && !publicPaths.includes(pathname)) {
      router.replace('/login');
    }
  }, [pathname, router]);

  if (typeof window === 'undefined') {
    return <></>;
  }

  return (
    <html lang="en">
      <body className="flex h-screen bg-gray-50">
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col p-4">
          <h2 className="text-xl font-bold mb-6">Dashboard</h2>
          <nav className="flex-1 space-y-2">
            <a href="/" className="flex items-center px-3 py-2 rounded text-sm font-medium hover:bg-gray-100">
              Home
            </a>
            <a href="/orders" className="flex items-center px-3 py-2 rounded text-sm font-medium hover:bg-gray-100">
              Orders
            </a>
            <a href="/settings" className="flex items-center px-3 py-2 rounded text-sm font-medium hover:bg-gray-100">
              Settings
            </a>
          </nav>
        </aside>
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}