import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService, Trip } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import {
  CITIES,
  CODE,
  getDistance,
  calculatePrice,
  getFerryNote,
  SIZE_SHORT_LABEL,
  formatFriendlyDate
} from '../../utils/geo.utils';

@Component({
  selector: 'app-trips',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trips.component.html',
  styleUrl: './trips.component.css'
})
export class TripsComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly cities = CITIES;
  
  // Filters
  fFrom = '';
  fTo = '';

  // Trips List State
  trips = signal<Trip[]>([]);
  isLoading = signal(false);

  // Modal State
  activeTrip: Trip | null = null;
  mItem = '';
  mSize = 'S';
  showModal = signal(false);
  isSubmitting = signal(false);

  // Cost breakdown variables
  carryFare = 0;
  driverShare = 0;
  feeShare = 0;

  ngOnInit() {
    // Read query params from landing page
    this.route.queryParams.subscribe(params => {
      this.fFrom = params['from'] || '';
      this.fTo = params['to'] || '';
      this.loadTrips();
    });
  }

  async loadTrips() {
    this.isLoading.set(true);
    try {
      const filters = {
        from: this.fFrom || undefined,
        to: this.fTo || undefined
      };
      const data = await this.supabase.fetchTrips(filters);
      this.trips.set(data);
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to load trips. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  clearFilters() {
    this.fFrom = '';
    this.fTo = '';
    this.loadTrips();
    // clear query params in url
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { from: null, to: null },
      queryParamsHandling: 'merge'
    });
  }

  getRouteCode(city: string): string {
    return CODE[city] || city.substring(0, 3).toUpperCase();
  }

  getDistanceText(a: string, b: string): string {
    return getDistance(a, b).toLocaleString();
  }

  getStartingPrice(a: string, b: string): number {
    return calculatePrice(a, b, 'S');
  }

  getSizeShort(space: string): string {
    return SIZE_SHORT_LABEL[space] || space;
  }

  getFriendlyDateText(dateStr: string): string {
    return formatFriendlyDate(dateStr);
  }

  // Booking Modal Methods
  openBookingModal(trip: Trip) {
    if (!this.supabase.currentUser()) {
      this.toast.show('Please sign in to request a spot');
      this.router.navigate(['/auth']);
      return;
    }

    this.activeTrip = trip;
    this.mItem = '';
    
    // Set default item size to drivers maximum capacity
    this.mSize = 'S';
    this.updateBookingCost();
    this.showModal.set(true);
  }

  closeBookingModal() {
    this.showModal.set(false);
    this.activeTrip = null;
  }

  getAvailableSizes(): { value: string; label: string }[] {
    if (!this.activeTrip) return [];
    
    const capacityOrder = ['S', 'M', 'L', 'XL'];
    const driverCapIndex = capacityOrder.indexOf(this.activeTrip.space);
    
    return capacityOrder.slice(0, driverCapIndex + 1).map(val => ({
      value: val,
      label: SIZE_SHORT_LABEL[val]
    }));
  }

  updateBookingCost() {
    if (!this.activeTrip) return;
    const price = calculatePrice(this.activeTrip.from_city, this.activeTrip.to_city, this.mSize);
    this.carryFare = price;
    this.feeShare = Math.round(price * 0.2);
    this.driverShare = price - this.feeShare;
  }

  getModalFerryNote(): string {
    if (!this.activeTrip) return '';
    return getFerryNote(this.activeTrip.from_city, this.activeTrip.to_city);
  }

  async confirmBooking() {
    if (!this.activeTrip) return;
    if (!this.mItem.trim()) {
      this.toast.show("Describe what you're sending");
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.supabase.createBooking({
        trip_id: this.activeTrip.id,
        item: this.mItem.trim(),
        size: this.mSize,
        price: this.carryFare
      });

      this.toast.show(`Request sent to ${this.activeTrip.driver?.name} — check "My Deliveries"`);
      this.closeBookingModal();
      this.router.navigate(['/bookings']);
    } catch (err: any) {
      console.error(err);
      this.toast.show(err.message || 'Failed to submit request');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
