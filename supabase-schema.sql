-- ROADSHARE SUPABASE SQL MIGRATION SCHEMA (UPDATED WITH ADVANCED FEATURES)
-- Copy and run this script in the Supabase SQL Editor (https://supabase.com/dashboard)

-- 1. Create Profiles Table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  rating NUMERIC(2, 1) DEFAULT 5.0,
  carries INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.profiles;

-- RLS Policies for Profiles
CREATE POLICY "Allow public read access to profiles" 
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Allow users to update their own profile" 
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow users to insert their own profile" 
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);


-- 2. Create Trips Table
CREATE TABLE IF NOT EXISTS public.trips (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  vehicle TEXT NOT NULL,
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  date DATE NOT NULL,
  space TEXT NOT NULL, -- S, M, L, XL
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Trips
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated users to read trips" ON public.trips;
DROP POLICY IF EXISTS "Allow users to insert their own trips" ON public.trips;
DROP POLICY IF EXISTS "Allow drivers to update their own trips" ON public.trips;
DROP POLICY IF EXISTS "Allow drivers to delete their own trips" ON public.trips;

-- RLS Policies for Trips
CREATE POLICY "Allow authenticated users to read trips" 
  ON public.trips FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow users to insert their own trips" 
  ON public.trips FOR INSERT WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Allow drivers to update their own trips" 
  ON public.trips FOR UPDATE USING (auth.uid() = driver_id);

CREATE POLICY "Allow drivers to delete their own trips" 
  ON public.trips FOR DELETE USING (auth.uid() = driver_id);


-- 3. Create Bookings Table (Updated with Payment columns)
CREATE TABLE IF NOT EXISTS public.bookings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  trip_id BIGINT REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  item TEXT NOT NULL,
  size TEXT NOT NULL, -- S, M, L, XL
  price INTEGER NOT NULL,
  status INTEGER DEFAULT 0 NOT NULL, -- 0: requested, 1: confirmed, 2: transit, 3: delivered, -1: declined/cancelled
  stripe_payment_intent_id TEXT,
  stripe_payment_status TEXT DEFAULT 'pending' NOT NULL, -- pending, escrowed, released, refunded
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Bookings
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow senders and drivers to read bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow senders to create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow senders and drivers to update booking status" ON public.bookings;

-- Bookings are only visible to the sender OR the driver of the trip
CREATE POLICY "Allow senders and drivers to read bookings" 
  ON public.bookings FOR SELECT USING (
    auth.uid() = sender_id OR 
    auth.uid() = (SELECT driver_id FROM public.trips WHERE id = trip_id)
  );

CREATE POLICY "Allow senders to create bookings" 
  ON public.bookings FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Senders can cancel/decline (status = -1), Drivers can change status (requested -> confirmed -> transit -> delivered)
CREATE POLICY "Allow senders and drivers to update booking status" 
  ON public.bookings FOR UPDATE USING (
    auth.uid() = sender_id OR 
    auth.uid() = (SELECT driver_id FROM public.trips WHERE id = trip_id)
  );


-- 4. Create Messages (Chat) Table
CREATE TABLE IF NOT EXISTS public.messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id BIGINT REFERENCES public.bookings(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow chat participants to read messages" ON public.messages;
DROP POLICY IF EXISTS "Allow chat participants to send messages" ON public.messages;

-- Messages are only visible to the sender or the driver of the booking
CREATE POLICY "Allow chat participants to read messages" 
  ON public.messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.trips t ON b.trip_id = t.id
      WHERE b.id = booking_id AND (auth.uid() = b.sender_id OR auth.uid() = t.driver_id)
    )
  );

CREATE POLICY "Allow chat participants to send messages" 
  ON public.messages FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.trips t ON b.trip_id = t.id
      WHERE b.id = booking_id AND (auth.uid() = b.sender_id OR auth.uid() = t.driver_id)
    )
  );


-- 5. Create Reviews Table
CREATE TABLE IF NOT EXISTS public.reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id BIGINT REFERENCES public.bookings(id) ON DELETE CASCADE UNIQUE NOT NULL,
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for Reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow senders to create reviews for drivers" ON public.reviews;

CREATE POLICY "Allow public read access to reviews" 
  ON public.reviews FOR SELECT USING (true);

-- Users can only review bookings where they are the sender (reviewing the driver)
CREATE POLICY "Allow senders to create reviews for drivers" 
  ON public.reviews FOR INSERT WITH CHECK (
    auth.uid() = reviewer_id AND
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id AND b.sender_id = auth.uid() AND b.status = 3 -- Must be delivered
    )
  );


-- 6. Setup profile creator triggers
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, rating, carries)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', 'New Member'),
    5.0,
    0
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate user trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 7. Trigger to automatically recalculate Profile ratings on new review
CREATE OR REPLACE FUNCTION public.recalculate_profile_rating()
RETURNS trigger AS $$
BEGIN
  UPDATE public.profiles
  SET rating = (
    SELECT COALESCE(ROUND(AVG(rating), 1), 5.0)
    FROM public.reviews
    WHERE reviewee_id = new.reviewee_id
  )
  WHERE id = new.reviewee_id;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate review trigger
DROP TRIGGER IF EXISTS on_review_added ON public.reviews;
CREATE TRIGGER on_review_added
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_profile_rating();
