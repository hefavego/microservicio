// index.js
import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());

// NO usar express.json() antes del webhook
// Stripe necesita el body sin parsear en /api/webhook

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

// Usamos → SUPABASE_KEY para conactar el servicio con supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

//  Webhook primero (para que reciba raw body)
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

    try {
      switch (event.type) {
        case "payment_intent.succeeded": {
          const pi = event.data.object;
          console.log(" Pago exitoso:", pi.id);

          await supabase
            .from("pagos")
            .update({ estado: "pagado", fecha_confirmacion: new Date().toISOString() })
            .eq("payment_intent_id", pi.id);
          break;
        }

        case "payment_intent.payment_failed": {
          const pi = event.data.object;
          console.log(" Pago fallido:", pi.id);
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
      return res.status(500).send();
    }

    res.json({ received: true });
  }
);

// Después del webhook puedes usar JSON normalmente
app.use(express.json());

// Endpoint para crear el PaymentIntent
app.post("/api/pagos", async (req, res) => {
  try {
    const { usuario_id, monto, descripcion } = req.body;

    if (!usuario_id || !monto) {
      return res.status(400).json({ error: "usuario_id y monto son requeridos" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(monto * 100),
      currency: "cop",
      automatic_payment_methods: { enabled: true },
      metadata: { usuario_id, descripcion: descripcion || "" },
    });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Microservicio corriendo en puerto ${PORT}`);
});
