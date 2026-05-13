import { useState, useEffect, useCallback } from 'react';

type Category = {
  id: string;
  name: string;
  children?: Category[];
};

type Product = {
  id: string;
  name: string;
  price: number;
  categoryId: string;
};

const API_BASE = process.env.NEXT_PUBLIC_MENU_API_URL || '/api/menu';

export default function ProductSearch() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch categories on mount
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch(`${API_BASE}/categories`);
        if (!res.ok) throw new Error('Failed to fetch categories');
        const data: Category[] = await res.json();
        setCategories(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }
    loadCategories();
  }, []);

  // Debounce search term (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Fetch products when category or debounced search changes
  useEffect(() => {
    async function loadProducts() {
      if (!selectedCategoryId) {
        setProducts([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          categoryId: selectedCategoryId,
          search: debouncedSearch,
        });
        const res = await fetch(`${API_BASE}/products?${query}`);
        if (!res.ok) throw new Error('Failed to fetch products');
        const data: Product[] = await res.json();
        setProducts(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, [selectedCategoryId, debouncedSearch]);

  // Flatten category tree for simple select
  const flattenCategories = (cats: Category[]): { id: string; name: string }[] => {
    const result: { id: string; name: string }[] = [];
    const walk = (c: Category[]) => {
      c.forEach((cat) => {
        result.push({ id: cat.id, name: cat.name });
        if (cat.children) walk(cat.children);
      });
    };
    walk(cats);
    return result;
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:space-x-3 items-end">
        <label htmlFor="category-select" className="block mb-1">
          Category
        </label>
        <select
          id="category-select"
          value={selectedCategoryId ?? ''}
          onChange={(e) => setSelectedCategoryId(e.target.value || null)}
          className="w-full max-w-xs p-2 border rounded"
        >
          <option value="">All Categories</option>
          {flattenCategories(categories).map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        <label htmlFor="search-input" className="block mb-1">
          Search
        </label>
        <input
          id="search-input"
          type="text"
          placeholder="Type to search..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="w-full max-w-xs p-2 border rounded"
        />
      </div>

      {loading && <div className="text-center py-4">Loading...</div>}

      {!loading && products.length === 0 && !error && (
        <div className="text-center text-gray-500 py-4">
          No products found.
        </div>
      )}

      {!loading && products.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li
              key={p.id}
              className="border p-4 rounded shadow hover:shadow-lg transition-shadow"
            >
              <h3 className="font-semibold">{p.name}</h3>
              <p className="text-gray-600">Price: {p.price.toFixed(2)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}