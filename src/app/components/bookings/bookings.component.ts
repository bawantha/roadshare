import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService, Booking } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { CODE, SIZE_SHORT_LABEL, formatFriendlyDate } from '../../utils/geo.utils';
import { ChatComponent } from '../chat/chat.component';
import { ReviewModalComponent } from '../reviews/review-modal.component';

@Component({
  selector: 'app-bookings',
  standalone: true,
  imports: [CommonModule, ChatComponent, ReviewModalComponent],
  templateUrl: './bookings.component.html',
  styleUrl: './bookings.component.css'
})
export class BookingsComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  // Tabs: 'shipments' or 'carries'
  activeTab = signal<'shipments' | 'carries'>('shipments');
  isLoading = signal(false);
  isProcessingPayment = signal(false);

  shipments = signal<Booking[]>([]);
  carries = signal<Booking[]>([]);

  // Chat overlay state
  showChat = signal(false);
  chatBookingId?: number;
  chatBookingItem = '';
  chatRecipientName = '';

  // Review modal state
  showReview = signal(false);
  reviewBookingId?: number;
  reviewDriverId = '';
  reviewDriverName = '';

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
      if (nextStatus === -1) msg = 'Request declined/cancelled';
      else if (nextStatus === 1) msg = 'Request accepted! Waiting for sender payment.';
      else if (nextStatus === 2) msg = 'Item marked as in transit';
      else if (nextStatus === 3) msg = 'Item marked as delivered!';

      this.toast.show(msg);
      await this.loadBookings();
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to update status');
    }
  }

  // Stripe payments simulation
  async payBooking(booking: Booking) {
    this.isProcessingPayment.set(true);
    try {
      // Simulate Stripe processing lag
      await new Promise(resolve => setTimeout(resolve, 1500));
      await this.supabase.payBooking(booking.id);
      this.toast.show('Stripe payment processed! Funds held in Escrow.');
      await this.loadBookings();
    } catch (err: any) {
      console.error(err);
      this.toast.show('Stripe payment simulation failed');
    } finally {
      this.isProcessingPayment.set(false);
    }
  }

  async releasePayment(booking: Booking) {
    try {
      await this.supabase.releaseEscrow(booking.id);
      this.toast.show('Escrow released! Payout dispatched to driver.');
      await this.loadBookings();
    } catch (err: any) {
      console.error(err);
      this.toast.show('Failed to release escrow');
    }
  }

  // Chat Actions
  openChat(booking: Booking) {
    this.chatBookingId = booking.id;
    this.chatBookingItem = booking.item;
    
    if (this.activeTab() === 'shipments') {
      this.chatRecipientName = booking.trip?.driver?.name || 'Driver';
    } else {
      this.chatRecipientName = booking.sender?.name || 'Sender';
    }

    this.showChat.set(true);
  }

  closeChat() {
    this.showChat.set(false);
  }

  // Review Actions
  openReviewModal(booking: Booking) {
    this.reviewBookingId = booking.id;
    this.reviewDriverId = booking.trip?.driver_id || '';
    this.reviewDriverName = booking.trip?.driver?.name || 'Driver';
    this.showReview.set(true);
  }

  closeReviewModal() {
    this.showReview.set(false);
  }

  onReviewSubmitted() {
    this.closeReviewModal();
    this.loadBookings();
  }

  // Helpers
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

  hasReviewed(bookingId: number): boolean {
    // Check locally if review for this booking already exists in mock data
    const mockReviews = JSON.parse(localStorage.getItem('rs_mock_reviews') || '[]');
    return mockReviews.some((r: any) => r.booking_id === bookingId);
  }

  getDriverPayout(price: number): number {
    return Math.round(price * 0.8);
  }
}
