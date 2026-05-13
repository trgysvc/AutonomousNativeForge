import { useEffect, useState } from 'react';

interface Metric {
  title: string;
  value: string;
  subtitle: string;
}

interface Insight {
  title: string;
  description: string;
}

export default function PanelPage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock data - in real implementation, fetch from Supabase or API
    const mockMetrics: Metric[] = [
      { title: 'Toplam Satış', value: '24.500 TL', subtitle: 'Bu ay %12 artış' },
      { title: 'Bugünkü Sipariş', value: '128', subtitle: 'Dün比 %8 artış' },
      { title: 'Ortalama Sipariş Değeri', value: '45,50 TL', subtitle: 'Bu hafta %2 düşüş' },
      { title: 'Meme Memnuniyeti', value: '4,8/5', subtitle: 'Bu ay %0,3 artış' }
    ];

    const mockInsights: Insight[] = [
      {
        title: 'Satış Tahmini',
        description: 'AI analizine göre gelecek hafta satışlarda %15 artış bekleniyor.'
      },
      {
        title: 'Stok Uyarısı',
        description: '5 üründe kritik stok seviyesi tespit edildi. Yeniden sipariş verin.'
      },
      {
        title: 'Yoğun Saatler',
        description: 'En yoğun saatleriniz 18:00-21:00 arasında. Bu sürede ek personel planlayın.'
      },
      {
        title: 'Müşteri Geri Bildirimi',
        description: 'Yeni menü öğeleriyle olumlu geri bildirimler %20 arttı.'
      }
    ];

    setMetrics(mockMetrics);
    setInsights(mockInsights);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="animate-pulse">
          <div className="w-32 h-8 bg-gray-200 rounded mb-2"></div>
          <div className="w-48 h-8 bg-gray-200 rounded mb-2"></div>
          <div className="w-64 h-8 bg-gray-200 rounded mb-2"></div>
          <div className="w-40 h-8 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">Kontrol Paneli</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {metrics.map((metric, index) => (
          <div key={index} className="bg-white rounded-xl shadow p-4">
            <h3 className="text-lg font-medium mb-2 text-gray-700">{metric.title}</h3>
            <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
            <p className="text-sm text-gray-500">{metric.subtitle}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {insights.map((insight, index) => (
          <div key={index} className="bg-white rounded-xl shadow p-5">
            <h3 className="text-xl font-semibold mb-3 text-gray-800">{insight.title}</h3>
            <p className="text-gray-600">{insight.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}