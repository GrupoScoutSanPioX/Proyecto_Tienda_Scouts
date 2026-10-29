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

interface TopProduct {
  name: string;
  totalSold: number;
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
}

export default function InventoryTab({
  products = [], // Paracaídas de seguridad
  setProducts,
  topProducts = [], // Paracaídas de seguridad
  fetchData,
  stockAnalysis = [], // Paracaídas de seguridad
}: {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  topProducts: TopProduct[];
  fetchData: () => Promise<void>;
  stockAnalysis: StockAnalysisItem[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('new');
  const [productSearchInput, setProductSearchInput] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    image_url: '',
    category: 'Ropa',
    min_stock_alert: 5,
    size: 'M',
    price: 15,
    stock: 10,
  });

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

  const filteredProducts = (products || []).filter((product) => {
    const matchName = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = product.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchSize = product.product_variants.some((v) =>
      v.size.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return matchName || matchCategory || matchSize;
  });

  const filteredProductsForSelect = (products || []).filter(
    (p) =>
      p.name.toLowerCase().includes(productSearchInput.toLowerCase()) ||
      p.category.toLowerCase().includes(productSearchInput.toLowerCase())
  );

  const handleSelectExistingProduct = (prodId: string) => {
    setSelectedProductId(prodId);
    if (prodId !== 'new') {
      const found = products.find((p) => p.id === prodId);
      if (found) {
        const defaultPrice =
          found.product_variants.length > 0 ? found.product_variants[0].price : 15;
        setNewProduct((prev) => ({
          ...prev,
          min_stock_alert: found.min_stock_alert ?? 5,
          price: defaultPrice,
        }));
      }
    }
  };

  // Botón Mágico para auto-rellenar el inventario al mínimo sugerido
  const handleAutoRestock = async () => {
    if (
      !window.confirm(
        "¿Seguro que quieres Auto-Rellenar el inventario?\n\nEsto ajustará el stock real de TODAS las prendas para que coincida con el 'Mínimo Sugerido' calculado por la tienda (ideal para principio de ronda cuando recibes el pedido de fábrica)."
      )
    )
      return;

    let updatedCount = 0;
    for (const item of stockAnalysis) {
      if (item.currentStock < item.suggestedMinStock) {
        await supabase
          .from('product_variants')
          .update({ stock: item.suggestedMinStock })
          .eq('id', item.variantId);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      alert(`¡Stock actualizado con éxito! Se han rellenado ${updatedCount} tallas.`);
      fetchData();
    } else {
      alert('El stock actual ya es igual o superior a todos los mínimos sugeridos. ¡No se ha tocado nada!');
    }
  };

  const handleStockChange = async (
    variantId: string,
    currentStock: number,
    increment: number
  ) => {
    const newStock = currentStock + increment;
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        product_variants: p.product_variants.map((v) =>
          v.id === variantId ? { ...v, stock: newStock } : v
        ),
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

    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        product_variants: p.product_variants.map((v) =>
          v.id === variantId ? { ...v, stock: newStock } : v
        ),
      }))
    );
    await supabase.from('product_variants').update({ stock: newStock }).eq('id', variantId);
  };

  const handleDeleteVariant = async (variantId: string, productId: string) => {
    if (!window.confirm('¿Seguro que quieres eliminar esta talla/producto?')) return;
    const { error } = await supabase.from('product_variants').delete().eq('id', variantId);
    if (error) {
      alert('⚠️ No puedes borrar este artículo porque hay pedidos asociados. Pon el stock a 0.');
    } else {
      const productoAfectado = products.find((p) => p.id === productId);
      if (productoAfectado && productoAfectado.product_variants.length === 1) {
        await supabase.from('products').delete().eq('id', productId);
      }
      fetchData();
    }
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: 'new' | 'edit'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('productos')
        .upload(fileName, file);

      if (uploadError) {
        alert('Error al subir imagen: ' + uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from('productos').getPublicUrl(fileName);
      const url = publicUrlData.publicUrl;

      if (mode === 'new') {
        setNewProduct((prev) => ({ ...prev, image_url: url }));
      } else if (mode === 'edit' && editingItem) {
        setEditingItem({ ...editingItem, image_url: url });
      }
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAddNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    let productIdToUse = selectedProductId;
    if (selectedProductId === 'new') {
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .insert([
          {
            name: newProduct.name,
            category: newProduct.category,
            description: newProduct.description,
            image_url: newProduct.image_url,
            min_stock_alert: newProduct.min_stock_alert,
          },
        ])
        .select('id')
        .single();
      if (prodErr || !prodData) {
        alert('Error al crear el producto.');
        return;
      }
      productIdToUse = prodData.id;
    } else {
      await supabase
        .from('products')
        .update({ min_stock_alert: newProduct.min_stock_alert })
        .eq('id', productIdToUse);
    }

    const { error: varErr } = await supabase.from('product_variants').insert([
      {
        product_id: productIdToUse,
        size: newProduct.size,
        price: newProduct.price,
        stock: newProduct.stock,
      },
    ]);

    if (varErr) {
      alert('Error al añadir la talla.');
    } else {
      alert('¡Añadido con éxito!');
      setShowAddForm(false);
      setNewProduct({
        name: '',
        description: '',
        image_url: '',
        category: 'Ropa',
        min_stock_alert: 5,
        size: 'M',
        price: 15,
        stock: 10,
      });
      setSelectedProductId('new');
      setProductSearchInput('');
      fetchData();
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    await supabase
      .from('products')
      .update({
        name: editingItem.name,
        category: editingItem.category,
        description: editingItem.description,
        image_url: editingItem.image_url,
        min_stock_alert: editingItem.min_stock_alert,
      })
      .eq('id', editingItem.productId);

    await supabase
      .from('product_variants')
      .update({ price: editingItem.price })
      .eq('product_id', editingItem.productId);

    await supabase
      .from('product_variants')
      .update({ size: editingItem.size, price: editingItem.price })
      .eq('id', editingItem.variantId);

    setEditingItem(null);
    fetchData();
  };

  const openEditProduct = (product: Product) => {
    const variant = product.product_variants[0];
    if (!variant) return;
    setEditingItem({
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      category: product.category,
      description: product.description || '',
      image_url: product.image_url || '',
      min_stock_alert: product.min_stock_alert ?? 5,
      size: variant.size,
      price: variant.price,
    });
  };

  return (
    <div>
      {/* RANKING TOP VENTAS */}
      {topProducts.length > 0 && (
        <div className="p-5 bg-purple-50/60 border-b border-purple-100">
          <h3 className="text-xs font-extrabold text-purple-900 uppercase tracking-wider mb-3">
            🔥 Ranking Top Ventas (Artículos y Tallas más solicitadas)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {topProducts.map((p, idx) => (
              <div
                key={p.name}
                className="bg-white p-3 rounded-xl border border-purple-200/60 shadow-2xs flex items-center gap-3"
              >
                <span className="w-7 h-7 rounded-full bg-purple-700 text-white font-black text-xs flex items-center justify-center shrink-0">
                  #{idx + 1}
                </span>
                <div className="overflow-hidden">
                  <p className="font-bold text-slate-900 text-xs truncate">{p.name}</p>
                  <p className="text-[11px] font-semibold text-purple-700">
                    {p.totalSold} unidades vendidas
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CABECERA BUSCADOR Y AUTO-RELLENAR */}
      <div className="p-5 border-b border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="w-full sm:w-72 relative">
          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Filtrar por nombre, categoría o talla..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-purple-600 transition-colors"
          />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap justify-end">
          <button
            onClick={handleAutoRestock}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm"
            title="Sube el stock físico al mínimo sugerido de forma automática"
          >
            ✨ Auto-Rellenar Inicio de Ronda
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            {showAddForm ? '✕ Cerrar formulario' : '+ Añadir Artículo / Talla'}
          </button>
        </div>
      </div>

      {/* FORMULARIO DESPLEGABLE */}
      {showAddForm && (
        <form
          onSubmit={handleAddNewProduct}
          className="p-6 bg-slate-50 border-b border-slate-100 space-y-4 text-xs"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-600 mb-1 uppercase tracking-wider text-[11px]">
                1. ¿Qué quieres hacer?
              </label>
              <select
                value={selectedProductId}
                onChange={(e) => handleSelectExistingProduct(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:border-purple-600"
              >
                <option value="new">✨ Crear un producto totalmente nuevo</option>
                {filteredProductsForSelect.map((p) => (
                  <option key={p.id} value={p.id}>
                    ➕ Añadir nueva talla a: {p.name} ({p.category})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-600 mb-1 uppercase tracking-wider text-[11px]">
                🔍 Buscar producto en el desplegable
              </label>
              <input
                type="text"
                placeholder="Escribe aquí (ej: Polo) para filtrar la lista..."
                value={productSearchInput}
                onChange={(e) => setProductSearchInput(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:border-purple-600"
              />
            </div>
          </div>

          {selectedProductId === 'new' && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                    Nombre del Producto
                  </label>
                  <input
                    type="text"
                    required
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
                    placeholder="Ej: Polo de lobato"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                    Categoría
                  </label>
                  <input
                    type="text"
                    required
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
                    placeholder="Ej: Ropa, Cuadernos..."
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                  Descripción
                </label>
                <textarea
                  value={newProduct.description}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, description: e.target.value })
                  }
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                    Subir Foto desde tu dispositivo
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, 'new')}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs"
                  />
                  {uploadingImage && (
                    <p className="text-purple-700 font-bold mt-1">
                      Subiendo imagen a Supabase...
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                    O pegar URL de la Imagen
                  </label>
                  <input
                    type="url"
                    value={newProduct.image_url}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, image_url: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end pt-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                Talla / Variante
              </label>
              <input
                type="text"
                required
                value={newProduct.size}
                onChange={(e) => setNewProduct({ ...newProduct, size: e.target.value })}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
                placeholder="Ej: M, No aplica..."
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                Precio (€)
              </label>
              <input
                type="number"
                step="0.50"
                required
                value={newProduct.price}
                onChange={(e) =>
                  setNewProduct({ ...newProduct, price: parseFloat(e.target.value) || 0 })
                }
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                Stock Inicial
              </label>
              <input
                type="number"
                required
                value={newProduct.stock}
                onChange={(e) =>
                  setNewProduct({ ...newProduct, stock: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase">
                Avisar en Telegram si baja de:
              </label>
              <input
                type="number"
                required
                value={newProduct.min_stock_alert}
                onChange={(e) =>
                  setNewProduct({
                    ...newProduct,
                    min_stock_alert: parseInt(e.target.value, 10) || 5,
                  })
                }
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={uploadingImage}
              className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-6 py-2.5 rounded-xl transition-colors shadow-xs"
            >
              Guardar en Inventario
            </button>
          </div>
        </form>
      )}

      {/* TABLA AGRUPADA DE INVENTARIO */}
      <div className="overflow-x-auto p-4 bg-slate-50/30">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2 border-slate-100">
              <th className="pb-3 pl-2">Producto</th>
              <th className="pb-3">Categoría</th>
              <th className="pb-3">Precio</th>
              <th className="pb-3">Tallas y Control de Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProducts.map((product) => (
              <tr key={product.id} className="bg-white hover:bg-slate-50/50 transition-colors">
                <td className="p-4 align-top w-1/4">
                  <div className="flex items-start gap-3">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-white"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-xl border border-slate-200">
                        ⛺
                      </div>
                    )}
                    <div>
                      <h4 className="font-black text-slate-900 text-sm leading-tight">
                        {product.name}
                      </h4>
                      <button
                        onClick={() => openEditProduct(product)}
                        className="text-[10px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 mt-1.5 transition-colors"
                      >
                        ✏️ Editar producto / precio
                      </button>
                    </div>
                  </div>
                </td>
                <td className="p-4 align-top">
                  <span className="px-2.5 py-1 bg-purple-50 text-purple-700 rounded-lg font-bold text-[10px] border border-purple-100/50">
                    {product.category}
                  </span>
                </td>
                <td className="p-4 align-top font-black text-slate-900 text-sm">
                  {product.product_variants.length > 0
                    ? Number(product.product_variants[0].price).toFixed(2)
                    : '0.00'}{' '}
                  €
                </td>
                <td className="p-4">
                  <div className="flex flex-col gap-2">
                    {product.product_variants.map((variant) => {
                      const isLowStock = variant.stock <= (product.min_stock_alert ?? 5);
                      return (
                        <div
                          key={variant.id}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between bg-white border border-slate-200 rounded-xl p-2 pl-3 shadow-xs gap-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-black text-slate-800 text-xs min-w-[3.5rem]">
                              {variant.size}
                            </span>
                            {variant.stock < 0 && (
                              <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                📦 Pedir {Math.abs(variant.stock)} a fábrica
                              </span>
                            )}
                            {variant.stock >= 0 && isLowStock && (
                              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
                                ⚠️ Stock bajo
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() =>
                                handleBulkChange(variant.id, variant.stock, 'subtract')
                              }
                              className="text-red-600 font-bold text-[11px] px-2 hover:bg-red-50 rounded py-1 transition-colors"
                            >
                              Quitar
                            </button>
                            <button
                              onClick={() => handleStockChange(variant.id, variant.stock, -1)}
                              className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center justify-center font-bold text-slate-600 transition-colors"
                            >
                              -
                            </button>
                            <span
                              className={`w-8 text-center font-black text-sm ${
                                variant.stock < 0
                                  ? 'text-purple-700'
                                  : isLowStock
                                  ? 'text-red-600'
                                  : 'text-emerald-600'
                              }`}
                            >
                              {variant.stock}
                            </span>
                            <button
                              onClick={() => handleStockChange(variant.id, variant.stock, 1)}
                              className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center justify-center font-bold text-slate-600 transition-colors"
                            >
                              +
                            </button>
                            <button
                              onClick={() =>
                                handleBulkChange(variant.id, variant.stock, 'add')
                              }
                              className="text-emerald-600 font-bold text-[11px] px-2 hover:bg-emerald-50 rounded py-1 transition-colors"
                            >
                              Poner
                            </button>
                            <button
                              onClick={() => handleDeleteVariant(variant.id, product.id)}
                              className="text-slate-300 hover:text-red-500 ml-1 transition-colors"
                              title="Eliminar talla"
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
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL EDITAR PRODUCTO */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-900 text-base">✏️ Editar Producto General</h3>
              <button
                onClick={() => setEditingItem(null)}
                className="w-8 h-8 rounded-full bg-slate-200/60 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 flex flex-col gap-4 text-xs">
              <div className="flex gap-4">
                <div className="w-2/3">
                  <label className="block font-bold text-slate-700 mb-1 uppercase">Nombre</label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="w-1/3">
                  <label className="block font-bold text-slate-700 mb-1 uppercase">Categoría</label>
                  <input
                    type="text"
                    required
                    value={editingItem.category}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1 uppercase">Descripción</label>
                <textarea
                  value={editingItem.description}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, description: e.target.value })
                  }
                  className="w-full p-2.5 border border-slate-200 rounded-xl"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <label className="block font-bold text-slate-700 uppercase">Cambiar Foto</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'edit')}
                  className="w-full p-2 border border-slate-200 rounded-xl text-xs"
                />
                <input
                  type="url"
                  value={editingItem.image_url}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, image_url: e.target.value })
                  }
                  placeholder="https://..."
                  className="w-full p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
              <div className="flex gap-4">
                <div className="w-1/2">
                  <label className="block font-bold text-slate-700 mb-1 uppercase">
                    Alerta Stock Mínimo
                  </label>
                  <input
                    type="number"
                    required
                    value={editingItem.min_stock_alert}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        min_stock_alert: parseInt(e.target.value, 10) || 5,
                      })
                    }
                    className="w-full p-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="w-1/2">
                  <label className="block font-bold text-slate-700 mb-1 uppercase">
                    Precio Base (€)
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={editingItem.price}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        price: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2.5 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 font-bold text-slate-600 bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploadingImage}
                  className="px-5 py-2 font-bold text-white bg-purple-700 rounded-xl"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}