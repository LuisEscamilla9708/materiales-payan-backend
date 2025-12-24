import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import crypto from "crypto";

const app = express();

/* ==============================
   CONFIG GENERAL
============================== */

const allowedOrigins = [
  "https://materialespayan.online",
  "https://www.materialespayan.online",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

/* ==============================
   MERCADO PAGO
============================== */

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Guarda el último webhook recibido (solo para debug)
let lastWebhook = null;

/* ==============================
   RUTAS BÁSICAS
============================== */

// Salud del servicio
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "mp-only-v1",
    webhookUrl:
      process.env.MP_NOTIFICATION_URL ||
      "https://materiales-payan-backend.onrender.com/api/mp/webhook",
    webhookFromEnv: Boolean(process.env.MP_NOTIFICATION_URL),
  });
});

// Ruta de prueba
app.get("/prueba-ruta", (req, res) => {
  res.send("Ruta de prueba OK desde el backend de Materiales Payán");
});

/* ------------------------------
   ✅ PING A MERCADO PAGO (SIN COBRAR)
   Sirve para confirmar que MP_ACCESS_TOKEN está bien
-------------------------------- */
app.get("/api/mp/ping", async (req, res) => {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return res.status(500).json({ ok: false, error: "Falta MP_ACCESS_TOKEN" });
    }

    const r = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "Token inválido o sin permisos",
        details: data,
      });
    }

    res.json({
      ok: true,
      mpUser: {
        id: data.id,
        nickname: data.nickname,
        site_id: data.site_id,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ------------------------------
   ✅ CHECKOUT MERCADO PAGO
-------------------------------- */
app.post("/api/checkout", async (req, res) => {
  try {
    const { cart, customer } = req.body;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    // Ya no es obligatorio el teléfono si ya no mandas WhatsApp automático,
    // pero lo dejamos porque lo usas para tu flujo de "compartir comprobante".
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({
        error: "Faltan datos del cliente (nombre y WhatsApp).",
      });
    }

    const items = cart.map((p) => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN",
    }));

    const orderId = crypto.randomUUID();

    const notificationUrl =
      process.env.MP_NOTIFICATION_URL ||
      "https://materiales-payan-backend.onrender.com/api/mp/webhook";

    const preferenceData = {
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html",
      },
      auto_return: "approved",
      notification_url: notificationUrl,

      // Recomendado: referencia externa simple
      external_reference: orderId,

      // Te sirve para reconstruir info si luego la ocupas
      metadata: {
        orderId,
        customer,
        cart,
      },
    };

    const preference = await mercadopago.preferences.create(preferenceData);

    return res.json({
      checkoutUrl: preference.body.init_point,
      orderId,
      notificationUrl,
    });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

/* ------------------------------
   ✅ WEBHOOK MERCADO PAGO
   (ya no manda WhatsApp, solo registra)
-------------------------------- */
app.post("/api/mp/webhook", async (req, res) => {
  // Respondemos rápido a MP
  res.sendStatus(200);

  try {
    const topic = req.query.topic || req.query.type;
    const id = req.query.id || req.body?.data?.id;

    if (!id || topic !== "payment") return;

    const payment = await mercadopago.payment.findById(id);

    const status = payment?.body?.status;
    const metadata = payment?.body?.metadata || {};
    const mpPaymentId = payment?.body?.id;

    lastWebhook = {
      receivedAt: new Date().toISOString(),
      mpPaymentId,
      status,
      orderId: metadata.orderId || payment?.body?.external_reference || null,
      customer: metadata.customer || null,
      cartCount: Array.isArray(metadata.cart) ? metadata.cart.length : 0,
    };

    console.log("MP webhook payment:", lastWebhook);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ✅ DEBUG: ver el último webhook sin entrar a logs
app.get("/api/debug/last-webhook", (req, res) => {
  res.json({ ok: true, lastWebhook });
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
