import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";

const app = express();

/* ==============================
   CONFIG GENERAL
============================== */

// CORS: permite tu web y pruebas locales
app.use(cors({
  origin: [
    "https://materialespayan.online",
    "https://www.materialespayan.online",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* ==============================
   MERCADO PAGO
============================== */

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

/* ==============================
   RUTAS
============================== */

// Salud del servicio
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "no-shipping"
  });
});

/* ------------------------------
   ✅ CHECKOUT MERCADO PAGO

   Body esperado desde tu front:
   {
     cart: [{ id, name, price, quantity, img }],
     customer: { name, phone } // opcional
   }
-------------------------------- */
app.post("/api/checkout", async (req, res) => {
  try {
    const { cart, customer } = req.body;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    // Items para Mercado Pago
    const items = cart.map(p => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN"
    }));

    const preferenceData = {
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html"
      },
      auto_return: "approved",
      // metadata útil para futuro webhook/WhatsApp
      metadata: {
        customer: customer || null
      }
    };

    const preference = await mercadopago.preferences.create(preferenceData);

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
