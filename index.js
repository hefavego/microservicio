// index.js
import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";

dotenv.config();

const app = express();

// IMPORTANTE: Para la verificación del webhook Stripe necesita el body raw.
// Usaremos bodyParser.raw() solo en la ruta /api/webhook.
// Para todo lo demás usamos express.json().
app.use(cors());
app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Endpoint para crear el PaymentIntent
app.post("/api/pagos", async (req, res) => {
  try {
    const { usuario_id, monto, descripcion } = req.body;

    if (!usuario_id || !monto) {
      return res.status(400).json({ error: "usuario_id y monto son requeridos" });
    }

    // Crear PaymentIntent en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(monto * 100), // monto en centavos
      currency: "cop",
      automatic_payment_methods: { enabled: true },
      metadata: { usuario_id, descripcion: descripcion || "" },
    });

    // Registrar intento en Supabase (tabla 'pagos')
    await supabase.from("pagos").insert([
      {
        usuario_id,
        monto,
        estado: "pendiente",
        payment_intent_id: paymentIntent.id,
      },
    ]);

    return res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error /api/pagos:", error);
    return res.status(500).json({ error: "Error al crear pago" });
  }
});

// Endpoint para webhook (Stripe requiere raw body)
app.post(
  "/api/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error(" Error verificación webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Manejar eventos relevantes
    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const pi = event.data.object;
          console.log("Pago exitoso:", pi.id);

          // Actualizar registro en Supabase
          await supabase
            .from("pagos")
            .update({ estado: "pagado", fecha_confirmacion: new Date().toISOString() })
            .eq("payment_intent_id", pi.id);

          break;
        }
        case "payment_intent.payment_failed": {
          const pi = event.data.object;
          console.log("Pago fallido:", pi.id);
          await supabase
            .from("pagos")
            .update({ estado: "fallido" })
            .eq("payment_intent_id", pi.id);
          break;
        }
        default:
          console.log(`Evento no manejado: ${event.type}`);
      }
    } catch (err) {
      console.error("Error al procesar evento:", err);
      // Responder 200 para no reintentar indefinidamente; maneja reintentos si necesario
      return res.status(500).send();
    }

    res.json({ received: true });
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Microservicio corriendo en puerto ${PORT}`);
});
