import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";

const app = express();

// Permitir peticiones de tu frontend
app.use(cors({
  origin: [
    "https://materialespayan.online",
    "https://www.materialespayan.online",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ]
}));

app.use(express.json());

// Mercado Pago token desde variable de entorno
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({ ok: true, service: "Materiales Payán Backend" });
});

// Crear checkout
app.post("/api/checkout", async (req, res) => {
  try {
    const { cart } = req.body;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    const items = cart.map(p => ({
      title: String(p.name),
      quantity: Number(p.quantity || 1),
      unit_price: Number(p.price),
      currency_id: "MXN"
    }));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
