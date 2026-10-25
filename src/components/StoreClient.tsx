'use client';

import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/navigation';

const avisarPorTelegram = async (mensaje: string) => {
  const token = process.env.NEXT_PUBLIC_TELEGRAM_TOKEN;
  const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: mensaje }) }); } catch (error) { console.error(error); }
};

interface Variant { id: string; size: string; price: number; stock: number; }
interface Product { id: string; name: string; description?: string; image_url?: string; category: string; min_stock_alert?: number; product_variants: Variant[]; }
interface CartItem { variant_id: string; product_name: string; size: string; price: number; quantity: number; max_stock: number; }

export default function StoreClient({ products }: { products: Product[] }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState(''); // NUEVO: Estado para el correo electrónico
  const [scoutUnit, setScoutUnit] = useState('Manada');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  
  const [activeDescription, setActiveDescription] = useState<Product | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<{ [productId: string]: string }>({});
  
  const [showToast, setShowToast] = useState(false);
  const cartRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  const sortVariants = (variants: Variant[]) => {
    const sizeOrder: { [key: string]: number } = {
      'xs': 1, 's': 2, 'm': 3, 'l': 4, 'xl': 5, 'xxl': 6, '3xl': 7,
      '3-4': 10, '5-6': 11, '7-8': 12, '9-10': 13, '11-12': 14,
      'única': 99, 'unica': 99
    };

    return [...variants].sort((a, b) => {
      const sizeA = a.size.toLowerCase().trim();
      const sizeB = b.size.toLowerCase().trim();

      if (sizeOrder[sizeA] && sizeOrder[sizeB]) return sizeOrder[sizeA] - sizeOrder[sizeB];
      if (sizeOrder[sizeA]) return -1;
      if (sizeOrder[sizeB]) return 1;

      const numA = parseFloat(sizeA);
      const numB = parseFloat(sizeB);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;

      return sizeA.localeCompare(sizeB);
    });
  };

  const handleVariantChange = (productId: string, variantId: string) => {
    setSelectedVariants(prev => ({ ...prev, [productId]: variantId }));
  };

  const addToCart = (product: Product) => {
    const sortedVars = sortVariants(product.product_variants);
    const firstAvailable = sortedVars.find(v => v.stock > 0) || sortedVars[0];
    const defaultVariantId = selectedVariants[product.id] || firstAvailable?.id;
    
    const variant = sortedVars.find(v => v.id === defaultVariantId);
    if (!variant || variant.stock === 0) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.variant_id === variant.id);
      if (existing) {
        if (existing.quantity >= variant.stock) return prev;
        return prev.map((item) => item.variant_id === variant.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { variant_id: variant.id, product_name: product.name, size: variant.size, price: variant.price, quantity: 1, max_stock: variant.stock }];
    });

    setShowToast(true);
    setTimeout(() => { setShowToast(false); }, 2000);
  };

  const updateQuantity = (variant_id: string, delta: number) => {
    setCart((prev) => {
      return prev.map(item => {
        if (item.variant_id === variant_id) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > item.max_stock) return item;
          return { ...item, quantity: newQty };
        }
        return item;
      }).filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (variant_id: string) => setCart((prev) => prev.filter((item) => item.variant_id !== variant_id));
  
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckout = async () => {
    if (!buyerName.trim()) { alert('Por favor, introduce tu nombre para el pedido.'); return; }
    setStatus('loading');
    
    // NUEVO: Guardamos el email también en Supabase al crear el pedido
    const { data: orderData, error: orderError } = await supabase.from('orders')
      .insert([{ 
        buyer_name: buyerName, 
        scout_unit: scoutUnit, 
        total_amount: total,
        email: email.trim() || null // Si está vacío lo manda como null
      }])
      .select('id').single();
      
    if (orderError || !orderData) { alert('Error: ' + orderError?.message); setStatus('idle'); return; }

    const itemsToInsert = cart.map(item => ({ order_id: orderData.id, variant_id: item.variant_id, quantity: item.quantity, unit_price: item.price }));
    const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert);
    if (itemsError) { alert('Error: ' + itemsError.message); setStatus('idle'); return; }

    for (const item of cart) {
      const { data: variantInfo } = await supabase.from('product_variants').select('stock, size, products (name, min_stock_alert)').eq('id', item.variant_id).single();
      if (variantInfo) {
        const stockRestante = variantInfo.stock - item.quantity;
        await supabase.from('product_variants').update({ stock: stockRestante }).eq('id', item.variant_id);
        
        // @ts-ignore
        const limiteAlerta = variantInfo.products?.min_stock_alert ?? 5;

        if (stockRestante <= limiteAlerta) {
          await avisarPorTelegram(`🚨 Alerta Almacén\nEl artículo "${item.product_name}" (Talla: ${variantInfo.size}) se está agotando.\n⚠️ Quedan: ${stockRestante} uds.`);
        }
      }
    }
    
    const resumenPedido = cart.map(item => `🔹 ${item.quantity}x ${item.product_name} (Talla: ${item.size})`).join('\n');
    await avisarPorTelegram(`✅ Nuevo pedido de ${buyerName} (Rama: ${scoutUnit}): ${total.toFixed(2)} €\n\n📝 Lista de artículos:\n${resumenPedido}`);
    
    // NUEVO: Lanzamos el correo automático al Kraal con el resumen y alertas
    try {
      await fetch('/api/nueva-reserva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          buyer_name: buyerName,
          total_amount: total,
          order_items: cart
        })
      });
    } catch (error) {
      console.log("No se pudo enviar el correo de aviso al grupo, pero el pedido se guardó.");
    }
    
    setStatus('success'); 
    setCart([]); 
    setBuyerName('');
    setEmail(''); // Limpiamos el email al terminar
    router.refresh();
  };

  const scrollToCart = () => {
    cartRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (status === 'success') {
    return (
      <div className="bg-white shadow-sm border border-slate-200/80 p-12 rounded-2xl text-center max-w-xl mx-auto my-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Pedido registrado con éxito! ⚜️</h2>
        <p className="text-slate-500 mb-6 text-sm">Hemos enviado tu solicitud correctamente a los responsables.</p>
        <button onClick={() => setStatus('idle')} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors">
          Hacer otro pedido
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start relative">
      
      {/* Mensaje Flotante (Toast) */}
      <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${showToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
        <div className="bg-emerald-600 text-white font-bold text-sm px-6 py-3 rounded-full shadow-xl flex items-center gap-2">
          <span>✅</span> Añadido a la cesta
        </div>
      </div>

      {/* Botón Flotante para Móviles */}
      {totalItems > 0 && (
        <button 
          onClick={scrollToCart}
          className="lg:hidden fixed bottom-6 right-6 bg-purple-700 hover:bg-purple-800 text-white p-4 rounded-full shadow-2xl z-40 transition-transform active:scale-95 flex items-center justify-center border-4 border-white"
          style={{ width: '64px', height: '64px' }}
        >
          <span className="text-2xl">🛒</span>
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-black w-6 h-6 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
            {totalItems}
          </span>
        </button>
      )}

      {/* REJILLA DE PRODUCTOS */}
      <div className="flex-1 flex flex-wrap justify-center gap-6">
        {products.map((product) => {
          const sortedVariants = sortVariants(product.product_variants);
          
          const firstAvailable = sortedVariants.find(v => v.stock > 0) || sortedVariants[0];
          const currentVariantId = selectedVariants[product.id] || firstAvailable?.id;
          const selectedVariant = sortedVariants.find(v => v.id === currentVariantId) || firstAvailable;
          
          const hasMultipleVariants = sortedVariants.length > 1;

          return (
            <div key={product.id} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden border border-slate-200/70 flex flex-col w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] max-w-sm">
              
              <div className="w-full h-52 bg-slate-50/50 flex items-center justify-center p-6 relative border-b border-slate-100">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="max-w-full max-h-full object-contain hover:scale-105 transition-transform duration-300" />
                ) : (
                  <span className="text-4xl opacity-20">⛺</span>
                )}
                <span className="absolute top-3 left-3 bg-white/80 backdrop-blur-sm text-slate-700 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border border-slate-200/60 shadow-xs">
                  {product.category}
                </span>
              </div>
              
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <h2 className="text-lg font-bold text-slate-900">{product.name}</h2>
                    {product.description && (
                      <button onClick={() => setActiveDescription(product)} className="text-xs font-medium text-purple-700 hover:text-purple-900 underline underline-offset-4 shrink-0 transition-colors pt-1">
                        Descripción
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 mr-3">
                      {hasMultipleVariants ? (
                        <>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Seleccionar Talla</label>
                          <select 
                            value={currentVariantId} 
                            onChange={(e) => handleVariantChange(product.id, e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-purple-600 transition-colors cursor-pointer">
                            {sortedVariants.map((v) => (
                              <option key={v.id} value={v.id}>
                                Talla {v.size} {v.stock === 0 ? '(Agotado)' : `(${v.stock} disp.)`}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Talla / Modelo</label>
                          <div className="text-xs font-bold text-slate-800 py-2">
                            {selectedVariant?.size} <span className="font-normal text-slate-400">({selectedVariant?.stock} disp.)</span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Precio</span>
                      <span className="font-extrabold text-slate-900 text-base">{Number(selectedVariant?.price || 0).toFixed(2)} €</span>
                    </div>
                  </div>

                  <button 
                    onClick={() => addToCart(product)} 
                    disabled={selectedVariant?.stock === 0} 
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-300 text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition-colors shadow-xs">
                    {selectedVariant?.stock === 0 ? 'Agotado' : 'Añadir a la cesta'}
                  </button>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* CARRITO A LA DERECHA */}
      <div ref={cartRef} className="w-full lg:w-[360px] lg:sticky lg:top-6 bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 shrink-0">
        <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4 flex items-center justify-between">
          <span>🛒 Tu Pedido</span>
          <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{totalItems} ítems</span>
        </h3>
        
        {cart.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">El carrito está vacío.</p>
        ) : (
          <>
            <ul className="space-y-3 mb-5 max-h-60 overflow-y-auto pr-1">
              {cart.map((item) => (
                <li key={item.variant_id} className="text-xs flex justify-between items-center bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                    <div className="flex flex-col flex-1 mr-2">
                        <span className="text-slate-800 font-medium">
                          {item.product_name} <span className="text-purple-700 font-bold">({item.size})</span>
                        </span>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center border border-slate-200 bg-white rounded-lg overflow-hidden">
                            <button onClick={() => updateQuantity(item.variant_id, -1)} className="px-2 py-0.5 text-slate-600 hover:bg-slate-100 font-bold">-</button>
                            <span className="px-2 py-0.5 font-bold text-slate-800">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.variant_id, 1)} className="px-2 py-0.5 text-slate-600 hover:bg-slate-100 font-bold">+</button>
                          </div>
                          <button onClick={() => removeFromCart(item.variant_id)} className="text-[10px] font-semibold text-red-500 hover:text-red-700 transition-colors">Quitar</button>
                        </div>
                    </div>
                    <span className="font-bold text-slate-900 shrink-0">{(item.price * item.quantity).toFixed(2)} €</span>
                </li>
              ))}
            </ul>
            
            <div className="flex justify-between items-center mb-5 pt-3 border-t border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total</span>
              <span className="font-extrabold text-purple-700 text-xl">{total.toFixed(2)} €</span>
            </div>
            
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Tu Nombre *</label>
                <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="w-full border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-purple-600 transition-colors bg-slate-50/50" placeholder="Ej: Baloo" />
              </div>

              {/* NUEVO CAMPO: CORREO ELECTRÓNICO */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Tu Correo (Opcional)</label>
                <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  className="w-full border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-purple-600 transition-colors bg-slate-50/50" 
                  placeholder="Para avisos de reserva..." 
                />
              </div>
              
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Rama</label>
                <select 
                  value={scoutUnit} 
                  onChange={(e) => setScoutUnit(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-purple-600 transition-colors cursor-pointer">
                  <option value="Manada">🐺 Manada</option>
                  <option value="Tropa">⚜️ Tropa</option>
                  <option value="Pioneros">🧭 Pioneros</option>
                  <option value="Rovers">🔥 Rovers</option>
                  <option value="Padres">⛺ Padres / Comité</option>
                </select>
              </div>
            </div>
            
            <button onClick={handleCheckout} disabled={status === 'loading'} className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs py-3 px-4 rounded-xl transition-colors shadow-xs">
              {status === 'loading' ? 'Procesando...' : 'Confirmar Pedido'}
            </button>
          </>
        )}
      </div>

      {/* VENTANA FLOTANTE DE DESCRIPCIÓN */}
      {activeDescription && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-900 text-base">{activeDescription.name}</h3>
              <button onClick={() => setActiveDescription(null)} className="w-8 h-8 rounded-full bg-slate-200/60 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center transition-colors">&times;</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{activeDescription.description}</p>
            </div>
            <div className="px-6 py-3 bg-slate-50/50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setActiveDescription(null)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors">Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}