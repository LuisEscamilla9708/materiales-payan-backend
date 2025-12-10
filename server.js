import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import crypto from "crypto";

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
    version: "whatsapp-ready-step2",
    webhookConfigured: Boolean(process.env.MP_NOTIFICATION_URL)
  });
});

/* ------------------------------
   ✅ CHECKOUT MERCADO PAGO

   Body esperado desde tu front:
   {
     cart: [{ id, name, price, quantity, img }],
     customer: { name, phone } 
   }
-------------------------------- */
app.post("/api/checkout", async (req, res) => {
  try {
    const { cart, customer } = req.body;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    // Si tu front ya manda customer, esto ayuda a evitar pedidos sin contacto
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({
        error: "Faltan datos del cliente (nombre y WhatsApp)."
      });
    }

    // Items para Mercado Pago
    const items = cart.map(p => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN"
    }));

    // ✅ ID interno simple para rastrear
    const orderId = crypto.randomUUID();

    const preferenceData = {
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html"
      },
      auto_return: "approved",

      // ✅ Guardamos todo lo que necesitaremos para WhatsApp después
      metadata: {
        orderId,
        customer,
        cart
      }
    };

    // ✅ Activa webhook automático si ya pusiste la variable en Render
    if (process.env.MP_NOTIFICATION_URL) {
      preferenceData.notification_url = process.env.MP_NOTIFICATION_URL;
    }

    const preference = await mercadopago.preferences.create(preferenceData);

    return res.json({
      checkoutUrl: preference.body.init_point,
      orderId
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

/* ------------------------------
   ✅ WEBHOOK MERCADO PAGO

   Mercado Pago llamará aquí cuando cambie el estado del pago.
   Este endpoint NO debe tardar.

   IMPORTANTE:
   - respondemos 200 rápido
   - luego procesamos
-------------------------------- */
app.post("/api/mp/webhook", async (req, res) => {
  // ✅ Respuesta inmediata para evitar reintentos
  res.sendStatus(200);

  try {
    const topic = req.query.topic || req.query.type;
    const id = req.query.id || req.body?.data?.id;

    if (!id) return;

    // Solo nos interesa "payment"
    if (topic !== "payment") return;

    // Obtener info del pago
    const payment = await mercadopago.payment.findById(id);

    const status = payment?.body?.status; // approved, pending, rejected, etc.
    const metadata = payment?.body?.metadata; // lo que pusimos en checkout
    const mpPaymentId = payment?.body?.id;

    // Log útil
    console.log("MP webhook payment:", {
      mpPaymentId,
      status,
      orderId: metadata?.orderId
    });

    // ✅ Aquí es donde más adelante integraremos WhatsApp
    if (status === "approved") {
      // Por ahora solo mostramos en logs el contenido
      console.log("✅ PAGO APROBADO - Datos de orden:", {
        orderId: metadata?.orderId,
        customer: metadata?.customer,
        cart: metadata?.cart
      });

      // FUTURO:
      // await sendWhatsAppToCustomer(metadata)
      // await sendWhatsAppToOwner(metadata)
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
