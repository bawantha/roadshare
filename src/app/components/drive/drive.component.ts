import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService, Trip } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import {
  CITIES,
  calculatePrice,
  SIZE_SHORT_LABEL,
  offsetDate,
  formatFriendlyDate,
  getDistance
} from '../../utils/geo.utils';

@Component({
  selector: 'app-drive',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './drive.component.html',
  styleUrl: './drive.component.css'
})
export class DriveComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly cities = CITIES;
  readonly sizeOptions = Object.entries(SIZE_SHORT_LABEL).map(([value, label]) => ({ value, label }));
  readonly vehicles = ['Hatchback', 'Sedan', 'SUV', 'Ute', 'Van', 'Car + trailer'];

  // Form fields
  dVehicle = 'SUV';
  dFrom = 'Melbourne';
  dTo = 'Sydney';
  dDate = offsetDate(3);
  dSpace = 'M';
  dNotes = '';

  // State
  myTrips = signal<Trip[]>([]);
  isLoadingMyTrips = signal(false);
  isPosting = signal(false);
  earnEstimate = signal('');

  ngOnInit() {
    this.updateEarningsEstimate();
    this.loadMyTrips();
  }

  async loadMyTrips() {
    const user = this.supabase.currentUser();
    if (!user) return;

    this.isLoadingMyTrips.set(true);
    try {
      const allTrips = await this.supabase.fetchTrips();
      // Filter only current user's trips
      const filtered = allTrips.filter(t => t.driver_id === user.id);
      this.myTrips.set(filtered);
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to load your trips history');
    } finally {
      this.isLoadingMyTrips.set(false);
    }
  }

  updateEarningsEstimate() {
    if (this.dFrom === this.dTo) {
      this.earnEstimate.set('');
      return;
    }
    const fullPrice = calculatePrice(this.dFrom, this.dTo, this.dSpace);
    const driverCut = Math.round(fullPrice * 0.8);
    const sizeName = SIZE_SHORT_LABEL[this.dSpace].toLowerCase();
    this.earnEstimate.set(`Earn up to ~$${driverCut} per ${sizeName} item on this route`);
  }

  async postTrip() {
    if (this.dFrom === this.dTo) {
      this.toast.show('Pick two different cities');
      return;
    }
    if (!this.dDate) {
      this.toast.show('Pick a departure date');
      return;
    }

    this.isPosting.set(true);
    try {
      await this.supabase.createTrip({
        vehicle: this.dVehicle,
        from_city: this.dFrom,
        to_city: this.dTo,
        date: this.dDate,
        space: this.dSpace,
        notes: this.dNotes.trim() || undefined
      });

      this.toast.show('Trip posted successfully! Senders can now request space.');
      this.dNotes = '';
      this.loadMyTrips();
      
      // Auto redirect to see if there are requests or matches
      this.router.navigate(['/trips'], { queryParams: { from: this.dFrom, to: this.dTo } });
    } catch (err: any) {
      console.error(err);
      this.toast.show(err.message || 'Failed to post trip');
    } finally {
      this.isPosting.set(false);
    }
  }

  getFriendlyDate(dateStr: string): string {
    return formatFriendlyDate(dateStr);
  }

  getRouteDistance(from: string, to: string): number {
    return getDistance(from, to);
  }

  getSizeShort(space: string): string {
    return SIZE_SHORT_LABEL[space] || space;
  }
}
