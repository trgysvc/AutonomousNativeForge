import React, { useState, useEffect, useCallback } from 'react';

type Category = {
  id: string;
  name: string;
  parentId?: string | null;
};

type Product = {
  id: string;
  name: string;
  categoryId: string;
  price: number;
};

const ProductSearch: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());

  // Debounce hook
  const useDebounce = <T>(value: T, delay: number): T => {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
      const handler = setTimeout(() => setDebouncedValue(value), delay);
      return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
  };

  const debouncedSearch = useDebounce(searchTerm, 300);

  // Fetch categories and products on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catRes, prodRes] = await Promise.all([
          fetch('/api/menu/categories'),
          fetch('/api/menu/products'),
        ]);
        if (!catRes.ok || !prodRes.ok) throw new Error('Failed to fetch');
        const categoriesData: Category[] = await catRes.json();
        const productsData: Product[] = await prodRes.json();
        setCategories(categoriesData);
        setProducts(productsData);
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();
  }, []);

  // Build category tree for UI
  const buildCategoryTree = (categories: Category[], parentId?: string | null): Category[] => {
    return categories
      .filter(cat => cat.parentId === parentId)
      .map(cat => ({
        ...cat,
        children: buildCategoryTree(categories, cat.id),
      }));
  };

  const categoryTree = buildCategoryTree(categories);

  // Filter products
  const filteredProducts = useCallback(() => {
    return products.filter(product => {
      const matchesSearch =
        product.name.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchesCategory =
        selectedCategoryIds.size === 0 ||
        selectedCategoryIds.has(product.categoryId);
      return matchesSearch && matchesCategory;
    });
  }, [products, debouncedSearch, selectedCategoryIds]);

  // Toggle category selection
  const toggleCategory = (id: string) => {
    setSelectedCategoryIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  // Render category tree recursively
  const renderCategoryTree = (cats: Category[]) => (
    <ul className="space-y-1 pl-4">
      {cats.map(cat => (
        <li key={cat.id} className="flex items-start">
          <input
            type="checkbox"
            id={`cat-${cat.id}`}
            checked={selectedCategoryIds.has(cat.id)}
            onChange={() => toggleCategory(cat.id)}
            className="mr-2 h-4 w-4 text-indigo-600"
          />
          <label htmlFor={`cat-${cat.id}`} className="cursor-select text-sm">
            {cat.name}
          </label>
          {cat.children && cat.children.length > 0 && (
            <React.Fragment>
              <ul className="mt-1 pl-2">{renderCategoryTree(cat.children)}</ul>
            </React.Fragment>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Ürün Ara ve Filtrele</h2>

      <div className="mb-4">
        <label htmlFor="search-input" className="block text-sm font-medium mb-1">
          Ürün Ara
        </label>
        <input
          id="search-input"
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Ürün adı..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="category-filter" className="block text-sm font-medium mb-1">
          Kategori Filtrele
        </label>
        <div id="category-filter" className="max-h-60 overflow-y-auto border border-gray-300 rounded p-2">
          {renderCategoryTree(categoryTree)}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-2">Sonuçlar</h3>
        {filteredProducts().length === 0 ? (
          <p className="text-gray-500">Ürün bulunamadı.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts().map(product => (
              <li key={product.id} className="border p-3 rounded">
                <h4 className="font-medium">{product.name}</h4>
                <p className="text-sm text-gray-600">₺{product.price.toFixed(2)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ProductSearch;