'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Variant {
  id: string;
  size: string;
  price: number;
  stock: number;
}

interface Product {
  id: string;
  name: string;
  description: string;
  image_url: string;
  category: string;
  min_stock_alert: number;
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

export default function OrdersTab({
  orders = [],
  setOrders,
  products = [],
  fetchData,
  editingOrder,
  setEditingOrder,
}: {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  products: Product[];
  fetchData: () => Promise<void>;
  editingOrder: Order | null;
  setEditingOrder: React.Dispatch<React.SetStateAction<Order | null>>;
}) {
  const [orderSearchTerm, setOrderSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<'newest' | 'oldest' | 'amount_desc' | 'amount_asc'>('newest');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [addingVariantToOrder, setAddingVariantToOrder] = useState<string>('');
  const [addingQtyToOrder, setAddingQtyToOrder] = useState<number>(1);
  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false);

  const getExpirationBadge = (order: Order) => {
    if (order.status === 'Pagado' || order.status === 'Entregado') return null;
    if (order.status === 'Reservado' || !order.expires_at) {
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
          🛡️ Protegido (Sin caducidad)
        </div>
      );
    }

    const now = new Date();
    const expDate = new Date(order.expires_at);
    const diffMs = expDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs <= 0) {
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-md border border-red-200">
          🚨 ¡Caducado!
        </div>
      );
    }

    if (diffDays <= 2) {
      return (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-md border border-red-200">
          ⚠️ Caduca en {diffDays} {diffDays === 1 ? 'día' : 'días'}{' '}
          {order.aviso_enviado ? '• ✉️ Avisado' : ''}
        </div>
      );
    }

    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50/80 px-2 py-0.5 rounded-md border border-amber-200/60">
        ⏳ Caduca en {diffDays} días
      </div>
    );
  };

  const handleExportToCSV = () => {
    if (!orders || orders.length === 0) {
      alert('No hay pedidos para exportar.');
      return;
    }

    let csvContent =
      'data:text/csv;charset=utf-8,ID Pedido,Fecha,Comprador,Rama,Email,Estado,Producto,Talla,Cantidad,Precio Ud (€),Subtotal (€),Total Pedido (€)\r\n';

    orders.forEach((ord) => {
      const fecha = new Date(ord.created_at).toLocaleString('es-ES');
      if (ord.items && ord.items.length > 0) {
        ord.items.forEach((item) => {
          const row = [
            ord.id,
            `"${fecha}"`,
            `"${ord.buyer_name}"`,
            `"${ord.scout_unit}"`,
            `"${ord.email || ''}"`,
            `"${ord.status}"`,
            `"${item.product_name}"`,
            `"${item.size}"`,
            item.quantity,
            item.unit_price,
            (item.unit_price * item.quantity).toFixed(2),
            Number(ord.total_amount).toFixed(2),
          ];
          csvContent += row.join(',') + '\r\n';
        });
      }
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `pedidos_tienda_scout_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    let newExpiresAt: string | null | undefined = undefined;
    if (newStatus === 'Reservado') {
      newExpiresAt = null;
    } else if (newStatus === 'Pendiente') {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      newExpiresAt = d.toISOString();
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: newStatus,
              expires_at: newExpiresAt !== undefined ? newExpiresAt : o.expires_at,
            }
          : o
      )
    );

    const updatePayload: any = { status: newStatus };
    if (newExpiresAt !== undefined) {
      updatePayload.expires_at = newExpiresAt;
    }
    await supabase.from('orders').update(updatePayload).eq('id', orderId);
  };

  const handleExtendExpiration = async (
    order: Order,
    mode: 'add7' | 'add15' | 'reset15' | 'protect'
  ) => {
    setIsUpdatingOrder(true);
    try {
      let newExpiresAt: string | null = null;
      let newStatus = order.status;

      if (mode === 'protect') {
        newExpiresAt = null;
        newStatus = 'Reservado';
      } else {
        if (order.status === 'Reservado') {
          newStatus = 'Pendiente';
        }
        const baseDate =
          mode === 'reset15' || !order.expires_at || new Date(order.expires_at) < new Date()
            ? new Date()
            : new Date(order.expires_at);

        const daysToAdd = mode === 'add7' ? 7 : 15;
        baseDate.setDate(baseDate.getDate() + daysToAdd);
        newExpiresAt = baseDate.toISOString();
      }

      await supabase
        .from('orders')
        .update({
          expires_at: newExpiresAt,
          status: newStatus,
          aviso_enviado: false,
        })
        .eq('id', order.id);

      await fetchData();
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  const toggleSelectAllOrders = () => {
    if (selectedOrders.length === orders.length) setSelectedOrders([]);
    else setSelectedOrders(orders.map((o) => o.id));
  };

  const handleDeleteOrders = async (orderIds: string[]) => {
    if (
      !window.confirm(
        orderIds.length === 1
          ? '¿Seguro que quieres eliminar este pedido? (El stock de los pedidos Pendientes/Reservados se devolverá al inventario)'
          : `¿Seguro que quieres eliminar estos ${orderIds.length} pedidos?`
      )
    )
      return;

    for (const ordId of orderIds) {
      const ord = orders.find((o) => o.id === ordId);
      if (ord && ord.items && (ord.status === 'Pendiente' || ord.status === 'Reservado')) {
        for (const item of ord.items) {
          if (!item.variant_id) continue;
          const { data: vData } = await supabase
            .from('product_variants')
            .select('stock')
            .eq('id', item.variant_id)
            .single();
          if (vData) {
            await supabase
              .from('product_variants')
              .update({ stock: vData.stock + item.quantity })
              .eq('id', item.variant_id);
          }
        }
      }
    }

    const { error } = await supabase.from('orders').delete().in('id', orderIds);
    if (!error) {
      setSelectedOrders([]);
      fetchData();
    }
  };

  const handleDeleteAllOrders = async () => {
    const confirmation = window.prompt(
      "⚠️ ATENCIÓN: Vas a borrar todo el historial de pedidos (ideal para inicio de Ronda Solar). ¿Estás seguro de ello?\n\nEscribe la palabra 'BORRAR' en mayúsculas para confirmar:"
    );
    if (confirmation === 'BORRAR') {
      const allIds = orders.map((o) => o.id);
      if (allIds.length === 0) return;
      const { error } = await supabase.from('orders').delete().in('id', allIds);
      if (!error) {
        setSelectedOrders([]);
        fetchData();
        alert('¡Historial de pedidos limpiado con éxito!');
      }
    }
  };

  const handleChangeOrderItemQty = async (item: OrderItem, delta: number) => {
    if (!editingOrder) return;
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      await handleRemoveItemFromOrder(item);
      return;
    }

    setIsUpdatingOrder(true);
    try {
      if (item.variant_id) {
        const { data: vData } = await supabase
          .from('product_variants')
          .select('stock')
          .eq('id', item.variant_id)
          .single();

        if (vData) {
          await supabase
            .from('product_variants')
            .update({ stock: vData.stock - delta })
            .eq('id', item.variant_id);
        }
      }

      await supabase.from('order_items').update({ quantity: newQty }).eq('id', item.id);

      const newTotal = Math.max(
        0,
        Number(editingOrder.total_amount) + delta * Number(item.unit_price)
      );
      await supabase
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', editingOrder.id);

      await fetchData();
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  const handleRemoveItemFromOrder = async (item: OrderItem) => {
    if (!editingOrder) return;
    if (
      !window.confirm(
        `¿Quitar "${item.product_name} (Talla ${item.size})" del pedido de ${editingOrder.buyer_name}? El stock se devolverá automáticamente.`
      )
    )
      return;

    setIsUpdatingOrder(true);
    try {
      if (item.variant_id) {
        const { data: vData } = await supabase
          .from('product_variants')
          .select('stock')
          .eq('id', item.variant_id)
          .single();
        if (vData) {
          await supabase
            .from('product_variants')
            .update({ stock: vData.stock + item.quantity })
            .eq('id', item.variant_id);
        }
      }

      await supabase.from('order_items').delete().eq('id', item.id);

      const remainingItems = (editingOrder.items || []).filter((i) => i.id !== item.id);

      if (remainingItems.length === 0) {
        await supabase.from('orders').delete().eq('id', editingOrder.id);
        setEditingOrder(null);
      } else {
        const newTotal = remainingItems.reduce(
          (acc, cur) => acc + Number(cur.unit_price) * cur.quantity,
          0
        );
        await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('id', editingOrder.id);
      }

      await fetchData();
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  const handleAddItemToOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder || !addingVariantToOrder || addingQtyToOrder <= 0) return;

    setIsUpdatingOrder(true);
    try {
      let selectedVar: Variant | undefined;
      for (const p of products) {
        const found = p.product_variants.find((v) => v.id === addingVariantToOrder);
        if (found) {
          selectedVar = found;
          break;
        }
      }
      if (!selectedVar) return;

      const existingItem = (editingOrder.items || []).find(
        (i) => i.variant_id === selectedVar!.id
      );

      if (existingItem) {
        await supabase
          .from('order_items')
          .update({ quantity: existingItem.quantity + addingQtyToOrder })
          .eq('id', existingItem.id);
      } else {
        await supabase.from('order_items').insert([
          {
            order_id: editingOrder.id,
            variant_id: selectedVar.id,
            quantity: addingQtyToOrder,
            unit_price: selectedVar.price,
          },
        ]);
      }

      const { data: vData } = await supabase
        .from('product_variants')
        .select('stock')
        .eq('id', selectedVar.id)
        .single();
      if (vData) {
        await supabase
          .from('product_variants')
          .update({ stock: vData.stock - addingQtyToOrder })
          .eq('id', selectedVar.id);
      }

      const extraCost = Number(selectedVar.price) * addingQtyToOrder;
      const newTotal = Number(editingOrder.total_amount) + extraCost;
      await supabase
        .from('orders')
        .update({ total_amount: newTotal })
        .eq('id', editingOrder.id);

      setAddingVariantToOrder('');
      setAddingQtyToOrder(1);
      await fetchData();
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  // Filtrado y Ordenación de Pedidos
  const sortedAndFilteredOrders = [...(orders || [])]
    .filter((ord) => {
      if (!orderSearchTerm.trim()) return true;
      const q = orderSearchTerm.toLowerCase();
      return (
        ord.buyer_name.toLowerCase().includes(q) ||
        ord.scout_unit.toLowerCase().includes(q) ||
        ord.status.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // 1. Los "Entregados" siempre van al fondo independientemente del orden elegido
      const aDelivered = a.status === 'Entregado' ? 1 : 0;
      const bDelivered = b.status === 'Entregado' ? 1 : 0;
      if (aDelivered !== bDelivered) return aDelivered - bDelivered;

      // 2. Aplicamos la ordenación del desplegable
      if (sortConfig === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortConfig === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortConfig === 'amount_desc') {
        return Number(b.total_amount) - Number(a.total_amount);
      }
      if (sortConfig === 'amount_asc') {
        return Number(a.total_amount) - Number(b.total_amount);
      }
      return 0;
    });

  return (
    <div>
      {/* BARRA SUPERIOR DE PEDIDOS: BUSCADOR Y ACCIONES MASIVAS */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
        
        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3 flex-1">
          <input
            type="text"
            placeholder="🔍 Buscar por nombre, rama o estado..."
            value={orderSearchTerm}
            onChange={(e) => setOrderSearchTerm(e.target.value)}
            className="w-full sm:w-72 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-purple-600"
          />
          <select
            value={sortConfig}
            onChange={(e) => setSortConfig(e.target.value as any)}
            className="w-full sm:w-auto px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-purple-600 text-slate-600"
          >
            <option value="newest">🗓️ Más recientes primero</option>
            <option value="oldest">🗓️ Más antiguos primero</option>
            <option value="amount_desc">💰 Mayor importe</option>
            <option value="amount_asc">💰 Menor importe</option>
          </select>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end flex-wrap">
          <button
            onClick={handleExportToCSV}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3.5 py-2.5 rounded-xl font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <span>📥</span> Exportar a Excel (CSV)
          </button>

          {selectedOrders.length > 0 && (
            <button
              onClick={() => handleDeleteOrders(selectedOrders)}
              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3.5 py-2.5 rounded-xl font-bold shadow-xs transition-colors flex items-center gap-1.5"
            >
              <span>🗑️</span> Borrar seleccionados ({selectedOrders.length})
            </button>
          )}

          {orders.length > 0 && (
            <button
              onClick={handleDeleteAllOrders}
              className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors"
            >
              ⚠️ Borrar historial
            </button>
          )}
        </div>
      </div>

      {/* TABLA DE PEDIDOS */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/30">
              <th className="p-4 w-10 text-center">
                <input
                  type="checkbox"
                  checked={orders.length > 0 && selectedOrders.length === orders.length}
                  onChange={toggleSelectAllOrders}
                  className="rounded border-slate-300 cursor-pointer"
                />
              </th>
              <th className="p-4">Comprador y Artículos</th>
              <th className="p-4">Rama</th>
              <th className="p-4">Fecha y Caducidad</th>
              <th className="p-4">Total</th>
              <th className="p-4">Estado</th>
              <th className="p-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {sortedAndFilteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-400">
                  No hay pedidos que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              sortedAndFilteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className={`group transition-colors ${
                    order.status === 'Entregado'
                      ? 'bg-slate-50/60 opacity-60 hover:opacity-100'
                      : 'hover:bg-slate-50/80'
                  }`}
                >
                  <td className="p-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      onChange={() => toggleOrderSelection(order.id)}
                      className="rounded border-slate-300 cursor-pointer"
                    />
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-900 text-sm">{order.buyer_name}</div>
                    {order.email && (
                      <div className="text-[11px] text-slate-400">{order.email}</div>
                    )}
                    <div className="mt-2 space-y-1">
                      {order.items && order.items.length > 0 ? (
                        order.items.map((item) => (
                          <div
                            key={item.id}
                            className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-medium mr-1.5 mb-1"
                          >
                            <span className="font-bold text-purple-700">{item.quantity}x</span>
                            <span>{item.product_name}</span>
                            <span className="text-slate-400 font-bold">
                              (Talla {item.size})
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-[11px] italic text-slate-400">
                          🚫 Sin artículos en la base de datos
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                      {order.scout_unit}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500 whitespace-nowrap">
                    <div>
                      {new Date(order.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {getExpirationBadge(order)}
                    {order.status === 'Pendiente' && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => handleExtendExpiration(order, 'add7')}
                          className="text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100/70 hover:bg-amber-200/70 px-2 py-0.5 rounded transition-colors"
                          title="Sumar 7 días extra de plazo"
                        >
                          ➕ Ampliar +7d
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="p-4 font-extrabold text-slate-900 text-sm whitespace-nowrap">
                    {Number(order.total_amount).toFixed(2)} €
                  </td>
                  <td className="p-4">
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order.id, e.target.value)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl border cursor-pointer outline-none transition-colors ${
                        order.status === 'Pendiente'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : order.status === 'Reservado'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : order.status === 'Pagado'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      <option value="Pendiente">⏳ Pendiente</option>
                      <option value="Reservado">🛡️ Reservado (Protegido)</option>
                      <option value="Pagado">💸 Pagado</option>
                      <option value="Entregado">✅ Entregado</option>
                    </select>
                  </td>
                  <td className="p-4 text-center whitespace-nowrap">
                    <button
                      onClick={() => setEditingOrder(order)}
                      className="text-slate-500 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 px-2.5 py-1.5 rounded-lg transition-colors mr-2 text-xs font-bold"
                      title="Editar prendas o ampliar caducidad"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => handleDeleteOrders([order.id])}
                      className="text-slate-400 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors text-sm"
                      title="Eliminar pedido completo"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL DE EDICIÓN DE PEDIDO */}
      {editingOrder && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  ✏️ Editar Pedido de {editingOrder.buyer_name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Total actual:{' '}
                  <strong className="text-purple-700">
                    {Number(editingOrder.total_amount).toFixed(2)} €
                  </strong>
                </p>
              </div>
              <button
                onClick={() => setEditingOrder(null)}
                className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-700 font-bold flex items-center justify-center"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs max-h-[80vh] overflow-y-auto overflow-x-hidden">
              {/* 1. PRENDAS ACTUALES */}
              <div>
                <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2.5">
                  Prendas en este pedido
                </h4>
                {editingOrder.items && editingOrder.items.length > 0 ? (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {editingOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 bg-white flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 truncate">
                            {item.product_name}{' '}
                            <span className="text-purple-700">(Talla {item.size})</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {Number(item.unit_price).toFixed(2)} € / ud. • Subtotal:{' '}
                            {(Number(item.unit_price) * item.quantity).toFixed(2)} €
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            disabled={isUpdatingOrder}
                            onClick={() => handleChangeOrderItemQty(item, -1)}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
                          >
                            -
                          </button>
                          <span className="font-extrabold text-sm px-1.5">
                            {item.quantity}
                          </span>
                          <button
                            disabled={isUpdatingOrder}
                            onClick={() => handleChangeOrderItemQty(item, 1)}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700"
                          >
                            +
                          </button>
                          <button
                            disabled={isUpdatingOrder}
                            onClick={() => handleRemoveItemFromOrder(item)}
                            className="ml-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold px-2.5 py-1.5 rounded-lg text-[11px]"
                          >
                            🗑️ Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic">Sin prendas.</p>
                )}
              </div>

              {/* 2. AÑADIR OTRA PRENDA */}
              <form
                onSubmit={handleAddItemToOrder}
                className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3"
              >
                <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  ➕ Añadir otra prenda al pedido
                </h4>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                  <select
                    required
                    value={addingVariantToOrder}
                    onChange={(e) => setAddingVariantToOrder(e.target.value)}
                    className="flex-1 min-w-0 p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-purple-600 truncate"
                  >
                    <option value="">Selecciona prenda y talla...</option>
                    {products.map((p) =>
                      p.product_variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {p.name} — Talla {v.size} ({Number(v.price).toFixed(2)} € | Stock: {v.stock})
                        </option>
                      ))
                    )}
                  </select>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={1}
                      required
                      value={addingQtyToOrder}
                      onChange={(e) =>
                        setAddingQtyToOrder(Math.max(1, parseInt(e.target.value, 10) || 1))
                      }
                      className="w-16 p-2.5 bg-white border border-slate-200 rounded-xl text-center font-bold"
                    />
                    <button
                      type="submit"
                      disabled={isUpdatingOrder || !addingVariantToOrder}
                      className="bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl shrink-0 transition-colors"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              </form>

              {/* 3. GESTIÓN DEL PLAZO DE CADUCIDAD */}
              <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200/80 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h4 className="font-bold text-amber-900 uppercase tracking-wider text-[11px]">
                    ⏳ Gestión del Plazo de Caducidad
                  </h4>
                  <span className="text-[11px] font-semibold text-amber-800">
                    {editingOrder.status === 'Reservado' || !editingOrder.expires_at
                      ? '🛡️ Actualmente Protegido (No caduca)'
                      : `Caduca el: ${new Date(editingOrder.expires_at).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isUpdatingOrder}
                    onClick={() => handleExtendExpiration(editingOrder, 'add7')}
                    className="bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-3 py-2 rounded-xl text-[11px] transition-colors shadow-2xs"
                  >
                    +7 días extra
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingOrder}
                    onClick={() => handleExtendExpiration(editingOrder, 'add15')}
                    className="bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-3 py-2 rounded-xl text-[11px] transition-colors shadow-2xs"
                  >
                    +15 días extra
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingOrder}
                    onClick={() => handleExtendExpiration(editingOrder, 'reset15')}
                    className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold px-3 py-2 rounded-xl text-[11px] transition-colors shadow-2xs"
                  >
                    🔄 Reiniciar (15d desde hoy)
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingOrder}
                    onClick={() => handleExtendExpiration(editingOrder, 'protect')}
                    className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-3 py-2 rounded-xl text-[11px] transition-colors shadow-2xs"
                  >
                    🛡️ Proteger sin límite
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-2.5 rounded-xl"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}