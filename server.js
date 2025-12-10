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
   WEBHOOK URL (única fuente)
============================== */

// Si existe variable, úsala.
// Si no, usa el endpoint público de tu servicio en Render.
const WEBHOOK_URL =
  process.env.MP_NOTIFICATION_URL ||
  "https://materiales-payan-backend.onrender.com/api/mp/webhook";

/* ==============================
   RUTAS
============================== */

// Salud del servicio
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "whatsapp-ready-step2",
    webhookUrl: WEBHOOK_URL,
    webhookFromEnv: Boolean(process.env.MP_NOTIFICATION_URL)
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

    // Evitar pedidos sin contacto
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

    // ✅ Guardamos metadata útil para el webhook
    // Mantén esto ligero para no exceder límites
    const safeCart = cart.map(p => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      price: Number(p.price ?? 0),
      quantity: Number(p.quantity ?? 1)
    }));

    const preferenceData = {
      items,
      back_urls: {
        success: "https://materialespayan.online/pago-exitoso.html",
        failure: "https://materialespayan.online/pago-fallo.html",
        pending: "https://materialespayan.online/pago-pendiente.html"
      },
      auto_return: "approved",

      // ✅ Webhook
      notification_url: WEBHOOK_URL,

      // ✅ Metadata para WhatsApp después
      metadata: {
        orderId,
        customer: {
          name: String(customer.name),
          phone: String(customer.phone)
        },
        cart: safeCart
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

   Mercado Pago llamará aquí cuando cambie el estado del pago.
   Este endpoint NO debe tardar.

   - respondemos 200 rápido
   - luego procesamos
-------------------------------- */
app.post("/api/mp/webhook", async (req, res) => {
  // ✅ Respuesta inmediata para evitar reintentos
  res.sendStatus(200);

  try {
    // Mercado Pago puede mandar info por query o por body
    const topic = req.query.topic || req.query.type || req.body?.type;
    const paymentId =
      req.query.id ||
      req.body?.data?.id ||
      req.body?.id;

    if (!paymentId) return;

    // Solo nos interesa "payment"
    if (topic && topic !== "payment") return;

    // Obtener info del pago
    const payment = await mercadopago.payment.findById(paymentId);

    const status = payment?.body?.status; // approved, pending, rejected...
    const mpPaymentId = payment?.body?.id;
    const metadata = payment?.body?.metadata || {};

    console.log("MP webhook payment:", {
      mpPaymentId,
      status,
      orderId: metadata?.orderId
    });

    // ✅ Aquí dejaremos listo el punto para WhatsApp
    // En el siguiente paso agregaremos el envío real de mensajes.
    if (status === "approved") {
      console.log("✅ PAGO APROBADO - Datos de orden:", {
        orderId: metadata?.orderId,
        customer: metadata?.customer,
        cart: metadata?.cart
      });

      // FUTURO INMEDIATO (paso siguiente):
      // await sendWhatsAppToCustomer(metadata);
      // await sendWhatsAppToOwner(metadata);
    }

    // Importante:
    // Para OXXO normalmente verás status "pending" al inicio.
    // Cuando el cliente pague en tienda, MP te enviará otra notificación
    // y ahí sí quedará "approved".

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
