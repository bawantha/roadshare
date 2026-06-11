import { Injectable, signal, WritableSignal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface Profile {
  id: string;
  name: string;
  rating: number;
  carries: number;
}

export interface Trip {
  id: number;
  driver_id: string;
  vehicle: string;
  from_city: string;
  to_city: string;
  date: string;
  space: string;
  notes?: string;
  driver?: Profile;
}

export interface Booking {
  id: number;
  sender_id: string;
  trip_id: number;
  item: string;
  size: string;
  price: number;
  status: number; // 0: requested, 1: confirmed, 2: transit, 3: delivered, -1: declined/cancelled
  created_at: string;
  trip?: Trip;
  sender?: Profile;
}

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient | null = null;
  private isMock = true;

  // Signal for the currently logged in user
  readonly currentUser = signal<User | { id: string; email: string; user_metadata: { name: string } } | null>(null);
  readonly currentProfile = signal<Profile | null>(null);

  constructor() {
    this.initSupabase();
  }

  private initSupabase() {
    const isPlaceholderUrl = environment.supabaseUrl === 'YOUR_SUPABASE_PROJECT_URL' || !environment.supabaseUrl;
    const isPlaceholderKey = environment.supabaseKey === 'YOUR_SUPABASE_ANON_KEY' || !environment.supabaseKey;

    if (!isPlaceholderUrl && !isPlaceholderKey) {
      try {
        this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
        this.isMock = false;
        this.listenToAuthChanges();
        console.log('Supabase initialized successfully.');
      } catch (err) {
        console.error('Failed to initialize Supabase. Falling back to local storage mock.', err);
        this.setupMock();
      }
    } else {
      console.warn('Supabase credentials not configured. Using simulated local storage backend.');
      this.setupMock();
    }
  }

  private async listenToAuthChanges() {
    if (!this.supabase) return;

    // Get initial session
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session?.user) {
      this.currentUser.set(session.user);
      await this.loadUserProfile(session.user.id);
    }

    this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        this.currentUser.set(session.user);
        await this.loadUserProfile(session.user.id);
      } else {
        this.currentUser.set(null);
        this.currentProfile.set(null);
      }
    });
  }

  private async loadUserProfile(userId: string) {
    if (this.isMock || !this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist, create it
        if (error.code === 'PGRST116') {
          const userMeta = this.currentUser()?.user_metadata;
          const newProfile = {
            id: userId,
            name: userMeta?.['name'] || 'New Member',
            rating: 5.0,
            carries: 0
          };
          await this.supabase.from('profiles').insert([newProfile]);
          this.currentProfile.set(newProfile);
        } else {
          console.error('Error fetching profile:', error);
        }
      } else {
        this.currentProfile.set(data);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    }
  }

  // Auth Methods
  async signUp(email: string, password: string, name: string) {
    if (this.isMock) {
      // Mock SignUp
      const mockUsers = JSON.parse(localStorage.getItem('rs_mock_users') || '[]');
      if (mockUsers.some((u: any) => u.email === email)) {
        throw new Error('User already exists');
      }

      const mockId = Math.random().toString(36).substring(2, 15);
      const newUser = { id: mockId, email, user_metadata: { name } };
      mockUsers.push({ ...newUser, password });
      localStorage.setItem('rs_mock_users', JSON.stringify(mockUsers));

      // Create profile
      const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
      const newProfile: Profile = { id: mockId, name, rating: 5.0, carries: 0 };
      mockProfiles.push(newProfile);
      localStorage.setItem('rs_mock_profiles', JSON.stringify(mockProfiles));

      // Auto login
      this.currentUser.set(newUser);
      this.currentProfile.set(newProfile);
      this.saveSessionToLocal(newUser, newProfile);
      return { user: newUser };
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });

    if (error) throw error;
    return data;
  }

  async signIn(email: string, password: string) {
    if (this.isMock) {
      const mockUsers = JSON.parse(localStorage.getItem('rs_mock_users') || '[]');
      const user = mockUsers.find((u: any) => u.email === email && u.password === password);
      if (!user) {
        throw new Error('Invalid email or password');
      }

      const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
      const profile = mockProfiles.find((p: any) => p.id === user.id) || { id: user.id, name: user.user_metadata.name, rating: 5.0, carries: 0 };

      const cleanUser = { id: user.id, email: user.email, user_metadata: user.user_metadata };
      this.currentUser.set(cleanUser);
      this.currentProfile.set(profile);
      this.saveSessionToLocal(cleanUser, profile);
      return { user: cleanUser };
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    return data;
  }

  async signOut() {
    if (this.isMock) {
      this.currentUser.set(null);
      this.currentProfile.set(null);
      localStorage.removeItem('rs_mock_session');
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    await this.supabase.auth.signOut();
    this.currentUser.set(null);
    this.currentProfile.set(null);
  }

  // Database Operations: Trips
  async fetchTrips(filters?: { from?: string; to?: string }): Promise<Trip[]> {
    if (this.isMock) {
      const allTrips: Trip[] = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
      const mockProfiles: Profile[] = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');

      return allTrips
        .filter(t => {
          if (filters?.from && t.from_city !== filters.from) return false;
          if (filters?.to && t.to_city !== filters.to) return false;
          return true;
        })
        .map(t => ({
          ...t,
          driver: mockProfiles.find(p => p.id === t.driver_id) || { id: t.driver_id, name: 'Driver', rating: 5.0, carries: 0 }
        }));
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    let query = this.supabase
      .from('trips')
      .select(`
        *,
        driver:profiles(*)
      `);

    if (filters?.from) {
      query = query.eq('from_city', filters.from);
    }
    if (filters?.to) {
      query = query.eq('to_city', filters.to);
    }

    const { data, error } = await query.order('date', { ascending: true });
    if (error) throw error;
    return data as Trip[];
  }

  async createTrip(tripData: { vehicle: string; from_city: string; to_city: string; date: string; space: string; notes?: string }): Promise<Trip> {
    const user = this.currentUser();
    if (!user) throw new Error('You must be signed in to post a trip');

    if (this.isMock) {
      const allTrips = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
      const nextId = allTrips.length > 0 ? Math.max(...allTrips.map((t: any) => t.id)) + 1 : 100;
      const newTrip: Trip = {
        id: nextId,
        driver_id: user.id,
        vehicle: tripData.vehicle,
        from_city: tripData.from_city,
        to_city: tripData.to_city,
        date: tripData.date,
        space: tripData.space,
        notes: tripData.notes
      };
      allTrips.push(newTrip);
      localStorage.setItem('rs_mock_trips', JSON.stringify(allTrips));
      return newTrip;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase
      .from('trips')
      .insert([
        {
          driver_id: user.id,
          vehicle: tripData.vehicle,
          from_city: tripData.from_city,
          to_city: tripData.to_city,
          date: tripData.date,
          space: tripData.space,
          notes: tripData.notes
        }
      ])
      .select()
      .single();

    if (error) throw error;
    return data as Trip;
  }

  // Database Operations: Bookings
  async fetchBookings(): Promise<Booking[]> {
    const user = this.currentUser();
    if (!user) return [];

    if (this.isMock) {
      const allBookings: Booking[] = JSON.parse(localStorage.getItem('rs_mock_bookings') || '[]');
      const allTrips: Trip[] = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
      const mockProfiles: Profile[] = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');

      // Filter: user is either the sender OR user is the driver of the trip
      return allBookings
        .filter(b => {
          const trip = allTrips.find(t => t.id === b.trip_id);
          return b.sender_id === user.id || trip?.driver_id === user.id;
        })
        .map(b => {
          const trip = allTrips.find(t => t.id === b.trip_id);
          const tripWithDriver = trip ? {
            ...trip,
            driver: mockProfiles.find(p => p.id === trip.driver_id) || { id: trip.driver_id, name: 'Driver', rating: 5.0, carries: 0 }
          } : undefined;

          return {
            ...b,
            trip: tripWithDriver,
            sender: mockProfiles.find(p => p.id === b.sender_id) || { id: b.sender_id, name: 'Sender', rating: 5.0, carries: 0 }
          };
        });
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    
    // We want bookings where sender is user OR driver of trip is user
    // To do this, we can select everything and let RLS filter, or fetch all that RLS allows
    const { data, error } = await this.supabase
      .from('bookings')
      .select(`
        *,
        sender:profiles(*),
        trip:trips(
          *,
          driver:profiles(*)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data as Booking[];
  }

  async createBooking(bookingData: { trip_id: number; item: string; size: string; price: number }): Promise<Booking> {
    const user = this.currentUser();
    if (!user) throw new Error('You must be signed in to request a spot');

    if (this.isMock) {
      const allBookings = JSON.parse(localStorage.getItem('rs_mock_bookings') || '[]');
      const nextId = allBookings.length > 0 ? Math.max(...allBookings.map((b: any) => b.id)) + 1 : 200;
      const newBooking: Booking = {
        id: nextId,
        sender_id: user.id,
        trip_id: bookingData.trip_id,
        item: bookingData.item,
        size: bookingData.size,
        price: bookingData.price,
        status: 0, // Requested
        created_at: new Date().toISOString()
      };
      allBookings.push(newBooking);
      localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));
      return newBooking;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase
      .from('bookings')
      .insert([
        {
          sender_id: user.id,
          trip_id: bookingData.trip_id,
          item: bookingData.item,
          size: bookingData.size,
          price: bookingData.price,
          status: 0
        }
      ])
      .select()
      .single();

    if (error) throw error;
    return data as Booking;
  }

  async updateBookingStatus(bookingId: number, status: number): Promise<void> {
    if (this.isMock) {
      const allBookings: Booking[] = JSON.parse(localStorage.getItem('rs_mock_bookings') || '[]');
      const index = allBookings.findIndex(b => b.id === bookingId);
      if (index !== -1) {
        allBookings[index].status = status;
        localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));

        // If status becomes Delivered (3), increment carries count for the driver
        if (status === 3) {
          const tripId = allBookings[index].trip_id;
          const allTrips = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
          const trip = allTrips.find((t: any) => t.id === tripId);
          if (trip) {
            const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
            const profileIndex = mockProfiles.findIndex((p: any) => p.id === trip.driver_id);
            if (profileIndex !== -1) {
              mockProfiles[profileIndex].carries = (mockProfiles[profileIndex].carries || 0) + 1;
              localStorage.setItem('rs_mock_profiles', JSON.stringify(mockProfiles));
              // Update local state if currently logged in driver
              const curProf = this.currentProfile();
              if (curProf && curProf.id === trip.driver_id) {
                this.currentProfile.set({ ...curProf, carries: curProf.carries + 1 });
              }
            }
          }
        }
      }
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    
    // Update booking status
    const { error: updateError } = await this.supabase
      .from('bookings')
      .update({ status })
      .eq('id', bookingId);

    if (updateError) throw updateError;

    // If delivered (3), we want to increment driver carries count
    if (status === 3) {
      try {
        const { data: bookingData } = await this.supabase
          .from('bookings')
          .select('trip:trips(driver_id)')
          .eq('id', bookingId)
          .single();

        const driverId = (bookingData as any)?.trip?.driver_id;
        if (driverId) {
          // Increment carries
          const { data: driverProfile } = await this.supabase
            .from('profiles')
            .select('carries')
            .eq('id', driverId)
            .single();

          if (driverProfile) {
            const newCarries = (driverProfile.carries || 0) + 1;
            await this.supabase
              .from('profiles')
              .update({ carries: newCarries })
              .eq('id', driverId);

            // update signal
            const curProf = this.currentProfile();
            if (curProf && curProf.id === driverId) {
              this.currentProfile.set({ ...curProf, carries: newCarries });
            }
          }
        }
      } catch (err) {
        console.error('Failed to increment driver carries count:', err);
      }
    }
  }

  // Simulated setup for Mock Storage
  private setupMock() {
    this.isMock = true;

    // Initialize mock users if not present
    if (!localStorage.getItem('rs_mock_users')) {
      const defaultUsers = [
        { id: 'drv_1', email: 'priya@roadshare.au', user_metadata: { name: 'Priya' } },
        { id: 'drv_2', email: 'jack@roadshare.au', user_metadata: { name: 'Jack' } },
        { id: 'drv_3', email: 'mei@roadshare.au', user_metadata: { name: 'Mei' } },
        { id: 'drv_4', email: 'tom@roadshare.au', user_metadata: { name: 'Tom' } },
        { id: 'drv_5', email: 'aisha@roadshare.au', user_metadata: { name: 'Aisha' } },
        { id: 'drv_6', email: 'liam@roadshare.au', user_metadata: { name: 'Liam' } },
        { id: 'drv_7', email: 'grace@roadshare.au', user_metadata: { name: 'Grace' } },
      ];
      localStorage.setItem('rs_mock_users', JSON.stringify(defaultUsers.map(u => ({ ...u, password: 'password123' }))));
    }

    // Initialize mock profiles
    if (!localStorage.getItem('rs_mock_profiles')) {
      const defaultProfiles: Profile[] = [
        { id: 'drv_1', name: 'Priya', rating: 4.9, carries: 31 },
        { id: 'drv_2', name: 'Jack', rating: 4.8, carries: 54 },
        { id: 'drv_3', name: 'Mei', rating: 5.0, carries: 12 },
        { id: 'drv_4', name: 'Tom', rating: 4.7, carries: 88 },
        { id: 'drv_5', name: 'Aisha', rating: 4.9, carries: 19 },
        { id: 'drv_6', name: 'Liam', rating: 4.6, carries: 7 },
        { id: 'drv_7', name: 'Grace', rating: 4.8, carries: 26 },
      ];
      localStorage.setItem('rs_mock_profiles', JSON.stringify(defaultProfiles));
    }

    // Initialize mock trips
    if (!localStorage.getItem('rs_mock_trips')) {
      const offsetDays = (days: number) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const defaultTrips: Trip[] = [
        { id: 1, driver_id: 'drv_1', vehicle: 'SUV', from_city: 'Melbourne', to_city: 'Sydney', date: offsetDays(2), space: 'L', notes: 'Up the Hume, flexible drop-off across inner Sydney.' },
        { id: 2, driver_id: 'drv_2', vehicle: 'Ute', from_city: 'Melbourne', to_city: 'Brisbane', date: offsetDays(4), space: 'XL', notes: 'Towing an empty trailer back — happy to take furniture.' },
        { id: 3, driver_id: 'drv_3', vehicle: 'Sedan', from_city: 'Sydney', to_city: 'Canberra', date: offsetDays(1), space: 'M', notes: 'Weekly commute, leaves 6am sharp.' },
        { id: 4, driver_id: 'drv_4', vehicle: 'Van', from_city: 'Adelaide', to_city: 'Melbourne', date: offsetDays(3), space: 'XL', notes: 'Half-empty van, can do two or three large items.' },
        { id: 5, driver_id: 'drv_5', vehicle: 'Hatchback', from_city: 'Brisbane', to_city: 'Sydney', date: offsetDays(5), space: 'S', notes: 'Documents, small parcels, nothing perishable.' },
        { id: 6, driver_id: 'drv_6', vehicle: 'Car + trailer', from_city: 'Sydney', to_city: 'Perth', date: offsetDays(9), space: 'XL', notes: 'Crossing the Nullarbor — once-a-year relocation run.' },
        { id: 7, driver_id: 'drv_7', vehicle: 'SUV', from_city: 'Melbourne', to_city: 'Adelaide', date: offsetDays(2), space: 'L', notes: 'Overnight in Horsham, delivery next morning.' },
      ];
      localStorage.setItem('rs_mock_trips', JSON.stringify(defaultTrips));
    }

    // Initialize mock bookings
    if (!localStorage.getItem('rs_mock_bookings')) {
      localStorage.setItem('rs_mock_bookings', JSON.stringify([]));
    }

    // Load session if exists
    const session = localStorage.getItem('rs_mock_session');
    if (session) {
      const { user, profile } = JSON.parse(session);
      this.currentUser.set(user);
      this.currentProfile.set(profile);
    }
  }

  private saveSessionToLocal(user: any, profile: any) {
    localStorage.setItem('rs_mock_session', JSON.stringify({ user, profile }));
  }
}
