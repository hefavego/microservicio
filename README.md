# Microservidor de Pagos – Arrendamientos App

Microservicio en Node.js + Express que conecta Stripe con Supabase para procesar pagos de arrendamientos.

##  Endpoints

- `POST /api/pagos` → Crea un PaymentIntent en Stripe.
- `POST /api/webhook` → Recibe y procesa los webhooks de Stripe.

##  Variables de entorno

Copiar el archivo `.env.sample` a `.env` y completar con tus claves reales:
