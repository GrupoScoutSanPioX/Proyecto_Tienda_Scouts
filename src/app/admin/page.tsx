'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Link from 'next/link';

interface Variant {
  id: string;
  size: string;
  price: number;
  stock: number;
  product_id?: string;
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
  variant_id: string;
  quantity: number;
  product_name?: string;
  size?: string;
}

interface Order {
  id: string;
  buyer_name: string;
  scout_unit: string;
  total_amount: number;
  status: string;
  created_at: string;
  expires_at?: string;
  email?: string;
  order_items?: OrderItem[];
}

// Orden lógico de tallas para que no salgan desordenadas
const SIZE_ORDER = [
  'Única', 'Unitalla', 
  '3/4', '4', '5/6', '6', '7/8', '8', '9/10', '10', '11/12', '12', '13/14', '14', '16',
  'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'
];

export default function AdminPage() {
  const [cajaInicial, setCajaInicial] = useState<number>(0);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'orders' | 'inventory'>('orders');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('new');
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    category: '',
    min_stock_alert: 5,
    size: 'M',
    price: 15,
    stock: 10
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [productSearchInput, setProductSearchInput] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [editingItem, setEditingItem] = useState<{
    productId: string;
    variantId: string;
    name: string;
    category: string;
    description: string;
    image_url: string;
    min_stock_alert: number;
    size: string;
    price: number;
  } | null>(null);

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);

  const totalCobrado = orders
    .filter((o) => o.status === 'Pagado' || o.status === 'Entregado')
    .reduce((sum, order) => sum + Number(order.total_amount), 0);

  const cajaTotal = cajaInicial + totalCobrado;

  // NUEVO: Cálculo del dinero esperado de pedidos pendientes y reservados
  const dineroEsperado = orders
    .filter((o) => o.status === 'Pendiente' || o.status === 'Reservado')
    .reduce((sum, order) => sum + Number(order.total_amount), 0);

  const predefinedCategories = Array.from(
    new Set(['Ropa', 'Insignias', 'Libros', 'Material', 'Otros', ...products.map((p) => p.category)])
  );

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn]);

  async function fetchData() {
    setLoading(true);
    try {
      // Auto-limpieza silenciosa y envío de recordatorios al abrir el panel
      try {
        await fetch('/api/cron');
      } catch (e) {
        console.log('El robot de limpieza no respondió', e);
      }

      let caja = 0;
      let productosPlano: any[] = [];
      let variantesPlano: any[] = [];
      let itemsPlano: any[] = [];
      let pedidosPlano: any[] = [];

      const { data: configData } = await supabase
        .from('configuracion')
        .select('caja_inicial')
        .eq('id', 1)
        .maybeSingle();

      if (configData) caja = configData.caja_inicial || 0;
      setCajaInicial(caja);

      const { data: pData } = await supabase.from('products').select('*').order('name');
      if (pData) productosPlano = pData;

      const { data: vData } = await supabase.from('product_variants').select('*');
      if (vData) variantesPlano = vData;

      const { data: iData } = await supabase.from('order_items').select('*');
      if (iData) itemsPlano = iData;

      const { data: oData } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (oData) pedidosPlano = oData;

      const inventarioCompleto = productosPlano.map((p) => {
        const variantes = variantesPlano
          .filter((v) => String(v.product_id) === String(p.id))
          .sort((a, b) => {
            const idxA = SIZE_ORDER.indexOf(a.size);
            const idxB = SIZE_ORDER.indexOf(b.size);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.size.localeCompare(b.size);
          });
        return {
          ...p,
          product_variants: variantes
        };
      });
      setProducts(inventarioCompleto.filter((p) => p.product_variants.length > 0) as Product[]);

      const pedidosCompletos = pedidosPlano.map((pedido) => {
        const articulosDelPedido = itemsPlano.filter(
          (item) =>
            String(item.order_id) === String(pedido.id) ||
            String(item.pedido_id) === String(pedido.id) ||
            String(item.id_pedido) === String(pedido.id)
        );

        const order_items = articulosDelPedido.map((item) => {
          const idVarianteBuscada = item.variant_id || item.variante_id || item.product_id;
          const variante = variantesPlano.find((v) => String(v.id) === String(idVarianteBuscada));
          const productoReal = variante
            ? productosPlano.find((p) => String(p.id) === String(variante.product_id))
            : null;

          return {
            variant_id: idVarianteBuscada,
            quantity: item.quantity || item.cantidad || 1,
            product_name: productoReal ? productoReal.name : 'Artículo no encontrado',
            size: variante ? variante.size : '-'
          };
        });
        return { ...pedido, order_items };
      });

      // Ordenación inteligente: los Entregados se hunden al fondo
      const pedidosOrdenados = pedidosCompletos.sort((a, b) => {
        if (a.status === 'Entregado' && b.status !== 'Entregado') return 1;
        if (a.status !== 'Entregado' && b.status === 'Entregado') return -1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setOrders(pedidosOrdenados as Order[]);
    } catch (e) {
      console.error('Error crítico cargando base de datos:', e);
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
        body: JSON.stringify({ password: passwordInput, name: adminName })
      });
      const data = await res.json();
      if (res.ok && data.success && adminName.trim() !== '') {
        const fechaActual = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
        await supabase
          .from('admin_logs')
          .insert([{ admin_name: adminName, created_at: fechaActual }]);
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
      `Base actual (sin contar ventas): ${cajaInicial.toFixed(
        2
      )} €\n\n¿Cuánto dinero quieres fijar como base o ajuste inicial?\n(Usa un punto para los céntimos, ej: 50.50)`
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
      `Dinero Total en la caja ahora mismo: ${cajaTotal.toFixed(
        2
      )} €\n\n¿Cuánto dinero vas a SACAR para comprar material (tiendas, pintura, etc)?\n(Usa un punto para céntimos, ej: 45.50)`
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

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  };

  const handleExtendOrder = async (
    orderId: string,
    currentCreatedAt: string,
    currentExpiresAt?: string
  ) => {
    const input = window.prompt(
      '¿Cuántos días EXTRA quieres darle de margen a esta persona?\n(Por ejemplo: 7)'
    );
    if (!input) return;
    const days = parseInt(input, 10);
    if (isNaN(days) || days <= 0) return;

    const baseDate = currentExpiresAt
      ? new Date(currentExpiresAt)
      : new Date(new Date(currentCreatedAt).getTime() + 15 * 24 * 60 * 60 * 1000);
    baseDate.setDate(baseDate.getDate() + days);
    const newExpiresAt = baseDate.toISOString();

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, expires_at: newExpiresAt } : o))
    );
    // También reseteamos aviso_enviado a false por si ya le había avisado antes de ampliarle el plazo
    await supabase
      .from('orders')
      .update({ expires_at: newExpiresAt, aviso_enviado: false })
      .eq('id', orderId);
    alert(`¡Plazo ampliado! Ahora caduca el ${baseDate.toLocaleDateString()}`);
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
          ? '¿Seguro que quieres eliminar este pedido?'
          : `¿Seguro que quieres eliminar estos ${orderIds.length} pedidos?`
      )
    )
      return;
    const { error } = await supabase.from('orders').delete().in('id', orderIds);
    if (!error) {
      setSelectedOrders([]);
      fetchData();
    }
  };

  const handleDeleteAllOrders = async () => {
    const confirmation = window.prompt(
      "⚠️ ATENCIÓN: Vas a borrar todo el historial de pedidos. ¿Estás seguro de ello?\n\nEscribe la palabra 'BORRAR' en mayúsculas para confirmar:"
    );
    if (confirmation === 'BORRAR') {
      const allIds = orders.map((o) => o.id);
      if (allIds.length === 0) return;
      const { error } = await supabase.from('orders').delete().in('id', allIds);
      if (!error) {
        setSelectedOrders([]);
        fetchData();
        alert('¡Historial limpiado con éxito!');
      }
    }
  };

  const handleStockChange = async (variantId: string, currentStock: number, increment: number) => {
    const newStock = currentStock + increment;
    if (newStock === currentStock) return;
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        product_variants: p.product_variants.map((v) =>
          v.id === variantId ? { ...v, stock: newStock } : v
        )
      }))
    );
    await supabase.from('product_variants').update({ stock: newStock }).eq('id', variantId);
  };

  const handleBulkChange = async (
    variantId: string,
    currentStock: number,
    type: 'add' | 'subtract'
  ) => {
    const actionText = type === 'add' ? 'PONER' : 'QUITAR';
    const input = window.prompt(
      `Stock actual: ${currentStock} uds.\n\n¿Cuántas unidades quieres ${actionText} de golpe?\n(Pon solo el número de unidades, ej: 5)`
    );
    if (!input || input.trim() === '') return;
    const amount = parseInt(input, 10);
    if (isNaN(amount) || amount <= 0) return;
    const increment = type === 'add' ? amount : -amount;
    const newStock = currentStock + increment;
    if (newStock === currentStock) return;
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        product_variants: p.product_variants.map((v) =>
          v.id === variantId ? { ...v, stock: newStock } : v
        )
      }))
    );
    await supabase.from('product_variants').update({ stock: newStock }).eq('id', variantId);
  };

  const handleDeleteVariant = async (variantId: string, productId: string, sizeName: string) => {
    if (!window.confirm(`¿Seguro que quieres eliminar la talla "${sizeName}" de este producto?`)) return;
    const { error } = await supabase.from('product_variants').delete().eq('id', variantId);
    if (error) {
      alert('⚠ No puedes borrar esta talla porque hay pedidos asociados. Pon su stock a 0.');
    } else {
      const productoAfectado = products.find((p) => p.id === productId);
      if (productoAfectado && productoAfectado.product_variants.length === 1) {
        await supabase.from('products').delete().eq('id', productId);
      }
      fetchData();
    }
  };

  const handleAddNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUploading(true);
    let finalImageUrl = '';

    if (imageFile && selectedProductId === 'new') {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('productos')
        .upload(fileName, imageFile);
      if (uploadError) {
        alert('Error subiendo la foto: ' + uploadError.message);
        setIsUploading(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('productos').getPublicUrl(fileName);
      finalImageUrl = publicUrlData.publicUrl;
    }

    setLoading(true);
    let productIdToUse = selectedProductId;

    const minStockToSave = Number.isNaN(newProduct.min_stock_alert) ? 5 : newProduct.min_stock_alert;
    const priceToSave = Number.isNaN(newProduct.price) ? 0 : newProduct.price;
    const stockToSave = Number.isNaN(newProduct.stock) ? 0 : newProduct.stock;

    if (selectedProductId === 'new') {
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .insert([
          {
            name: newProduct.name,
            category: newProduct.category,
            description: newProduct.description,
            image_url: finalImageUrl,
            min_stock_alert: minStockToSave
          }
        ])
        .select('id')
        .single();
      if (prodErr || !prodData) {
        alert('Error al crear el producto.');
        setLoading(false);
        setIsUploading(false);
        return;
      }
      productIdToUse = prodData.id;
    } else {
      await supabase
        .from('products')
        .update({ min_stock_alert: minStockToSave })
        .eq('id', productIdToUse);
      // Sincronizamos el precio con el resto de tallas del mismo producto por si lo ha cambiado
      await supabase
        .from('product_variants')
        .update({ price: priceToSave })
        .eq('product_id', productIdToUse);
    }

    const { error: varErr } = await supabase.from('product_variants').insert([
      {
        product_id: productIdToUse,
        size: newProduct.size,
        price: priceToSave,
        stock: stockToSave
      }
    ]);

    if (varErr) {
      alert('Error al añadir la talla.');
    } else {
      alert('¡Artículo añadido con éxito!');
      setShowAddForm(false);
      setNewProduct({
        name: '',
        description: '',
        category: '',
        min_stock_alert: 5,
        size: 'M',
        price: 15,
        stock: 10
      });
      setImageFile(null);
      setSelectedProductId('new');
      setProductSearchInput('');
      fetchData();
    }
    setIsUploading(false);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setIsUploading(true);
    let finalImageUrl = editingItem.image_url;

    if (editImageFile) {
      const fileExt = editImageFile.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('productos')
        .upload(fileName, editImageFile);
      if (uploadError) {
        alert('Error subiendo la nueva foto: ' + uploadError.message);
        setIsUploading(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('productos').getPublicUrl(fileName);
      finalImageUrl = publicUrlData.publicUrl;
    }

    const minStockToSave = Number.isNaN(editingItem.min_stock_alert) ? 5 : editingItem.min_stock_alert;
    const priceToSave = Number.isNaN(editingItem.price) ? 0 : editingItem.price;

    // 1. Actualizamos los datos generales del producto
    await supabase
      .from('products')
      .update({
        name: editingItem.name,
        category: editingItem.category,
        description: editingItem.description,
        image_url: finalImageUrl,
        min_stock_alert: minStockToSave
      })
      .eq('id', editingItem.productId);

    // 2. Actualizamos el precio en TODAS las tallas de ese producto para que siempre valgan lo mismo
    await supabase
      .from('product_variants')
      .update({ price: priceToSave })
      .eq('product_id', editingItem.productId);

    // 3. Si se editó el nombre de una talla concreta, lo guardamos
    if (editingItem.variantId) {
      await supabase
        .from('product_variants')
        .update({ size: editingItem.size })
        .eq('id', editingItem.variantId);
    }

    setEditingItem(null);
    setEditImageFile(null);
    setIsUploading(false);
    fetchData();
  };

  const handleSelectProduct = (
    id: string,
    name: string,
    category: string,
    minStock: number,
    existingPrice?: number
  ) => {
    setSelectedProductId(id);
    setIsDropdownOpen(false);
    if (id === 'new') {
      setProductSearchInput('');
    } else {
      setProductSearchInput(`${name} (${category})`);
      setNewProduct((prev) => ({
        ...prev,
        min_stock_alert: minStock,
        price: existingPrice !== undefined ? existingPrice : prev.price
      }));
    }
  };

  const filteredProducts = products.filter((product) => {
    const matchName = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = product.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchSize = product.product_variants.some((v) =>
      v.size.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return matchName || matchCategory || matchSize;
  });

  const filteredProductsForSelect = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearchInput.toLowerCase()) ||
      p.category.toLowerCase().includes(productSearchInput.toLowerCase())
  );

  const getDaysLeft = (created: string, expires?: string) => {
    const limitDate = expires
      ? new Date(expires)
      : new Date(new Date(created).getTime() + 15 * 24 * 60 * 60 * 1000);
    const now = new Date();
    return Math.ceil((limitDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

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
                  loginError
                    ? 'border-red-500 bg-red-50'
                    : 'border-slate-200 focus:border-purple-600'
                }`}
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl mt-2 transition-transform active:scale-95 shadow-md"
            >
              Entrar al Sistema
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="w-full h-1.5 bg-gradient-to-r from-green-600 via-purple-600 to-slate-300"></div>

      <div className="max-w-[1400px] mx-auto p-6 md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-200/70">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-purple-700 bg-purple-50 px-3 py-1 rounded-full">
              Gestión Interna
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
              Panel de Administración
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Responsable conectado:{' '}
              <strong className="text-purple-700 font-bold">{adminName}</strong>
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Link
              href="/"
              className="flex-1 sm:flex-none text-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors"
            >
              Ver Tienda Pública ↗
            </Link>
            <button
              onClick={() => {
                setIsLoggedIn(false);
                setAdminName('');
                setPasswordInput('');
              }}
              className="flex-1 sm:flex-none text-center bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setActiveTab('orders')}
            className={`font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-xs flex items-center gap-2 ${
              activeTab === 'orders'
                ? 'bg-purple-700 text-white shadow-purple-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>📋</span> Registro de Pedidos ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-xs flex items-center gap-2 ${
              activeTab === 'inventory'
                ? 'bg-purple-700 text-white shadow-purple-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>📦</span> Control de Inventario ({products.length})
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/70 overflow-hidden">
          {loading && !isUploading ? (
            <div className="p-16 text-center text-slate-400 font-semibold text-sm">
              Cargando información del sistema...
            </div>
          ) : (
            <>
              {activeTab === 'orders' && (
                <div>
                  <div className="p-5 border-b border-slate-100 bg-slate-50 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full xl:w-auto">
                      {/* WIDGET 1: DINERO EN CAJA */}
                      <div className="bg-white border border-emerald-200 px-4 py-3 rounded-xl shadow-sm flex items-center gap-4 flex-1 sm:flex-initial">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-lg shrink-0">
                          💶
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Dinero Total en Caja
                          </p>
                          <p className="text-xl font-black text-emerald-600 leading-none mt-0.5">
                            {cajaTotal.toFixed(2)} €
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <p className="text-[10px] font-semibold text-slate-400">
                              Fondo ({cajaInicial.toFixed(2)}€) + Ventas ({totalCobrado.toFixed(2)}€)
                            </p>
                            <button
                              onClick={handleEditCaja}
                              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold transition-colors"
                            >
                              ✏️ Ajustar fondo
                            </button>
                            <button
                              onClick={handleRestarCaja}
                              className="bg-red-50 hover:bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold transition-colors"
                            >
                              ➖ Extraer dinero
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* WIDGET 2: DINERO ESPERADO (NUEVO) */}
                      <div className="bg-white border border-amber-200 px-4 py-3 rounded-xl shadow-sm flex items-center gap-4 flex-1 sm:flex-initial">
                        <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center text-lg shrink-0">
                          ⏳
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                            Dinero Esperado
                          </p>
                          <p className="text-xl font-black text-amber-600 leading-none mt-0.5">
                            {dineroEsperado.toFixed(2)} €
                          </p>
                          <p className="text-[10px] font-semibold text-amber-700/70 mt-1">
                            De pedidos pendientes y reservados
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:w-auto">
                      {selectedOrders.length > 0 && (
                        <button
                          onClick={() => handleDeleteOrders(selectedOrders)}
                          className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white text-xs px-4 py-2.5 rounded-xl font-bold shadow-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span>🗑️</span> Borrar seleccionados ({selectedOrders.length})
                        </button>
                      )}
                      {orders.length > 0 && (
                        <button
                          onClick={handleDeleteAllOrders}
                          className="w-full sm:w-auto bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors"
                        >
                          ⚠️ Borrar todo el historial
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="p-4 w-10 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 cursor-pointer accent-purple-600"
                              checked={
                                orders.length > 0 && selectedOrders.length === orders.length
                              }
                              onChange={toggleSelectAllOrders}
                            />
                          </th>
                          <th className="p-4 font-bold">Fecha</th>
                          <th className="p-4 font-bold">Comprador y Artículos</th>
                          <th className="p-4 font-bold text-right">Total</th>
                          <th className="p-4 font-bold text-center">Caducidad</th>
                          <th className="p-4 font-bold text-center">Estado del Pago</th>
                          <th className="p-4"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {orders.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-12 text-center text-slate-400 font-medium">
                              No hay pedidos registrados.
                            </td>
                          </tr>
                        ) : (
                          orders.map((order) => {
                            const daysLeft = getDaysLeft(order.created_at, order.expires_at);
                            const isPending =
                              order.status === 'Pendiente' || order.status === 'Reservado';

                            return (
                              <tr
                                key={order.id}
                                className={`hover:bg-slate-50/60 transition-colors group ${
                                  selectedOrders.includes(order.id) ? 'bg-purple-50/30' : ''
                                } ${order.status === 'Entregado' ? 'opacity-60 bg-slate-50/40' : ''}`}
                              >
                                <td className="p-4 text-center align-top pt-5">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 cursor-pointer accent-purple-600"
                                    checked={selectedOrders.includes(order.id)}
                                    onChange={() => toggleOrderSelection(order.id)}
                                  />
                                </td>
                                <td className="p-4 text-slate-500 font-medium align-top pt-5">
                                  {new Date(order.created_at).toLocaleDateString()}
                                </td>
                                <td className="p-4 align-top pt-5">
                                  <div className="font-bold text-slate-900 text-sm mb-1">
                                    {order.buyer_name}{' '}
                                    <span className="text-xs text-slate-500 font-medium ml-2 bg-slate-100 px-2 py-0.5 rounded">
                                      {order.scout_unit || 'General'}
                                    </span>
                                  </div>
                                  {order.email && (
                                    <p className="text-[11px] text-slate-400 mb-1.5">
                                      ✉️ {order.email}
                                    </p>
                                  )}
                                  {order.order_items && order.order_items.length > 0 ? (
                                    <ul className="space-y-1.5 mt-2">
                                      {order.order_items.map((item, idx) => (
                                        <li
                                          key={idx}
                                          className="text-[11px] text-slate-600 font-medium bg-slate-100/70 px-2.5 py-1.5 rounded-lg border border-slate-200/50 inline-block w-full"
                                        >
                                          <span className="text-purple-700 font-black">
                                            {item.quantity}x
                                          </span>{' '}
                                          {item.product_name}{' '}
                                          <span className="text-slate-400 font-bold ml-1">
                                            (Talla: {item.size})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-slate-400 text-[10px] font-bold bg-slate-100 px-2 py-1 rounded">
                                      🚫 Sin artículos
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 font-extrabold text-right text-slate-900 text-sm align-top pt-5">
                                  {Number(order.total_amount).toFixed(2)} €
                                </td>

                                <td className="p-4 text-center align-top pt-4">
                                  {order.status === 'Reservado' && !order.expires_at ? (
                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 inline-block">
                                      📦 Bajo pedido
                                    </span>
                                  ) : isPending ? (
                                    <div className="flex flex-col items-center gap-1.5">
                                      <span
                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                                          daysLeft < 0
                                            ? 'bg-red-100 text-red-700'
                                            : daysLeft <= 3
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-slate-100 text-slate-600'
                                        }`}
                                      >
                                        {daysLeft < 0 ? '¡Caducado!' : `Quedan ${daysLeft} días`}
                                      </span>
                                      <button
                                        onClick={() =>
                                          handleExtendOrder(
                                            order.id,
                                            order.created_at,
                                            order.expires_at
                                          )
                                        }
                                        className="text-[10px] text-purple-600 hover:text-purple-800 font-bold flex items-center gap-1 transition-colors"
                                      >
                                        <span>📅</span> Ampliar
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300 font-bold">-</span>
                                  )}
                                </td>

                                <td className="p-4 text-center align-top pt-4">
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
                                    <option value="Reservado">🛡️ Reservado</option>
                                    <option value="Pagado">💸 Pagado</option>
                                    <option value="Entregado">✅ Entregado</option>
                                  </select>
                                </td>
                                <td className="p-4 text-center w-10 align-top pt-5">
                                  <button
                                    onClick={() => handleDeleteOrders([order.id])}
                                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-all text-sm"
                                    title="Eliminar pedido"
                                  >
                                    🗑️
                                  </button>
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

              {activeTab === 'inventory' && (
                <div>
                  <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="relative w-full sm:w-72">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
                      <input
                        type="text"
                        placeholder="Filtrar por nombre, talla..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-purple-600 transition-colors font-medium"
                      />
                    </div>
                    <button
                      onClick={() => setShowAddForm(!showAddForm)}
                      className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-xs"
                    >
                      {showAddForm ? '❌ Cancelar' : '➕ Añadir Artículo / Talla'}
                    </button>
                  </div>

                  {showAddForm && (
                    <form
                      onSubmit={handleAddNewProduct}
                      className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col gap-4"
                    >
                      <div className="relative">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                          ¿A qué producto pertenece?
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
                          <input
                            type="text"
                            placeholder="Escribe para buscar un producto o elige uno..."
                            value={productSearchInput}
                            onChange={(e) => {
                              setProductSearchInput(e.target.value);
                              setIsDropdownOpen(true);
                              setSelectedProductId('new');
                            }}
                            onFocus={() => setIsDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.preventDefault();
                            }}
                            className="w-full pl-9 pr-8 py-3 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-purple-600 transition-colors font-medium cursor-text shadow-xs"
                          />
                          <span className="absolute right-4 top-3 text-slate-400 text-xs pointer-events-none">
                            ▼
                          </span>
                        </div>
                        {isDropdownOpen && (
                          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto py-1">
                            <div
                              className="px-4 py-3 hover:bg-purple-50 cursor-pointer text-xs font-bold text-purple-700 flex items-center gap-2"
                              onClick={() => handleSelectProduct('new', '', '', 5, 15)}
                            >
                              <span>✨</span> Crear producto completamente nuevo...
                            </div>
                            {filteredProductsForSelect.map((p) => {
                              const currentPrice = p.product_variants[0]?.price ?? 15;
                              return (
                                <div
                                  key={p.id}
                                  className="px-4 py-2.5 hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-700 border-t border-slate-50 flex items-center justify-between"
                                  onClick={() =>
                                    handleSelectProduct(
                                      p.id,
                                      p.name,
                                      p.category,
                                      p.min_stock_alert ?? 5,
                                      currentPrice
                                    )
                                  }
                                >
                                  <span>
                                    {p.name}{' '}
                                    <span className="text-slate-400 ml-1">
                                      ({p.category} - {currentPrice.toFixed(2)}€)
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                            {filteredProductsForSelect.length === 0 && (
                              <div className="px-4 py-3 text-xs text-slate-400 text-center border-t border-slate-50">
                                No hay productos que coincidan.
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {selectedProductId === 'new' ? (
                        <>
                          <div className="flex flex-col sm:flex-row gap-4 mt-2">
                            <div className="flex-1">
                              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                                Nombre del Nuevo Producto
                              </label>
                              <input
                                type="text"
                                required
                                value={newProduct.name}
                                onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                                Categoría
                              </label>
                              <input
                                list="category-options"
                                type="text"
                                required
                                placeholder="Selecciona o escribe una nueva..."
                                value={newProduct.category}
                                onChange={(e) =>
                                  setNewProduct({ ...newProduct, category: e.target.value })
                                }
                                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-purple-600"
                              />
                              <datalist id="category-options">
                                {predefinedCategories.map((cat, idx) => (
                                  <option key={idx} value={cat} />
                                ))}
                              </datalist>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                              Descripción
                            </label>
                            <textarea
                              value={newProduct.description}
                              onChange={(e) =>
                                setNewProduct({ ...newProduct, description: e.target.value })
                              }
                              className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                              rows={2}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                              Subir Foto (Opcional)
                            </label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                              className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 cursor-pointer"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3 mt-2">
                          <span className="text-xl">ℹ️</span>
                          <div>
                            <p className="text-xs text-blue-800 font-bold uppercase tracking-wider mb-1">
                              Añadiendo nueva talla
                            </p>
                            <p className="text-[11px] text-blue-600 font-medium leading-relaxed">
                              Estás añadiendo una nueva talla a un producto existente. El precio se ha autorellenado con el del producto.
                            </p>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1 mt-2 uppercase tracking-wider">
                          Avisar si quedan menos de: (Stock mínimo)
                        </label>
                        <input
                          type="number"
                          required
                          value={Number.isNaN(newProduct.min_stock_alert) ? '' : newProduct.min_stock_alert}
                          onChange={(e) =>
                            setNewProduct({
                              ...newProduct,
                              min_stock_alert: parseInt(e.target.value, 10)
                            })
                          }
                          className="w-full sm:w-1/3 p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end pt-2">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                            Talla / Variante
                          </label>
                          <input
                            type="text"
                            required
                            value={newProduct.size}
                            onChange={(e) => setNewProduct({ ...newProduct, size: e.target.value })}
                            className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                            Precio del Producto (€)
                          </label>
                          <input
                            type="number"
                            step="0.50"
                            required
                            value={Number.isNaN(newProduct.price) ? '' : newProduct.price}
                            onChange={(e) =>
                              setNewProduct({ ...newProduct, price: parseFloat(e.target.value) })
                            }
                            className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                            Stock Inicial
                          </label>
                          <input
                            type="number"
                            required
                            value={Number.isNaN(newProduct.stock) ? '' : newProduct.stock}
                            onChange={(e) =>
                              setNewProduct({ ...newProduct, stock: parseInt(e.target.value, 10) })
                            }
                            className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isUploading}
                        className="bg-purple-700 hover:bg-purple-800 disabled:bg-purple-400 text-white px-5 py-3 rounded-xl font-bold text-xs transition-colors mt-2 shadow-xs flex items-center justify-center gap-2"
                      >
                        {isUploading ? '⏳ Subiendo foto y guardando...' : '💾 Guardar Artículo'}
                      </button>
                    </form>
                  )}

                  {/* NUEVA TABLA AGRUPADA POR PRODUCTO */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="p-4 font-bold">Producto</th>
                          <th className="p-4 font-bold">Categoría</th>
                          <th className="p-4 font-bold text-right">Precio</th>
                          <th className="p-4 font-bold">Tallas y Control de Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredProducts.map((product) => {
                          const minAlert = product.min_stock_alert || 5;
                          const productPrice = product.product_variants[0]?.price || 0;

                          return (
                            <tr
                              key={product.id}
                              className="hover:bg-slate-50/40 transition-colors align-top"
                            >
                              {/* 1. PRODUCTO + BOTÓN EDITAR GENERAL */}
                              <td className="p-4 font-bold text-slate-900">
                                <div className="flex items-center gap-3">
                                  {product.image_url ? (
                                    <img
                                      src={product.image_url}
                                      alt=""
                                      className="w-11 h-11 rounded-xl bg-slate-100 object-cover border border-slate-200/60 shrink-0"
                                    />
                                  ) : (
                                    <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-base shrink-0">
                                      ⛺
                                    </div>
                                  )}
                                  <div>
                                    <div className="text-sm font-black text-slate-900">
                                      {product.name}
                                    </div>
                                    <button
                                      onClick={() =>
                                        setEditingItem({
                                          productId: product.id,
                                          variantId: product.product_variants[0]?.id || '',
                                          name: product.name,
                                          category: product.category,
                                          description: product.description || '',
                                          image_url: product.image_url || '',
                                          min_stock_alert: product.min_stock_alert ?? 5,
                                          size: product.product_variants[0]?.size || '',
                                          price: productPrice
                                        })
                                      }
                                      className="text-[10px] text-purple-600 hover:text-purple-800 font-bold flex items-center gap-1 mt-1 transition-colors"
                                    >
                                      <span>✏️</span> Editar producto / precio
                                    </button>
                                  </div>
                                </div>
                              </td>

                              {/* 2. CATEGORÍA */}
                              <td className="p-4 pt-5">
                                <span className="bg-purple-50 text-purple-700 font-semibold px-2.5 py-1 rounded-md">
                                  {product.category}
                                </span>
                              </td>

                              {/* 3. PRECIO ÚNICO */}
                              <td className="p-4 pt-5 font-black text-right text-slate-800 text-sm whitespace-nowrap">
                                {productPrice.toFixed(2)} €
                              </td>

                              {/* 4. LISTA COMPACTA DE TALLAS */}
                              <td className="p-4">
                                <div className="flex flex-col gap-2">
                                  {product.product_variants.map((variant) => {
                                    const isLowStock = variant.stock <= minAlert;
                                    const isNegative = variant.stock < 0;

                                    return (
                                      <div
                                        key={variant.id}
                                        className="flex items-center justify-between gap-4 bg-white border border-slate-200/80 px-3 py-2 rounded-xl shadow-2xs hover:border-purple-200 transition-colors"
                                      >
                                        {/* Etiqueta de Talla */}
                                        <div className="flex items-center gap-2">
                                          <span className="bg-slate-100 text-slate-800 font-black px-2.5 py-1 rounded-lg min-w-[48px] text-center text-xs">
                                            {variant.size}
                                          </span>
                                          {isNegative ? (
                                            <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                                              📦 Pedir {Math.abs(variant.stock)} a fábrica
                                            </span>
                                          ) : isLowStock ? (
                                            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                              ⚠️ Stock bajo
                                            </span>
                                          ) : null}
                                        </div>

                                        {/* Controles de Stock y Borrado de Talla */}
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            onClick={() =>
                                              handleBulkChange(variant.id, variant.stock, 'subtract')
                                            }
                                            className="bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors"
                                          >
                                            Quitar
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleStockChange(variant.id, variant.stock, -1)
                                            }
                                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-lg font-bold flex items-center justify-center transition-colors"
                                          >
                                            -
                                          </button>
                                          <span
                                            className={`min-w-[28px] text-center text-sm ${
                                              isNegative
                                                ? 'text-purple-700 font-black'
                                                : isLowStock
                                                ? 'text-red-600 font-black'
                                                : 'text-slate-800 font-bold'
                                            }`}
                                          >
                                            {variant.stock}
                                          </span>
                                          <button
                                            onClick={() =>
                                              handleStockChange(variant.id, variant.stock, 1)
                                            }
                                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-7 h-7 rounded-lg font-bold flex items-center justify-center transition-colors"
                                          >
                                            +
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleBulkChange(variant.id, variant.stock, 'add')
                                            }
                                            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors"
                                          >
                                            Poner
                                          </button>

                                          <div className="h-4 w-[1px] bg-slate-200 mx-1"></div>

                                          <button
                                            onClick={() =>
                                              handleDeleteVariant(
                                                variant.id,
                                                product.id,
                                                variant.size
                                              )
                                            }
                                            className="text-slate-300 hover:text-red-600 transition-colors p-1"
                                            title={`Eliminar talla ${variant.size}`}
                                          >
                                            🗑️
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-900 text-base">✏️ Editar Producto</h3>
              <button
                onClick={() => {
                  setEditingItem(null);
                  setEditImageFile(null);
                }}
                className="w-8 h-8 rounded-full bg-slate-200/60 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center transition-colors"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 flex flex-col gap-4 text-xs">
              <div className="flex gap-4">
                <div className="w-2/3">
                  <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                    Nombre
                  </label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-purple-600"
                  />
                </div>
                <div className="w-1/3">
                  <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                    Categoría
                  </label>
                  <input
                    list="category-options-edit"
                    type="text"
                    required
                    placeholder="Selecciona o escribe..."
                    value={editingItem.category}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-purple-600"
                  />
                  <datalist id="category-options-edit">
                    {predefinedCategories.map((cat, idx) => (
                      <option key={idx} value={cat} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                  Descripción
                </label>
                <textarea
                  value={editingItem.description}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-purple-600"
                  rows={2}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                  Cambiar Foto (Opcional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditImageFile(e.target.files?.[0] || null)}
                  className="w-full p-2 border border-slate-200 rounded-xl outline-none focus:border-purple-600 file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 cursor-pointer"
                />
              </div>
              <div className="flex gap-4">
                <div className="w-1/2">
                  <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                    Avisar si stock baja de:
                  </label>
                  <input
                    type="number"
                    required
                    value={
                      Number.isNaN(editingItem.min_stock_alert) ? '' : editingItem.min_stock_alert
                    }
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        min_stock_alert: parseInt(e.target.value, 10)
                      })
                    }
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-purple-600"
                  />
                </div>
                <div className="w-1/2">
                  <label className="block font-bold text-slate-700 mb-1 uppercase tracking-wider">
                    Precio General (€)
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={Number.isNaN(editingItem.price) ? '' : editingItem.price}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, price: parseFloat(e.target.value) })
                    }
                    className="w-full p-2.5 border border-slate-200 rounded-xl outline-none focus:border-purple-600"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(null);
                    setEditImageFile(null);
                  }}
                  className="px-4 py-2 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 font-bold text-white bg-purple-700 hover:bg-purple-800 disabled:bg-purple-400 rounded-xl shadow-xs"
                >
                  {isUploading ? '⏳ Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}