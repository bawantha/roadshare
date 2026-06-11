-- ROADSHARE SUPABASE SQL MIGRATION SCHEMA
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


-- 3. Create Bookings Table
CREATE TABLE IF NOT EXISTS public.bookings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  trip_id BIGINT REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  item TEXT NOT NULL,
  size TEXT NOT NULL, -- S, M, L, XL
  price INTEGER NOT NULL,
  status INTEGER DEFAULT 0 NOT NULL, -- 0: requested, 1: confirmed, 2: transit, 3: delivered, -1: declined/cancelled
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


-- 4. Setup user registration trigger profile creator
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

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
