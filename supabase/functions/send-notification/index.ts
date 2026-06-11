import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0"

serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("Received database trigger payload:", JSON.stringify(payload));

    const { event, table, schema, record, old_record } = payload;

    if (table !== 'bookings') {
      return new Response("Unsupported table", { status: 400 });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Fetch sender profile, trip details, and driver profile
    const bookingId = record.id;
    const senderId = record.sender_id;
    const tripId = record.trip_id;
    const status = record.status;
    const itemName = record.item;
    const price = record.price;

    const { data: bookingDetails } = await supabaseClient
      .from('bookings')
      .select(`
        *,
        sender:profiles(*),
        trip:trips(
          *,
          driver:profiles(*)
        )
      `)
      .eq('id', bookingId)
      .single();

    if (!bookingDetails) {
      return new Response("Booking details not found", { status: 404 });
    }

    const senderName = bookingDetails.sender?.name || "A RoadShare member";
    const driverName = bookingDetails.trip?.driver?.name || "Driver";
    const fromCity = bookingDetails.trip?.from_city;
    const toCity = bookingDetails.trip?.to_city;

    // Retrieve emails from auth users if profiles don't contain them
    // Note: in a full production system, we query auth.users metadata or store emails in profiles
    const senderEmail = `${senderName.toLowerCase().replace(/\s+/g, '')}@roadshare.au`;
    const driverEmail = `${driverName.toLowerCase().replace(/\s+/g, '')}@roadshare.au`;

    let emailSubject = "";
    let emailBody = "";
    let smsBody = "";
    let recipientEmail = "";
    let recipientPhone = ""; // Twilio target, e.g., driver/sender phone

    if (event === 'INSERT') {
      // New booking request -> notify driver
      recipientEmail = driverEmail;
      emailSubject = `RoadShare: New request from ${senderName}`;
      emailBody = `Hello ${driverName},\n\n${senderName} has requested a spot for "${itemName}" on your upcoming drive from ${fromCity} to ${toCity}.\n\nEstimated Payout: $${Math.round(price * 0.8)} (80% of $${price}).\n\nLog in to RoadShare to accept or decline this request.`;
      smsBody = `RoadShare Alert: New carry request from ${senderName} for "${itemName}" on your route from ${fromCity} to ${toCity}. Accept at roadshare.au!`;
    } else if (event === 'UPDATE') {
      const oldStatus = old_record.status;
      if (oldStatus !== status) {
        recipientEmail = senderEmail;

        if (status === 1) {
          // Accepted by driver
          emailSubject = `RoadShare: Carry request accepted by ${driverName}!`;
          emailBody = `Hello ${senderName},\n\nGreat news! ${driverName} has accepted your request to carry "${itemName}" from ${fromCity} to ${toCity}.\n\nTo confirm the booking, please log in to RoadShare and complete the payment of $${price} using Stripe. The funds will be held in escrow until delivery is complete.`;
          smsBody = `RoadShare Alert: ${driverName} accepted your request for "${itemName}"! Please make payment of $${price} to lock in your spot.`;
        } else if (status === 2) {
          // In Transit
          emailSubject = `RoadShare: Item "${itemName}" is in transit!`;
          emailBody = `Hello ${senderName},\n\n${driverName} has picked up your item and is now driving from ${fromCity} to ${toCity}.\n\nYou can message ${driverName} directly via RoadShare Chat for real-time coordination.`;
          smsBody = `RoadShare Alert: ${driverName} has picked up your "${itemName}"! It is now in transit. Chat with your driver at roadshare.au.`;
        } else if (status === 3) {
          // Delivered
          emailSubject = `RoadShare: Item "${itemName}" has been delivered!`;
          emailBody = `Hello ${senderName},\n\n${driverName} has marked your item as successfully delivered.\n\nPlease log in to RoadShare, verify your item is received, and release the escrow payment to the driver.`;
          smsBody = `RoadShare Alert: Your "${itemName}" has been marked as delivered by ${driverName}! Please release the escrow payment at roadshare.au.`;
        } else if (status === -1) {
          // Declined / Cancelled
          emailSubject = `RoadShare: Booking request update`;
          emailBody = `Hello ${senderName},\n\nWe wanted to let you know that your carry request for "${itemName}" has been declined or cancelled. If you already made a payment, a full refund has been credited back to your card.`;
          smsBody = `RoadShare Alert: Your request for "${itemName}" has been cancelled/declined. Any payment made has been refunded.`;
        }
      }
    }

    // Trigger Notifications APIs
    if (emailSubject && emailBody && recipientEmail) {
      await sendEmail(recipientEmail, emailSubject, emailBody);
    }
    if (smsBody) {
      await sendSMS("+61400000000", smsBody); // Mock receiver phone
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err: any) {
    console.error("Notification engine error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});

// Helper: Send Email via Resend REST API
async function sendEmail(to: string, subject: string, bodyText: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.log(`[Notification Engine - Email Log] To: ${to} | Subject: ${subject}\nBody:\n${bodyText}`);
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: "RoadShare Alerts <alerts@roadshare.au>",
        to: [to],
        subject: subject,
        text: bodyText
      })
    });
    console.log("Resend API response status:", res.status);
  } catch (e) {
    console.error("Resend API request failed", e);
  }
}

// Helper: Send SMS via Twilio REST API
async function sendSMS(to: string, bodyText: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[Notification Engine - SMS Log] To: ${to} | Text: "${bodyText}"`);
    return;
  }

  try {
    const basicAuth = btoa(`${accountSid}:${authToken}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const params = new URLSearchParams();
    params.append('To', to);
    params.append('From', fromNumber);
    params.append('Body', bodyText);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`
      },
      body: params
    });
    console.log("Twilio API response status:", res.status);
  } catch (e) {
    console.error("Twilio API request failed", e);
  }
}
