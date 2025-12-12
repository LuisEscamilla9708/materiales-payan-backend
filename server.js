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
   WHATSAPP CLOUD API
============================== */

async function sendWhatsAppMessage(to, text) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en variables de entorno");
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Error WhatsApp API:", data);
    throw new Error(data?.error?.message || "WhatsApp API error");
  }

  return data;
}

/* ==============================
   RUTAS BÁSICAS
============================== */

// Salud del servicio
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "whatsapp-ready-step2",
    webhookUrl:
      process.env.MP_NOTIFICATION_URL ||
      "https://materiales-payan-backend.onrender.com/api/mp/webhook",
    webhookFromEnv: Boolean(process.env.MP_NOTIFICATION_URL)
  });
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

    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({
        error: "Faltan datos del cliente (nombre y WhatsApp)."
      });
    }

    const items = cart.map(p => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN"
    }));

    const orderId = crypto.randomUUID();

    const preferenceData = {
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html"
      },
      auto_return: "approved",
      notification_url:
        process.env.MP_NOTIFICATION_URL ||
        "https://materiales-payan-backend.onrender.com/api/mp/webhook",
      metadata: {
        orderId,
        customer,
        cart
      }
    };

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
-------------------------------- */
app.post("/api/mp/webhook", async (req, res) => {
  res.sendStatus(200); // responder rápido

  try {
    const topic = req.query.topic || req.query.type;
    const id = req.query.id || req.body?.data?.id;

    if (!id || topic !== "payment") return;

    const payment = await mercadopago.payment.findById(id);

    const status   = payment?.body?.status;
    const metadata = payment?.body?.metadata;
    const mpPaymentId = payment?.body?.id;

    console.log("MP webhook payment:", {
      mpPaymentId,
      status,
      orderId: metadata?.orderId
    });

    if (status === "approved") {
      console.log("✅ PAGO APROBADO - Datos de orden:", {
        orderId: metadata?.orderId,
        customer: metadata?.customer,
        cart: metadata?.cart
      });

      // Aquí más adelante integraremos sendWhatsAppMessage(...)
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

/* ------------------------------
   ✅ RUTA DE PRUEBA WHATSAPP
   GET y POST para que sea fácil
-------------------------------- */

// GET: para probar desde el navegador
app.get("/api/test-whatsapp", async (req, res) => {
  try {
    const to = process.env.WHATSAPP_OWNER_PHONE;
    if (!to) {
      return res.status(500).json({
        ok: false,
        error: "Falta WHATSAPP_OWNER_PHONE en las variables de entorno"
      });
    }

    const data = await sendWhatsAppMessage(
      to,
      "Mensaje de prueba desde el backend de Materiales Payán ✅"
    );

    res.json({ ok: true, to, data });
  } catch (err) {
    console.error("Test WhatsApp error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST: por si luego quieres llamarlo desde tu front
app.post("/api/test-whatsapp", async (req, res) => {
  try {
    const { to, text } = req.body;
    const phone = to || process.env.WHATSAPP_OWNER_PHONE;

    if (!phone) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar 'to' o configurar WHATSAPP_OWNER_PHONE"
      });
    }

    const data = await sendWhatsAppMessage(
      phone,
      text || "Mensaje de prueba desde el backend de Materiales Payán ✅"
    );

    res.json({ ok: true, to: phone, data });
  } catch (err) {
    console.error("Test WhatsApp POST error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
