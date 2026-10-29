'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Link from 'next/link';
import OrdersTab from './OrdersTab';
import InventoryTab from './InventoryTab';

interface Variant {
  id: string;
  size: string;
  price: number;
  stock: number;
  min_stock_alert: number;
}

interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  category: string;
  store_order: number;
  product_variants: Variant[];
}

interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  product_name?: string;
  size?: string;
}

interface Order {
  id: string;
  buyer_name: string;
  scout_unit: string;
  email?: string;
  total_amount: number;
  status: string;
  created_at: string;
  expires_at?: string | null;
  aviso_enviado?: boolean;
  items?: OrderItem[];
}

interface StockAnalysisItem {
  productId: string;
  variantId: string;
  productName: string;
  category: string;
  size: string;
  currentStock: number;
  totalSold: number;
  suggestedMinStock: number;
  currentMinAlert: number;
}

const SIZE_ORDER: { [key: string]: number } = {
  'xs': 1, 's': 2, 'm': 3, 'l': 4, 'xl': 5, 'xxl': 6, '3xl': 7,
  '4': 8, '6': 9, '8': 10, '10': 11, '12': 12, '14': 13, '16': 14,
  '3-4': 15, '5-6': 16, '7-8': 17, '9-10': 18, '11-12': 19,
  'única': 99, 'unica': 99
};

export default function AdminPage() {
  const [cajaInicial, setCajaInicial] = useState<number>(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'orders' | 'inventory' | 'stock_stats'>('orders');
  
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockAnalysis, setStockAnalysis] = useState<StockAnalysisItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [stockStatsSearch, setStockStatsSearch] = useState('');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const totalCobrado = (orders || [])
    .filter((o) => o.status === 'Pagado' || o.status === 'Entregado')
    .reduce((sum, order) => sum + Number(order.total_amount), 0);

  const cajaTotal = cajaInicial + totalCobrado;
  const dineroEsperado = (orders || [])
    .filter((o) => o.status === 'Pendiente' || o.status === 'Reservado')
    .reduce((sum, order) => sum + Number(order.total_amount), 0);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn]);

  const sortVariants = (variants: Variant[]) => {
    return [...variants].sort((a, b) => {
      const sizeA = a.size.toLowerCase().trim();
      const sizeB = b.size.toLowerCase().trim();
      if (SIZE_ORDER[sizeA] && SIZE_ORDER[sizeB]) return SIZE_ORDER[sizeA] - SIZE_ORDER[sizeB];
      if (SIZE_ORDER[sizeA]) return -1;
      if (SIZE_ORDER[sizeB]) return 1;
      const numA = parseFloat(sizeA);
      const numB = parseFloat(sizeB);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return sizeA.localeCompare(sizeB);
    });
  };

  async function fetchData() {
    setLoading(true);
    
    try {
      fetch('/api/cron').catch(() => {});
      const nowISO = new Date().toISOString();
      const { data: expiredOrders } = await supabase.from('orders').select('id').eq('status', 'Pendiente').not('expires_at', 'is', null).lt('expires_at', nowISO);
      if (expiredOrders && expiredOrders.length > 0) {
        const expiredIds = expiredOrders.map((o) => o.id);
        const { data: expiredItems } = await supabase.from('order_items').select('variant_id, quantity').in('order_id', expiredIds);
        if (expiredItems && expiredItems.length > 0) {
          for (const item of expiredItems) {
            if (!item.variant_id) continue;
            const { data: vData } = await supabase.from('product_variants').select('stock').eq('id', item.variant_id).single();
            if (vData) await supabase.from('product_variants').update({ stock: vData.stock + item.quantity }).eq('id', item.variant_id);
          }
        }
        await supabase.from('orders').delete().in('id', expiredIds);
      }
    } catch (cleanErr) {}

    const { data: configData } = await supabase.from('configuracion').select('caja_inicial').eq('id', 1).maybeSingle();
    if (configData) setCajaInicial(configData.caja_inicial || 0);

    const { data: invData } = await supabase
      .from('products')
      .select('id, name, description, image_url, category, store_order, product_variants (id, size, price, stock, min_stock_alert)')
      .order('store_order', { ascending: true })
      .order('name');

    let loadedProducts: Product[] = [];
    if (invData) {
      loadedProducts = (invData as Product[])
        .filter((p) => p.product_variants.length > 0)
        .map((p) => ({ ...p, product_variants: sortVariants(p.product_variants) }));
      setProducts(loadedProducts);
    }

    const variantLookup: { [variantId: string]: any } = {};
    loadedProducts.forEach((p) => {
      p.product_variants.forEach((v) => {
        variantLookup[v.id] = { productId: p.id, productName: p.name, category: p.category, size: v.size, price: v.price, stock: v.stock };
      });
    });

    const { data: ordData } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    const { data: allItemsData } = await supabase.from('order_items').select('*');

    if (allItemsData && loadedProducts.length > 0) {
      const salesByVariant: { [variantId: string]: number } = {};
      allItemsData.forEach((item: any) => {
        salesByVariant[item.variant_id] = (salesByVariant[item.variant_id] || 0) + item.quantity;
      });

      const analysisList: StockAnalysisItem[] = [];
      loadedProducts.forEach((p) => {
        p.product_variants.forEach((v) => {
          const sold = salesByVariant[v.id] || 0;
          let suggested = 0;
          if (sold === 0) suggested = 1; else suggested = sold + 1;

          analysisList.push({
            productId: p.id,
            variantId: v.id,
            productName: p.name,
            category: p.category,
            size: v.size,
            currentStock: v.stock,
            totalSold: sold,
            suggestedMinStock: suggested,
            currentMinAlert: v.min_stock_alert || 0
          });
        });
      });

      analysisList.sort((a, b) => b.totalSold - a.totalSold);
      setStockAnalysis(analysisList);
    }

    if (ordData) {
      const enrichedOrders: Order[] = (ordData as Order[]).map((ord) => {
        const rawItems = (allItemsData || []).filter((item: any) => item.order_id === ord.id);
        const mappedItems: OrderItem[] = rawItems.map((it: any) => {
          const found = variantLookup[it.variant_id];
          return {
            id: it.id, order_id: it.order_id, variant_id: it.variant_id, quantity: it.quantity, unit_price: Number(it.unit_price),
            product_name: found ? found.productName : 'Artículo descatalogado', size: found ? found.size : '-',
          };
        });
        return { ...ord, items: mappedItems };
      });
      setOrders(enrichedOrders);
      if (editingOrder) setEditingOrder(enrichedOrders.find((o) => o.id === editingOrder.id) || null);
    }
    setLoading(false);
  }
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput, name: adminName }),
      });
      const data = await res.json();
      if (res.ok && data.success && adminName.trim() !== '') {
        const fechaActual = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
        await supabase.from('admin_logs').insert([{ admin_name: adminName, created_at: fechaActual }]);
        setIsLoggedIn(true);
        setLoginError(false);
      } else {
        setLoginError(true);
        setPasswordInput('');
      }
    } catch (err) {
      setLoginError(true);
      setPasswordInput('');
    }
    setIsLoggingIn(false);
  };

  const handleEditCaja = async () => {
    const input = window.prompt(
      `Base actual (sin contar ventas): ${cajaInicial.toFixed(2)} €\n\n¿Cuánto dinero quieres fijar como base o ajuste inicial?\n(Usa un punto para los céntimos, ej: 50.50)`
    );
    if (input === null || input.trim() === '') return;
    const parsed = parseFloat(input);
    if (isNaN(parsed)) {
      alert('Por favor, introduce un número válido.');
      return;
    }
    setCajaInicial(parsed);
    await supabase.from('configuracion').upsert({ id: 1, caja_inicial: parsed });
  };

  const handleRestarCaja = async () => {
    const input = window.prompt(
      `Dinero Total en la caja ahora mismo: ${cajaTotal.toFixed(2)} €\n\n¿Cuánto dinero vas a SACAR para gastos o material?\n(Usa un punto para céntimos, ej: 45.50)`
    );
    if (input === null || input.trim() === '') return;
    const parsed = parseFloat(input);
    if (isNaN(parsed) || parsed <= 0) {
      alert('Por favor, introduce un número válido mayor que 0.');
      return;
    }
    const nuevaCajaInicial = cajaInicial - parsed;
    setCajaInicial(nuevaCajaInicial);
    await supabase.from('configuracion').upsert({ id: 1, caja_inicial: nuevaCajaInicial });
  };

  const handleApplySuggestedMinStock = async () => {
    if (!window.confirm("¿Asignar de forma automática el 'Stock Mínimo Sugerido' como la nueva alerta para cada talla?\n\nTranquilo, esto NO modificará tu cantidad de prendas en el almacén, solo fijará el límite para que el sistema te avise correctamente esta ronda.")) return;
    
    for (const item of stockAnalysis) {
      await supabase.from('product_variants').update({ min_stock_alert: item.suggestedMinStock }).eq('id', item.variantId);
    }
    alert('¡Mínimos actualizados con éxito en todas las tallas!');
    fetchData();
  };

  const filteredStockAnalysis = (stockAnalysis || []).filter(
    (item) =>
      item.productName.toLowerCase().includes(stockStatsSearch.toLowerCase()) ||
      item.category.toLowerCase().includes(stockStatsSearch.toLowerCase()) ||
      item.size.toLowerCase().includes(stockStatsSearch.toLowerCase())
  );

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full border border-slate-100 text-center">
          <div className="w-12 h-12 bg-purple-100 text-purple-700 font-bold rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl">
            🔐
          </div>
          <h2 className="text-xl font-black text-slate-900 mb-1">Panel de Control</h2>
          <p className="text-xs text-slate-500 mb-6">Acceso exclusivo para responsables</p>
          <form onSubmit={handleLogin} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Tu Nombre
              </label>
              <input
                type="text"
                required
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-purple-600 transition-colors font-semibold"
                placeholder="Ej: Akela"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className={`w-full p-3 bg-slate-50 border rounded-xl text-sm tracking-widest outline-none transition-colors font-semibold ${
                  loginError ? 'border-red-500 bg-red-50' : 'border-slate-200 focus:border-purple-600'
                }`}
                placeholder="••••••••"
              />
              {loginError && (
                <p className="text-red-600 text-[11px] font-bold mt-1.5">
                  Usuario no autorizado o contraseña incorrecta.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl mt-2 transition-transform active:scale-95 shadow-md"
            >
              {isLoggingIn ? 'Verificando...' : 'Entrar al Sistema'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="w-full h-1.5 bg-gradient-to-r from-green-600 via-purple-600 to-slate-300"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* CABECERA */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-700 bg-purple-100 px-2.5 py-1 rounded-full">
              Administración • Hola, {adminName}
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">
              Gestión Tienda Scout
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              className="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              🔄 Refrescar web
            </button>
            <Link
              href="/"
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              ← Volver a la Tienda
            </Link>
          </div>
        </div>

        {/* PESTAÑAS */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'orders'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            📋 Registro de Pedidos ({(orders || []).length})
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'inventory'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            📦 Control de Inventario ({(products || []).length})
          </button>
          <button
            onClick={() => setActiveTab('stock_stats')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'stock_stats'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            📊 Estudio de Stock y Ventas
          </button>
        </div>

        {/* CONTENEDOR VISTAS */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200/80 overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-slate-400 font-semibold text-sm">
              Cargando información del sistema...
            </div>
          ) : (
            <>
              {activeTab === 'orders' && (
                <>
                  {/* TARJETAS DE TESORERÍA (SOLO EN PEDIDOS) */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-slate-100 bg-slate-50/30">
                    <div className="bg-white border border-emerald-200 p-5 rounded-2xl shadow-xs flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-2xl">
                          💶
                        </div>
                        <div>
                          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            Dinero Total en Caja
                          </h3>
                          <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-0.5">
                            {cajaTotal.toFixed(2)} €
                          </p>
                          <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                            Base ({cajaInicial.toFixed(2)} €) + Cobrado ({totalCobrado.toFixed(2)} €)
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={handleEditCaja}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                        >
                          ✏️ Ajustar Base
                        </button>
                        <button
                          onClick={handleRestarCaja}
                          className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                        >
                          ➖ Extraer Gasto
                        </button>
                      </div>
                    </div>

                    <div className="bg-amber-50/70 border border-amber-200 p-5 rounded-2xl shadow-xs flex items-center gap-4">
                      <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center text-2xl">
                        ⏳
                      </div>
                      <div>
                        <h3 className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                          Dinero Esperado (Pendiente de cobro)
                        </h3>
                        <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-0.5">
                          {dineroEsperado.toFixed(2)} €
                        </p>
                        <p className="text-[11px] font-semibold text-amber-700/70 mt-0.5">
                          Suma de pedidos Pendientes y Reservados
                        </p>
                      </div>
                    </div>
                  </div>

                  <OrdersTab
                    orders={orders || []}
                    setOrders={setOrders}
                    products={products || []}
                    fetchData={fetchData}
                    editingOrder={editingOrder}
                    setEditingOrder={setEditingOrder}
                  />
                </>
              )}

              {activeTab === 'inventory' && (
                <InventoryTab
                  products={products || []}
                  setProducts={setProducts}
                  fetchData={fetchData}
                />
              )}

              {activeTab === 'stock_stats' && (
                <div className="p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">
                        📊 Análisis de Demanda y Stock Recomendado
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                        Cálculo visual basado en el historial. Puedes pulsar el botón verde para guardar automáticamente estos mínimos en cada talla.
                      </p>
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto flex-wrap">
                      <div className="relative flex-1 sm:w-64">
                        <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                        <input
                          type="text"
                          placeholder="Buscar por polo, sudadera..."
                          value={stockStatsSearch}
                          onChange={(e) => setStockStatsSearch(e.target.value)}
                          className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-purple-600 transition-colors"
                        />
                      </div>
                      <button
                        onClick={handleApplySuggestedMinStock}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors whitespace-nowrap"
                      >
                        ✨ Asignar mínimos del año
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase bg-slate-100">
                          <th className="p-4">Producto</th>
                          <th className="p-4 text-center">Talla</th>
                          <th className="p-4 text-center">Total Vendido 📈</th>
                          <th className="p-4 text-center">Stock Actual 📦</th>
                          <th className="p-4 text-center">Mínimo Fijado 🔔</th>
                          <th className="p-4 text-center bg-purple-50 text-purple-900">A Pedir a Fábrica 🏭</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredStockAnalysis.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-12 text-center text-slate-400">
                              No hay datos que coincidan con la búsqueda.
                            </td>
                          </tr>
                        ) : (
                          filteredStockAnalysis.map((item) => {
                            const needsRestock = item.currentStock < item.currentMinAlert;
                            const aPedir = Math.max(0, item.currentMinAlert - item.currentStock);
                            
                            return (
                              <tr key={item.variantId} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4 font-bold text-slate-900">{item.productName}</td>
                                <td className="p-4 text-center font-bold">
                                  <span className="px-2.5 py-1 bg-slate-100 rounded-lg">
                                    {item.size}
                                  </span>
                                </td>
                                <td className="p-4 text-center font-extrabold text-purple-700 text-sm">
                                  {item.totalSold} uds.
                                </td>
                                <td className="p-4 text-center">
                                  <span
                                    className={`font-extrabold px-2.5 py-1 rounded-lg ${
                                      item.currentStock < 0
                                        ? 'bg-purple-100 text-purple-800'
                                        : item.currentStock <= 2
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-emerald-50 text-emerald-700'
                                    }`}
                                  >
                                    {item.currentStock} uds.
                                  </span>
                                </td>
                                <td className="p-4 text-center">
                                  {needsRestock ? (
                                    <span className="bg-amber-100 text-amber-800 font-bold px-3 py-1 rounded-lg">
                                      ⚠️ Mínimo {item.currentMinAlert} (Sugerido {item.suggestedMinStock})
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-medium">
                                      Adecuado (Mínimo {item.currentMinAlert})
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 text-center bg-purple-50/50">
                                   {aPedir > 0 ? (
                                     <span className="bg-purple-100 text-purple-800 font-black px-3 py-1.5 rounded-lg border border-purple-200">
                                       Pedir {aPedir} uds.
                                     </span>
                                   ) : (
                                     <span className="text-slate-400 font-medium">-</span>
                                   )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}