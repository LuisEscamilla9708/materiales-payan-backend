import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import crypto from "crypto";

const app = express();

/* ==============================
   CORS / CONFIG GENERAL
============================== */

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

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_OWNER_PHONE = process.env.WHATSAPP_OWNER_PHONE || "";

// Deja solo dígitos y agrega 52 si no lo tiene
function normalizeWhatsAppPhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits.startsWith("52")) {
    digits = "52" + digits;
  }
  return digits;
}

// Enviar mensaje de texto por WhatsApp
async function sendWhatsAppText(to, body) {
  try {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
      console.error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en las variables de entorno");
      return;
    }

    const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Error al enviar WhatsApp", res.status, data);
    } else {
      console.log("WhatsApp enviado correctamente", data);
    }
  } catch (err) {
    console.error("Error inesperado al enviar WhatsApp:", err);
  }
}

/* ==============================
   RUTAS BÁSICAS
============================== */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Materiales Payán Backend",
    version: "whatsapp-step3",
    whatsapp: {
      hasToken: Boolean(WHATSAPP_TOKEN),
      hasPhoneId: Boolean(WHATSAPP_PHONE_ID),
      hasOwnerPhone: Boolean(WHATSAPP_OWNER_PHONE)
    }
  });
});

/* ==============================
   CHECKOUT MERCADO PAGO
============================== */
/*
  Body esperado desde el front:

  {
    cart: [{ id, name, price, quantity, img }],
    customer: { name, phone }
  }
*/

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
      // Webhook a nuestro backend
      notification_url: "https://materiales-payan-backend.onrender.com/api/mp/webhook",
      // Esto viaja a Mercado Pago y regresa en el webhook
      metadata: {
        orderId,
        customer,
        cart
      }
    };

    // Si algún día quieres sobreescribir la URL desde env:
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

/* ==============================
   WEBHOOK MERCADO PAGO
============================== */
/*
   Mercado Pago llamará aquí cuando haya cambios en el pago.
   – Respondemos 200 rápido.
   – Luego procesamos y mandamos WhatsApp si el pago está "approved".
*/

app.post("/api/mp/webhook", async (req, res) => {
  // Respuesta rápida para que MP no reintente
  res.sendStatus(200);

  try {
    const topic = req.query.topic || req.query.type;
    const id = req.query.id || req.body?.data?.id;

    if (!id) {
      console.log("Webhook sin id de pago");
      return;
    }

    if (topic !== "payment") {
      console.log("Webhook ignorado, topic:", topic);
      return;
    }

    const payment = await mercadopago.payment.findById(id);

    const status = payment?.body?.status;              // approved, pending, rejected...
    const metadata = payment?.body?.metadata || {};    // lo que mandamos en preference.metadata
    const mpPaymentId = payment?.body?.id;
    const totalAmount = payment?.body?.transaction_amount;

    console.log("MP webhook payment:", {
      mpPaymentId,
      status,
      totalAmount,
      metadata
    });

    if (status !== "approved") {
      console.log("Pago no aprobado, no se envía WhatsApp");
      return;
    }

    const customer = metadata.customer || {};
    const cart = Array.isArray(metadata.cart) ? metadata.cart : [];
    const orderId = metadata.orderId;

    const customerPhone = normalizeWhatsAppPhone(customer.phone);
    const ownerPhone = normalizeWhatsAppPhone(WHATSAPP_OWNER_PHONE);

    // Texto con los productos
    let itemsText = "";
    if (cart.length) {
      itemsText = cart.map(p => {
        const q = p.quantity || 1;
        const name = p.name || "producto";
        const price = Number(p.price) || 0;
        const subtotal = q * price;
        return `• ${q} x ${name} ($${subtotal} MXN)`;
      }).join("\n");
    }

    const totalText = totalAmount
      ? `Total pagado: $${totalAmount} MXN`
      : "";

    // ========= Mensaje para el cliente =========
    if (customerPhone) {
      await sendWhatsAppText(
        customerPhone,
        `Hola ${customer.name || ""}! 🎉\n\n` +
        `Gracias por tu compra en *Materiales Payán*.\n` +
        `Hemos recibido tu pago correctamente.\n\n` +
        `En breve nos pondremos en contacto contigo para coordinar el envío.\n\n` +
        (totalText ? totalText + "\n\n" : "") +
        `¡Muchas gracias!`
      );
    } else {
      console.log("No se pudo enviar WhatsApp al cliente: teléfono inválido");
    }

    // ========= Mensaje para el dueño =========
    if (ownerPhone) {
      await sendWhatsAppText(
        ownerPhone,
        `✅ *Nuevo pedido pagado en línea*\n\n` +
        `Cliente: ${customer.name || ""}\n` +
        `WhatsApp: ${customer.phone || ""}\n` +
        (orderId ? `ID de orden: ${orderId}\n` : "") +
        (itemsText ? `\nProductos:\n${itemsText}\n\n` : "") +
        (totalText ? totalText + "\n\n" : "") +
        `ID pago MP: ${mpPaymentId || "desconocido"}`
      );
    } else {
      console.log("No se pudo enviar WhatsApp al dueño: WHATSAPP_OWNER_PHONE no configurado");
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

/* ==============================
   RUTA DE PRUEBA WHATSAPP
============================== */

app.get("/api/test-whatsapp", async (req, res) => {
  try {
    const to = normalizeWhatsAppPhone(WHATSAPP_OWNER_PHONE);
    if (!to) {
      return res.status(400).json({ error: "WHATSAPP_OWNER_PHONE no configurado correctamente" });
    }

    await sendWhatsAppText(
      to,
      "Mensaje de prueba desde el backend de Materiales Payán ✅"
    );

    res.json({ ok: true, to });
  } catch (err) {
    console.error("Error en /api/test-whatsapp:", err);
    res.status(500).json({ error: "No se pudo enviar el WhatsApp de prueba" });
  }
});

/* ==============================
   START
============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
