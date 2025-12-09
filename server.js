import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";

const app = express();

/* ==============================
   CONFIG GENERAL
============================== */

// Tienda
const STORE_POSTAL_CODE = "03440";
const FREE_KM = 5;
const RATE_PER_KM = 80;

// Permitir peticiones de tu frontend
app.use(cors({
  origin: [
    "https://materialespayan.online",
    "https://www.materialespayan.online",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* ==============================
   MERCADO PAGO
============================== */

// Mercado Pago token desde variable de entorno
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

/* ==============================
   HELPERS ENVÍO
============================== */

function computeShippingCost(distanceKm) {
  const km = Number(distanceKm) || 0;
  if (km <= FREE_KM) return 0;

  const extraKm = km - FREE_KM;
  // Cobro por km extra
  const cost = extraKm * RATE_PER_KM;

  // Redondeo a 2 decimales por orden
  return Math.round(cost * 100) / 100;
}

// Cache simple en memoria para no pedir lo mismo mil veces
const coordsCache = new Map();

// Obtener coordenadas aproximadas por Código Postal con Nominatim (OSM)
async function getCoordsFromPostalCode(postalCode) {
  const key = `MX-${postalCode}`;
  if (coordsCache.has(key)) return coordsCache.get(key);

  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(postalCode)}&country=Mexico&format=json&limit=1`;

  const res = await fetch(url, {
    headers: {
      // Nominatim requiere User-Agent identificable
      "User-Agent": "MaterialesPayanBackend/1.0 (shipping-quote)"
    }
  });

  if (!res.ok) throw new Error("No se pudo consultar geocodificación.");
  const data = await res.json();

  if (!data || !data.length) {
    throw new Error("No se encontraron coordenadas para ese código postal.");
  }

  const item = data[0];
  const coords = {
    lat: Number(item.lat),
    lon: Number(item.lon)
  };

  coordsCache.set(key, coords);
  return coords;
}

// Distancia de manejo usando OSRM público
async function getDrivingDistanceKm(origin, destination) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo consultar distancia de ruta.");

  const data = await res.json();

  const meters = data?.routes?.[0]?.distance;
  if (!meters && meters !== 0) {
    throw new Error("No se pudo calcular la distancia de manejo.");
  }

  const km = meters / 1000;
  return km;
}

/* ==============================
   RUTAS
============================== */

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    shipping: {
      storePostalCode: STORE_POSTAL_CODE,
      freeKm: FREE_KM,
      ratePerKm: RATE_PER_KM
    }
  });
});

/* ------------------------------
   ✅ ENVÍO POR CÓDIGO POSTAL
   Body esperado:
   {
     "postalCode": "56618"
   }

   Response:
   {
     "postalCode": "...",
     "storePostalCode": "03440",
     "distanceKm": 12.3,
     "shippingCost": 584,
     "freeKm": 5,
     "ratePerKm": 80
   }
-------------------------------- */
app.post("/api/shipping-quote", async (req, res) => {
  try {
    const { postalCode } = req.body;

    if (!postalCode || typeof postalCode !== "string") {
      return res.status(400).json({ error: "Código postal inválido." });
    }

    const cleanPostal = postalCode.trim();

    // Si es exactamente el CP de la tienda, envío 0 directo
    if (cleanPostal === STORE_POSTAL_CODE) {
      return res.json({
        postalCode: cleanPostal,
        storePostalCode: STORE_POSTAL_CODE,
        distanceKm: 0,
        shippingCost: 0,
        freeKm: FREE_KM,
        ratePerKm: RATE_PER_KM
      });
    }

    // Obtener coords origen/destino por CP
    const originCoords = await getCoordsFromPostalCode(STORE_POSTAL_CODE);
    const destCoords = await getCoordsFromPostalCode(cleanPostal);

    // Calcular distancia de manejo
    const distanceKm = await getDrivingDistanceKm(originCoords, destCoords);

    const shippingCost = computeShippingCost(distanceKm);

    return res.json({
      postalCode: cleanPostal,
      storePostalCode: STORE_POSTAL_CODE,
      distanceKm: Math.round(distanceKm * 100) / 100,
      shippingCost,
      freeKm: FREE_KM,
      ratePerKm: RATE_PER_KM
    });

  } catch (err) {
    console.error("Shipping quote error:", err);
    return res.status(500).json({
      error: "No se pudo calcular el envío con ese código postal."
    });
  }
});

/* ------------------------------
   ✅ CHECKOUT MERCADO PAGO
   Body:
   {
     cart: [{ id, name, price, quantity, img }],
     shippingCost: number,     // opcional
     customer: { name, phone, postalCode } // opcional
   }
-------------------------------- */
app.post("/api/checkout", async (req, res) => {
  try {
    const { cart, shippingCost = 0 } = req.body;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    const items = cart.map(p => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN"
    }));

    // Si hay costo de envío, lo agregamos como ítem separado
    const shippingNum = Number(shippingCost) || 0;
    if (shippingNum > 0) {
      items.push({
        title: "Envío a domicilio",
        quantity: 1,
        unit_price: shippingNum,
        currency_id: "MXN"
      });
    }

    const preference = await mercadopago.preferences.create({
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html"
      },
      auto_return: "approved"
    });

    return res.json({
      checkoutUrl: preference.body.init_point
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
