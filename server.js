import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import crypto from "crypto";

const app = express();

/* ==============================
   CONFIG GENERAL
============================== */

// CORS: permite tu web y pruebas locales
app.use(
  cors({
    origin: [
      "https://materialespayan.online",
      "https://www.materialespayan.online",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ],
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

/* ==============================
   RUTAS BÁSICAS
============================== */

// Salud del servicio
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "mp-webhook-only-v1", // 👈 actualizado
    webhookUrl:
      process.env.MP_NOTIFICATION_URL ||
      "https://materiales-payan-backend.onrender.com/api/mp/webhook",
    webhookFromEnv: Boolean(process.env.MP_NOTIFICATION_URL),
  });
});

// ✅ RUTA DE PRUEBA MUY SIMPLE
app.get("/prueba-ruta", (req, res) => {
  res.send("Ruta de prueba OK desde el backend de Materiales Payán");
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

      // ✅ Opcional pero recomendado: ayuda a rastrear pagos por orden
      external_reference: orderId,

      // Se guarda para tu propia lógica (no es visible al cliente)
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
    });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

/* ------------------------------
   ✅ WEBHOOK MERCADO PAGO
   (solo registra/valida, ya NO manda WhatsApp)
-------------------------------- */
app.post("/api/mp/webhook", async (req, res) => {
  // Respondemos rápido a Mercado Pago
  res.sendStatus(200);

  try {
    const topic = req.query.topic || req.query.type;
    const id = req.query.id || req.body?.data?.id;

    if (!id || topic !== "payment") return;

    const payment = await mercadopago.payment.findById(id);

    const status = payment?.body?.status; // approved | pending | rejected | etc
    const metadata = payment?.body?.metadata || {};
    const mpPaymentId = payment?.body?.id;
    const externalReference = payment?.body?.external_reference;

    console.log("MP webhook payment:", {
      mpPaymentId,
      status,
      orderId: metadata.orderId || externalReference,
    });

    // Si quieres ver más detalle en logs:
    if (status === "approved") {
      console.log("✅ PAGO APROBADO (sin WhatsApp automático)", {
        orderId: metadata.orderId || externalReference,
        customer: metadata.customer || {},
        cartCount: Array.isArray(metadata.cart) ? metadata.cart.length : 0,
      });
    } else if (status === "pending") {
      console.log("⏳ PAGO PENDIENTE (ej. OXXO)", {
        orderId: metadata.orderId || externalReference,
      });
    } else {
      console.log("⚠️ ESTADO DE PAGO:", status, {
        orderId: metadata.orderId || externalReference,
      });
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
