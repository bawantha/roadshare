import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService, Booking } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { CODE, SIZE_SHORT_LABEL, formatFriendlyDate } from '../../utils/geo.utils';

@Component({
  selector: 'app-bookings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bookings.component.html',
  styleUrl: './bookings.component.css'
})
export class BookingsComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  // Tabs: 'shipments' or 'carries'
  activeTab = signal<'shipments' | 'carries'>('shipments');
  isLoading = signal(false);

  shipments = signal<Booking[]>([]);
  carries = signal<Booking[]>([]);

  statusClasses: { [key: number]: string } = {
    [-1]: 'cancelled',
    [0]: 'requested',
    [1]: 'confirmed',
    [2]: 'transit',
    [3]: 'delivered'
  };

  statusLabels: { [key: number]: string } = {
    [-1]: 'Declined',
    [0]: 'Requested',
    [1]: 'Confirmed',
    [2]: 'In Transit',
    [3]: 'Delivered'
  };

  ngOnInit() {
    this.loadBookings();
  }

  async loadBookings() {
    this.isLoading.set(true);
    try {
      const user = this.supabase.currentUser();
      if (!user) return;

      const data = await this.supabase.fetchBookings();
      
      // Separate shipments (where user is sender) vs carries (where user is driver)
      const userShipments = data.filter(b => b.sender_id === user.id);
      const userCarries = data.filter(b => b.trip?.driver_id === user.id);

      this.shipments.set(userShipments);
      this.carries.set(userCarries);
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to load bookings');
    } finally {
      this.isLoading.set(false);
    }
  }

  async updateStatus(booking: Booking, nextStatus: number) {
    try {
      await this.supabase.updateBookingStatus(booking.id, nextStatus);

      let msg = '';
      if (nextStatus === -1) msg = 'Request declined';
      else if (nextStatus === 1) msg = 'Request accepted';
      else if (nextStatus === 2) msg = 'Item marked as in transit';
      else if (nextStatus === 3) msg = 'Item marked as delivered!';

      this.toast.show(msg);
      await this.loadBookings();
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to update status');
    }
  }

  getRouteCode(city: string): string {
    return CODE[city] || city.substring(0, 3).toUpperCase();
  }

  getSizeName(size: string): string {
    return SIZE_SHORT_LABEL[size] || size;
  }

  getFriendlyDate(dateStr?: string): string {
    if (!dateStr) return '';
    return formatFriendlyDate(dateStr);
  }

  getProgressPercentage(status: number): number {
    if (status === -1) return 0;
    return [10, 35, 70, 100][status] || 0;
  }
}
