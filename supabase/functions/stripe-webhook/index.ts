import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0"
import Stripe from "https://esm.sh/stripe@11.16.0?target=deno"

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2022-11-15',
});
const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  try {
    const body = await req.text();
    let event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    } catch (err: any) {
      console.error(`Signature verification failed: ${err.message}`);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    // Initialize Supabase Admin client using Service Role Key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as any;
      const paymentIntentId = paymentIntent.id;

      console.log(`PaymentIntent was successful for ID: ${paymentIntentId}`);

      // Locate the booking where stripe_payment_intent_id matches
      const { data: booking, error: fetchError } = await supabaseClient
        .from('bookings')
        .select('id, price')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      if (fetchError || !booking) {
        console.warn(`No booking matches payment intent: ${paymentIntentId}`);
      } else {
        // Update booking status to escrowed (stripe status) and confirmed (booking status)
        const { error: updateError } = await supabaseClient
          .from('bookings')
          .update({
            stripe_payment_status: 'escrowed',
            status: 1 // Confirmed
          })
          .eq('id', booking.id);

        if (updateError) {
          console.error(`Failed to update booking ${booking.id} status`, updateError);
        } else {
          console.log(`Booking ${booking.id} marked as escrowed & confirmed!`);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    console.error(err);
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
})
