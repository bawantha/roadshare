import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Subject } from 'rxjs';

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
  stripe_payment_intent_id?: string;
  stripe_payment_status: 'pending' | 'escrowed' | 'released' | 'refunded';
  created_at: string;
  trip?: Trip;
  sender?: Profile;
}

export interface Message {
  id: number;
  booking_id: number;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: Profile;
}

export interface Review {
  id: number;
  booking_id: number;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment?: string;
  created_at: string;
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

  // Subject to broadcast real-time chat messages locally
  private readonly messageSync$ = new Subject<number>();

  constructor() {
    this.initSupabase();
    this.setupStorageEventListener();
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

  private setupStorageEventListener() {
    // Sync chat messages in mock mode across tabs when localStorage updates
    window.addEventListener('storage', (event) => {
      if (event.key === 'rs_mock_messages' && event.newValue) {
        try {
          const messages: Message[] = JSON.parse(event.newValue);
          if (messages.length > 0) {
            const latestMessage = messages[messages.length - 1];
            this.messageSync$.next(latestMessage.booking_id);
          }
        } catch (e) {
          console.error('Failed to parse synchronized messages', e);
        }
      }
    });
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
      const mockUsers = JSON.parse(localStorage.getItem('rs_mock_users') || '[]');
      if (mockUsers.some((u: any) => u.email === email)) {
        throw new Error('User already exists');
      }

      const mockId = Math.random().toString(36).substring(2, 15);
      const newUser = { id: mockId, email, user_metadata: { name } };
      mockUsers.push({ ...newUser, password });
      localStorage.setItem('rs_mock_users', JSON.stringify(mockUsers));

      const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
      const newProfile: Profile = { id: mockId, name, rating: 5.0, carries: 0 };
      mockProfiles.push(newProfile);
      localStorage.setItem('rs_mock_profiles', JSON.stringify(mockProfiles));

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
      this.simulateNotification('Trip Posted', `Trip from ${tripData.from_city} to ${tripData.to_city} has been listed!`);
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
        status: 0,
        stripe_payment_status: 'pending',
        created_at: new Date().toISOString()
      };
      allBookings.push(newBooking);
      localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));

      // Notification
      const trips = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
      const trip = trips.find((t: any) => t.id === bookingData.trip_id);
      const profiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
      const senderProf = profiles.find((p: any) => p.id === user.id);
      
      this.simulateNotification(
        'Delivery Request Received',
        `Email & SMS to Driver: ${senderProf?.name || 'A sender'} requested space for "${bookingData.item}" on your trip.`
      );

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
          status: 0,
          stripe_payment_status: 'pending'
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
        const booking = allBookings[index];
        booking.status = status;
        
        // If declining (-1) and they paid, refund automatically
        if (status === -1 && booking.stripe_payment_status === 'escrowed') {
          booking.stripe_payment_status = 'refunded';
        }

        localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));

        // Increment carries on delivered (3)
        if (status === 3) {
          const tripId = booking.trip_id;
          const allTrips = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
          const trip = allTrips.find((t: any) => t.id === tripId);
          if (trip) {
            const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
            const profileIndex = mockProfiles.findIndex((p: any) => p.id === trip.driver_id);
            if (profileIndex !== -1) {
              mockProfiles[profileIndex].carries = (mockProfiles[profileIndex].carries || 0) + 1;
              localStorage.setItem('rs_mock_profiles', JSON.stringify(mockProfiles));
              const curProf = this.currentProfile();
              if (curProf && curProf.id === trip.driver_id) {
                this.currentProfile.set({ ...curProf, carries: curProf.carries + 1 });
              }
            }
          }
        }

        // Notify
        this.notifyStatusChange(booking, status);
      }
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    
    // Fetch current booking first for payment checks
    const { data: currentB } = await this.supabase
      .from('bookings')
      .select('stripe_payment_status, price')
      .eq('id', bookingId)
      .single();

    const paymentStatus = currentB?.stripe_payment_status;

    // Update status
    const updateObj: any = { status };
    if (status === -1 && paymentStatus === 'escrowed') {
      updateObj.stripe_payment_status = 'refunded';
    }

    const { error: updateError } = await this.supabase
      .from('bookings')
      .update(updateObj)
      .eq('id', bookingId);

    if (updateError) throw updateError;

    if (status === 3) {
      try {
        const { data: bookingData } = await this.supabase
          .from('bookings')
          .select('trip:trips(driver_id)')
          .eq('id', bookingId)
          .single();

        const driverId = (bookingData as any)?.trip?.driver_id;
        if (driverId) {
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

            const curProf = this.currentProfile();
            if (curProf && curProf.id === driverId) {
              this.currentProfile.set({ ...curProf, carries: newCarries });
            }
          }
        }
      } catch (err) {
        console.error('Failed to increment carries count:', err);
      }
    }
  }

  // Database Operations: Payments
  async payBooking(bookingId: number): Promise<void> {
    if (this.isMock) {
      const allBookings: Booking[] = JSON.parse(localStorage.getItem('rs_mock_bookings') || '[]');
      const index = allBookings.findIndex(b => b.id === bookingId);
      if (index !== -1) {
        allBookings[index].stripe_payment_status = 'escrowed';
        allBookings[index].stripe_payment_intent_id = 'mock_intent_' + Math.random().toString(36).substring(2, 9);
        allBookings[index].status = 1; // Mark as Confirmed upon successful payment escrow
        localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));

        this.simulateNotification(
          'Stripe Escrow Confirmed',
          `SMS to Driver: Senders payment of $${allBookings[index].price} successfully processed and held in escrow. Please arrange pickup.`
        );
      }
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    
    // Simulate successful payment completion by directly writing status
    const mockIntent = 'pi_' + Math.random().toString(36).substring(2, 12);
    const { error } = await this.supabase
      .from('bookings')
      .update({
        stripe_payment_status: 'escrowed',
        stripe_payment_intent_id: mockIntent,
        status: 1 // Confirm booking
      })
      .eq('id', bookingId);

    if (error) throw error;
  }

  async releaseEscrow(bookingId: number): Promise<void> {
    if (this.isMock) {
      const allBookings: Booking[] = JSON.parse(localStorage.getItem('rs_mock_bookings') || '[]');
      const index = allBookings.findIndex(b => b.id === bookingId);
      if (index !== -1) {
        allBookings[index].stripe_payment_status = 'released';
        localStorage.setItem('rs_mock_bookings', JSON.stringify(allBookings));

        const driverCut = Math.round(allBookings[index].price * 0.8);
        this.simulateNotification(
          'Escrow Released',
          `Email to Driver: Senders approved delivery. $${driverCut} (80% share) paid out to your bank account.`
        );
      }
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { error } = await this.supabase
      .from('bookings')
      .update({ stripe_payment_status: 'released' })
      .eq('id', bookingId);

    if (error) throw error;
  }

  // Database Operations: Chat Messages
  async fetchMessages(bookingId: number): Promise<Message[]> {
    if (this.isMock) {
      const allMessages: Message[] = JSON.parse(localStorage.getItem('rs_mock_messages') || '[]');
      const mockProfiles: Profile[] = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');

      return allMessages
        .filter(m => m.booking_id === bookingId)
        .map(m => ({
          ...m,
          sender: mockProfiles.find(p => p.id === m.sender_id) || { id: m.sender_id, name: 'Sender', rating: 5.0, carries: 0 }
        }));
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase
      .from('messages')
      .select(`
        *,
        sender:profiles(*)
      `)
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as Message[];
  }

  async sendMessage(bookingId: number, content: string): Promise<Message> {
    const user = this.currentUser();
    if (!user) throw new Error('You must be signed in to send messages');

    if (this.isMock) {
      const allMessages = JSON.parse(localStorage.getItem('rs_mock_messages') || '[]');
      const nextId = allMessages.length > 0 ? Math.max(...allMessages.map((m: any) => m.id)) + 1 : 300;
      const newMessage: Message = {
        id: nextId,
        booking_id: bookingId,
        sender_id: user.id,
        content: content.trim(),
        created_at: new Date().toISOString()
      };
      allMessages.push(newMessage);
      localStorage.setItem('rs_mock_messages', JSON.stringify(allMessages));
      
      // Dispatch storage event manually for same-tab updates
      this.messageSync$.next(bookingId);
      return newMessage;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await this.supabase
      .from('messages')
      .insert([
        {
          booking_id: bookingId,
          sender_id: user.id,
          content: content.trim()
        }
      ])
      .select()
      .single();

    if (error) throw error;
    return data as Message;
  }

  subscribeToMessages(bookingId: number, callback: () => void) {
    if (this.isMock) {
      // Return a subscription that listens to the sync subject
      const sub = this.messageSync$.subscribe(id => {
        if (id === bookingId) {
          callback();
        }
      });
      return {
        unsubscribe: () => sub.unsubscribe()
      };
    }

    if (!this.supabase) return { unsubscribe: () => {} };

    const channel = this.supabase
      .channel(`chat_${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
        () => {
          callback();
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        channel.unsubscribe();
      }
    };
  }

  // Database Operations: Reviews
  async submitReview(bookingId: number, driverId: string, rating: number, comment?: string): Promise<void> {
    const user = this.currentUser();
    if (!user) throw new Error('You must be signed in to leave reviews');

    if (this.isMock) {
      const allReviews = JSON.parse(localStorage.getItem('rs_mock_reviews') || '[]');
      const nextId = allReviews.length > 0 ? Math.max(...allReviews.map((r: any) => r.id)) + 1 : 400;
      const newReview: Review = {
        id: nextId,
        booking_id: bookingId,
        reviewer_id: user.id,
        reviewee_id: driverId,
        rating,
        comment: comment?.trim(),
        created_at: new Date().toISOString()
      };
      allReviews.push(newReview);
      localStorage.setItem('rs_mock_reviews', JSON.stringify(allReviews));

      // Recalculate driver profile rating
      const mockProfiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
      const driverReviews = allReviews.filter((r: any) => r.reviewee_id === driverId);
      const avgRating = driverReviews.length > 0 
        ? Math.round((driverReviews.reduce((sum: number, r: any) => sum + r.rating, 0) / driverReviews.length) * 10) / 10
        : 5.0;

      const profileIndex = mockProfiles.findIndex((p: any) => p.id === driverId);
      if (profileIndex !== -1) {
        mockProfiles[profileIndex].rating = avgRating;
        localStorage.setItem('rs_mock_profiles', JSON.stringify(mockProfiles));

        // Update active signal if logged in user is the reviewed driver
        const curProf = this.currentProfile();
        if (curProf && curProf.id === driverId) {
          this.currentProfile.set({ ...curProf, rating: avgRating });
        }
      }

      this.simulateNotification(
        'Review Submitted',
        `Driver ${driverId} received a ${rating}-star review: "${comment || 'No comment'}"`
      );
      return;
    }

    if (!this.supabase) throw new Error('Supabase client not initialized');
    
    // Insert review record
    const { error } = await this.supabase
      .from('reviews')
      .insert([
        {
          booking_id: bookingId,
          reviewer_id: user.id,
          reviewee_id: driverId,
          rating,
          comment: comment?.trim()
        }
      ]);

    if (error) throw error;
  }

  // Simulated Alert console logger
  private simulateNotification(title: string, msg: string) {
    console.log(`%c[NOTIFICATION ALERT - ${title}]`, 'background: #FFC72C; color: #20241F; font-weight: bold; padding: 4px;', msg);
  }

  private notifyStatusChange(booking: Booking, status: number) {
    let message = '';
    const profiles = JSON.parse(localStorage.getItem('rs_mock_profiles') || '[]');
    const sender = profiles.find((p: any) => p.id === booking.sender_id);
    const tripId = booking.trip_id;
    const trips = JSON.parse(localStorage.getItem('rs_mock_trips') || '[]');
    const trip = trips.find((t: any) => t.id === tripId);
    const driver = trip ? profiles.find((p: any) => p.id === trip.driver_id) : null;

    if (status === -1) {
      message = `Email & SMS to Sender: Your carry request for "${booking.item}" was declined/cancelled.`;
    } else if (status === 1) {
      message = `Email & SMS to Sender: Your carry request was accepted by ${driver?.name || 'your driver'}. Please process payment.`;
    } else if (status === 2) {
      message = `SMS to Sender: Alert! ${driver?.name || 'your driver'} has picked up your "${booking.item}" and is now in transit!`;
    } else if (status === 3) {
      message = `SMS to Sender: Alert! Your package "${booking.item}" has been marked as delivered by ${driver?.name || 'your driver'}. Please approve payment release.`;
    }

    if (message) {
      this.simulateNotification(`Status Changed: ${this.statusLabel(status)}`, message);
    }
  }

  private statusLabel(status: number): string {
    return {
      [-1]: 'Declined',
      [0]: 'Requested',
      [1]: 'Confirmed',
      [2]: 'In Transit',
      [3]: 'Delivered'
    }[status] || '';
  }

  // Load session session persistence helpers
  private setupMock() {
    this.isMock = true;

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

    if (!localStorage.getItem('rs_mock_bookings')) {
      localStorage.setItem('rs_mock_bookings', JSON.stringify([]));
    }

    if (!localStorage.getItem('rs_mock_messages')) {
      localStorage.setItem('rs_mock_messages', JSON.stringify([]));
    }

    if (!localStorage.getItem('rs_mock_reviews')) {
      localStorage.setItem('rs_mock_reviews', JSON.stringify([]));
    }

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
